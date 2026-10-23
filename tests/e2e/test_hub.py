"""End-to-end: the Railplot hub with two browsers and a WiThrottle app.

Run:  bun run build && python3 tests/e2e/test_hub.py [screenshot-dir]
"""
import json, os, socket, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
PORT, WT = 18765, 18766
failures = []

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond: failures.append(name)

tmp = tempfile.mkdtemp()
layout = os.path.join(tmp, "layout.railplot")
# start the hub with the two-train demo
subprocess.run(["bun", "-e", f"import {{ buildControlDemo }} from '{ROOT}/src/sample'; import {{ serialize }} from '{ROOT}/src/io'; await Bun.write('{layout}', serialize(buildControlDemo()));"], check=True)
hub = subprocess.Popen(["bun", os.path.join(ROOT, "src/hub/main.ts"), "--layout", layout, "--port", str(PORT), "--withrottle", str(WT), "--no-mdns"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(1.5)
URL = f"http://127.0.0.1:{PORT}/"

try:
    with sync_playwright() as p:
        # WebGL in software, for the 3D view
        b = p.chromium.launch(executable_path=os.environ.get("CHROME") or None, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        errors = []
        pages = []
        for i in range(2):
            ctx = b.new_context(viewport={"width": 1200, "height": 800} if i == 0 else {"width": 400, "height": 800})
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(URL); pages.append(pg)
        a, c = pages
        a.wait_for_timeout(1500)
        js = lambda pg, e: pg.evaluate(e)
        check("a page opened from the hub goes straight to driving", js(a, "railplot.mode") == "control" and js(a, "!!railplot.ctl.hub"))
        check("it shows the hub's layout", js(a, "railplot.p.name") == "Two-train control demo")
        check("the status shows the hub", a.locator(".chip:has-text('Hub: connected')").count() == 1)

        ex = js(a, "railplot.p.control.trains[1].id")
        a.fill(f"#thr-{ex}", "60"); a.evaluate(f"document.getElementById('thr-{ex}').dispatchEvent(new Event('input'))")
        c.wait_for_timeout(600)
        check("another phone sees the throttle move", abs(js(c, f"railplot.ctl.engine.run('{ex}').target") - 0.6) < 0.01)
        check("its slider follows", c.locator(f"#thr-{ex}").input_value() == "60")
        c.click("button:has-text('Stop all trains')"); a.wait_for_timeout(500)
        check("stop all from the phone stops it on the laptop too", js(a, f"railplot.ctl.engine.run('{ex}').target") == 0)

        # 3D through the hub: the laptop shows the hub's simulator, drives a train, and the phone sees it move
        check("Drive in 3D is offered through the hub", a.locator("#drive-3d").count() == 1)
        a.click("#drive-3d"); a.wait_for_timeout(1500)
        check("the 3D view shows the hub's trains", js(a, "railplot.drive.open && railplot.drive.world().mirror && railplot.drive.world().consists.length >= 2"))
        pos = lambda pg: js(pg, f"(() => {{ const c = railplot.drive.world().consistOf('{ex}'); return c.at[0].item + ':' + Math.round(c.at[0].s); }})()")
        at0 = pos(c)
        js(a, f"railplot.drive.train = '{ex}'")
        for _ in range(5): a.keyboard.press("ArrowUp"); a.wait_for_timeout(80)
        a.wait_for_timeout(2500)
        check("driving in 3D moves the hub's train", abs(js(a, f"railplot.ctl.engine.run('{ex}').target")) > 0.1 and pos(c) != at0, (at0, pos(c)))
        if SHOTS: a.screenshot(path=os.path.join(SHOTS, "23-hub-3d.png"))
        a.keyboard.press("Space"); a.wait_for_timeout(2500)
        a.keyboard.press("t"); a.wait_for_timeout(400)
        check("the Trains dialog opens through the hub", a.locator(".trains-dlg").count() == 1)
        v0 = json.loads(__import__("urllib.request").request.urlopen(f"http://127.0.0.1:{PORT}/api/status").read())["v"]
        a.select_option("#trains-which", label="Express"); a.wait_for_timeout(300)
        a.locator('[data-kind="wagon"]').click()
        a.wait_for_timeout(2000)
        hub_cons = json.loads(__import__("urllib.request").request.urlopen(f"http://127.0.0.1:{PORT}/api/layout").read())["control"].get("consists", [])
        check("a wagon added in the dialog reaches the hub's train", any(x.get("train") == ex and len(x["vehicles"]) >= 2 for x in hub_cons), hub_cons)
        n_on_c = lambda: js(c, f"(railplot.drive.world().consistOf('{ex}') || {{vehicles: []}}).vehicles.length")
        check("and the phone's copy shows it", n_on_c() >= 2, n_on_c())
        a.click("#trains-turn"); a.wait_for_timeout(1500)
        check("turning it round is done on the hub", js(c, f"railplot.drive.world().consistOf('{ex}').vehicles[0].kind") != "loco" or js(a, f"railplot.drive.world().consistOf('{ex}').vehicles.length") < 2)
        a.keyboard.press("Escape"); a.wait_for_timeout(200)
        a.keyboard.press("Escape"); a.wait_for_timeout(400)

        # a WiThrottle app takes train 1 (the goods train)
        s = socket.create_connection(("127.0.0.1", WT)); s.settimeout(2)
        greet = s.recv(4096).decode()
        check("WiThrottle greeting", greet.startswith("VN2.0") and "RL2]\\[Goods train}|{1}|{S" in greet, greet[:200])
        s.sendall(b"NTest phone\nHUe2e\nMT+S1<;>S1\nMTAS1<;>V63\n")
        a.wait_for_timeout(700)
        goods = js(a, "railplot.p.control.trains[0].id")
        check("the WiThrottle app drives a train the browser shows", abs(js(a, f"railplot.ctl.engine.run('{goods}').target") - 0.5) < 0.01)
        a.click("button[role=tab]:has-text('Drive')") if False else None
        # the browser throws a point; the app hears about it
        a.click("button:has-text('Into the loop')"); a.wait_for_timeout(600)
        got = s.recv(8192).decode()
        check("the app hears the points change", "PTA4RP1" in got and "PTA4RP2" in got, got[-300:])
        s.sendall(b"MTAS1<;>V0\nQ\n"); s.close()

        # an edit on the laptop reaches the phone
        a.evaluate("railplot.p.name = 'Edited on the laptop'; railplot.commit()")
        c.wait_for_timeout(2000)
        check("a layout change reaches the other device", js(c, "railplot.p.name") == "Edited on the laptop")
        if SHOTS:
            a.screenshot(path=os.path.join(SHOTS, "20-hub-laptop.png")); c.screenshot(path=os.path.join(SHOTS, "21-hub-phone.png"))

        # Claude, through the connector (the hub program in "mcp" mode, as Claude Desktop starts it)
        mcp = subprocess.Popen(["bun", os.path.join(ROOT, "src/hub/main.ts"), "mcp", "--hub", f"127.0.0.1:{PORT}", "--folder", tmp],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        seq = [0]
        def rpc(method, params=None):
            seq[0] += 1
            mcp.stdin.write(json.dumps({"jsonrpc": "2.0", "id": seq[0], "method": method, "params": params or {}}) + "\n"); mcp.stdin.flush()
            return json.loads(mcp.stdout.readline())
        def tool(name, args):
            r = rpc("tools/call", {"name": name, "arguments": args})["result"]
            return r["content"][0]["text"], r["isError"]
        init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "1"}})
        check("the connector starts from the hub program", init["result"]["serverInfo"]["name"] == "railplot")
        mcp.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); mcp.stdin.flush()
        st = json.loads(tool("get_status", {})[0])
        check("it finds the hub and its layout", st["live"] and st["plan"] == "Edited on the laptop", st)
        a.evaluate("railplot.setMode('design')"); a.wait_for_timeout(300)
        n0 = js(a, "railplot.p.items.length")
        text, err = tool("propose_add_flex", {"title": "Spur for the coal yard", "reason": "A short siding off the main line.", "at": {"x": 0, "y": -650, "heading": 0}, "sections": [{"straight": 300}, {"radius": 600, "angle": 20}]})
        check("Claude's proposal is accepted by the hub", not err and "Spur for the coal yard" in text, text)
        a.wait_for_timeout(1500)
        check("it appears on the laptop at once", a.locator(".prop-card:has-text('Spur for the coal yard')").count() == 1)
        a.click(".prop-card button:has-text('Show')"); a.wait_for_timeout(300)
        if SHOTS: a.screenshot(path=os.path.join(SHOTS, "22-hub-proposal.png"))
        a.click(".prop-card button:has-text('Accept')"); a.wait_for_timeout(2000)
        hub_layout = json.loads(__import__("urllib.request").request.urlopen(f"http://127.0.0.1:{PORT}/api/layout").read())
        check("accepting it changes the hub's layout", len(hub_layout["items"]) == n0 + 1 and not hub_layout.get("proposals"))
        check("and reaches the other device", js(c, "railplot.p.items.length") == n0 + 1 and not js(c, "railplot.p.proposals"))
        text, err = tool("list_proposals", {})
        check("the connector sees nothing waiting", "No proposals waiting" in text, text)
        goods = js(a, "railplot.p.control.trains[0].id")
        text, err = tool("drive_train", {"train": "Goods train", "speed": 25})
        check("the controls are off until the owner allows them", err and "Let Claude use the controls" in text, text)
        a.evaluate("railplot.setMode('control')"); a.click("text=Set up"); a.wait_for_timeout(200)
        a.check("#claude-control"); a.wait_for_timeout(1500)
        text, err = tool("drive_train", {"train": "Goods train", "speed": 25})
        c.wait_for_timeout(800)
        check("allowed, Claude drives a train the phones show", not err and abs(js(c, f"railplot.ctl.engine.run('{goods}').target") - 0.25) < 0.01, text)
        text, err = tool("stop_train", {"train": "Goods train"})
        c.wait_for_timeout(600)
        check("and stops it", js(c, f"railplot.ctl.engine.run('{goods}').target") == 0)
        mcp.stdin.close(); mcp.wait(timeout=5)
        check("no page errors", not errors, errors[:3])
        b.close()
finally:
    hub.terminate()
    out = hub.communicate(timeout=5)[0]
    check("the hub logged the throttle app", "Test phone took Goods train" in out, out[-500:])

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
