"""End-to-end tests of the 3D drive view, one block per flow in replica/recon.md (case ids from
replica/test-plan.md). Fails on any page or console error, and runs an axe accessibility scan on
each part of the drive view.

Run:  bun install && bun run build && python3 tests/e2e/test_drive.py [screenshot-dir]
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
URL = "file://" + os.path.join(ROOT, "dist", "index.html")
AXE = open(os.path.join(ROOT, "node_modules", "axe-core", "axe.min.js")).read()
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
CHROME = os.environ.get("CHROME")   # a local Chromium, when Playwright's own isn't installed
failures = []

def check(case, name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + f"{case} {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond: failures.append(f"{case} {name}")

def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))

def js(pg, expr):
    return pg.evaluate(expr)

def axe(pg, case, sel, name):
    """WCAG 2.1 A and AA rules on one part of the page."""
    pg.evaluate(AXE)
    v = pg.evaluate("""async (sel) => (await axe.run(document.querySelector(sel), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }))
      .violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', '))""", sel)
    check(case, f"axe finds nothing wrong with the {name}", not v, v)

def open_demo(pg):
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.get_by_role("button", name="File").first.click()
    pg.get_by_text("Open the two-train control demo").click()
    if pg.is_visible("text=Discard and open demo"): pg.get_by_text("Discard and open demo").click()
    pg.wait_for_timeout(400)

def drive(pg):
    """Open the drive view from the keyboard."""
    pg.mouse.click(600, 450); pg.keyboard.press("Escape")
    pg.keyboard.press("d"); pg.wait_for_timeout(800)

def free_spot(pg, consist, ok=True, mid=True):
    """A screen point over track where `consist` would (or wouldn't) fit."""
    return js(pg, f"""(() => {{ const d = railplot.drive, w = d.world(), v = railplot.view3d, r = v.canvas.getBoundingClientRect();
      const pts = new Set(railplot.p.control.points.map(q => q.item));
      for (const a of w.graph.samples(40)) {{
        const f = w.fit('{consist}', a), good = !('error' in f);
        if ({'true' if ok else 'false'} ? (!good || ({'true' if mid else 'false'} && Math.abs(a.s - w.graph.routeLength(a.item, a.route) / 2) > 30)) : !pts.has(a.item)) continue;
        const p = w.graph.pose(a), s = v.toCanvas(p.x, p.y, p.z + 5);
        if (s && s.x > 40 && s.y > 40 && s.x < r.width - 40 && s.y < r.height - 160) return [r.left + s.x, r.top + s.y];
      }} return null; }})()""")

def hover(pg, at):
    pg.mouse.move(at[0] - 3, at[1]); pg.mouse.move(at[0], at[1]); pg.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(json={"tag_name": "v0.0.1", "body": "", "assets": []}))
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # ---------- F01 drive a train round the layout ----------
    pg.goto(URL); pg.wait_for_timeout(500)
    js(pg, "railplot.p.items = []; railplot.commit()")
    drive(pg)
    check("F01-E1", "with no track, the drive view says to lay some first", not js(pg, "railplot.drive.open") and pg.get_by_text("Lay some track first").count() >= 1)
    open_demo(pg)
    drive(pg)
    check("F01-H1", "D opens the drive view with a chip per train", js(pg, "railplot.drive.open") and pg.get_by_role("radio").count() == 2)
    pg.keyboard.press("2")
    js(pg, "railplot.p.control.trains[1].momentum = 0")
    for _ in range(6): pg.keyboard.press("e")
    pg.wait_for_timeout(1500)
    check("F01-H1", "E opens the throttle and the speed shows", int(pg.locator("#drive-speed").inner_text()) > 0 and "forward" in pg.get_by_role("toolbar", name="Train controls").inner_text())
    # after dragging the throttle slider, the keys still drive
    pg.get_by_role("slider", name="Throttle").focus()
    cam = pg.get_by_role("button", name=re.compile("^Camera:")).inner_text().split()[0]
    pg.keyboard.press("c"); pg.wait_for_timeout(100)
    check("F01-E12", "with the throttle slider focused, C still changes the camera", pg.get_by_role("button", name=re.compile("^Camera:")).inner_text().split()[0] != cam)
    pg.keyboard.press("Space"); pg.wait_for_timeout(1200)
    check("F01-H2", "Space stops the train", js(pg, "railplot.ctl.engine.run(railplot.drive.train).target") == 0)
    axe(pg, "F01-E9", "#drive-hud", "HUD")
    pg.keyboard.press("?"); pg.wait_for_timeout(100)
    js(pg, "railplot.showShortcuts()"); pg.wait_for_timeout(150)
    keys = pg.get_by_role("dialog").inner_text()
    check("F01-E10", "Help > Keyboard shortcuts lists the drive view's keys", all(x in keys for x in ["Drive in 3D", "Make up trains", "Uncouple"]), keys[-300:])
    pg.keyboard.press("Escape")
    pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(400)
    hud = js(pg, "(() => { const r = document.querySelector('#drive-hud').getBoundingClientRect(); return [r.left, r.right]; })()")
    check("F01-E7", "at phone width the HUD fits and the page doesn't scroll sideways", js(pg, "document.documentElement.scrollWidth") <= 390 and hud[0] >= 0 and hud[1] <= 390, hud)
    pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(400)

    # ---------- F02 make up a train and put it on the track ----------
    pg.keyboard.press("t"); pg.wait_for_timeout(200)
    dlg = pg.get_by_role("dialog", name="Trains and rolling stock")
    check("F02-H1", "T opens the Trains dialog on the selected train", dlg.count() == 1 and dlg.get_by_role("list", name="Vehicles, front first").get_by_role("button").count() >= 1)
    axe(pg, "F02-E7", ".dialog", "Trains dialog")
    fit = js(pg, """(() => { const d = document.querySelector('.dialog').getBoundingClientRect(), b = [...document.querySelectorAll('.dialog button')].find(x => /on the track/.test(x.textContent)).getBoundingClientRect();
      return [d.bottom <= innerHeight + 1, b.bottom <= d.bottom && b.top >= d.top]; })()""")
    check("F02-E13", "with the whole catalogue in it, the dialog fits the window and its actions show without scrolling", fit == [True, True], fit)
    check("F02-H4", "the catalogue lists classic locos, coaches and wagons by type", all(dlg.get_by_role("group", name=g).count() == 1 for g in ["Steam locomotives", "Diesel locomotives", "Coaches", "Wagons"]))
    pg.select_option("#trains-scale", "H0"); pg.wait_for_timeout(150)
    check("F02-H5", "European (H0) shows electric locomotives, and no British stock", dlg.get_by_role("group", name="Electric locomotives").count() == 1 and dlg.get_by_role("button", name=re.compile("Castle")).count() == 0 and dlg.get_by_role("button", name=re.compile("class 103")).count() == 1)
    pg.select_option("#trains-scale", "OO"); pg.wait_for_timeout(150)
    dlg.get_by_role("button", name="New rake of wagons").click(); pg.wait_for_timeout(100)
    for _ in range(3): dlg.get_by_role("button", name="Add a box van").click(); pg.wait_for_timeout(50)
    strip = dlg.get_by_role("list", name="Vehicles, front first")
    check("F02-E10", "after adding a vehicle the keyboard stays on the button", js(pg, "document.activeElement.getAttribute('data-kind')") == "van")
    check("F02-H1", "stock buttons add vehicles to the back", strip.get_by_role("button", name="Box van").count() == 3 and strip.get_by_role("button").count() == 4)
    rake = js(pg, "railplot.drive.editing")
    # keyboard only: Tab into the stock, Enter adds; Delete takes one out again
    strip.get_by_role("button").first.focus(); pg.keyboard.press("Delete"); pg.wait_for_timeout(100)
    check("F02-E5", "Delete takes the focused vehicle out", strip.get_by_role("button", name="Open wagon").count() == 0)
    dlg.get_by_role("button", name="Place on the track").click(); pg.wait_for_timeout(300)
    card = pg.get_by_role("group", name="Place a train")
    check("F02-H1", "placing shows its card", card.count() == 1)
    axe(pg, "F02-E7", "#drive-place", "place card")
    bad = free_spot(pg, rake, ok=False)
    hover(pg, bad)
    check("F02-E2", "over a point the ghost is refused, and says why", "point" in card.inner_text())
    good = free_spot(pg, rake)
    hover(pg, good)
    check("F02-H1", "over free track it fits", "put it here" in card.inner_text())
    pg.keyboard.press("r"); pg.wait_for_timeout(100)
    check("F02-H2", "R turns the ghost round", js(pg, "railplot.drive.placing.dir") == -1)
    pg.keyboard.press("r"); pg.wait_for_timeout(100)
    pg.mouse.click(good[0], good[1]); pg.wait_for_timeout(300)
    check("F02-H1", "a click puts the rake there", js(pg, f"railplot.drive.world().consists.find(c => c.id === '{rake}').at.length") == 3 and card.count() == 0)
    shot(pg, "F02-placed")
    # the same spot again: something's in the way
    pg.keyboard.press("t"); pg.wait_for_timeout(150)
    dlg.get_by_role("button", name="New rake of wagons").click(); pg.wait_for_timeout(100)
    other = js(pg, "railplot.drive.editing")
    dlg.get_by_role("button", name="Place on the track").click(); pg.wait_for_timeout(300)
    hover(pg, good)
    check("F02-E3", "on top of another train it's refused", "in the way" in card.inner_text(), card.inner_text())
    # keyboard only: arrows move the ghost along the track (not the train), Enter puts it down
    target = js(pg, "railplot.ctl.engine.run(railplot.drive.train).target")
    pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(100)
    for _ in range(80):
        if "Enter" in card.inner_text(): break
        pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(30)
    check("F02-E4", "arrows move the ghost, not the train's throttle", js(pg, "railplot.ctl.engine.run(railplot.drive.train).target") == target)
    pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    check("F02-E4", "with the keyboard alone, arrows find a spot and Enter places it", js(pg, f"railplot.drive.world().consists.find(c => c.id === '{other}').at.length") == 1, card.inner_text() if card.count() else "")
    # far too long for anywhere on the layout
    pg.keyboard.press("t"); pg.wait_for_timeout(150)
    dlg.get_by_role("button", name="New rake of wagons").click(); pg.wait_for_timeout(100)
    long = js(pg, "railplot.drive.editing")
    for _ in range(30): dlg.get_by_role("button", name="Add a coach").click()
    pg.wait_for_timeout(100)
    check("F02-E8", "a 31-vehicle rake scrolls in the strip instead of widening the dialog", js(pg, "document.querySelector('.dialog').getBoundingClientRect().width") <= 660)
    dlg.get_by_role("button", name="Place on the track").click(); pg.wait_for_timeout(300)
    # plain track with nothing on it
    clear = js(pg, """(() => { const d = railplot.drive, w = d.world(), v = railplot.view3d, r = v.canvas.getBoundingClientRect();
      const pts = new Set(railplot.p.control.points.map(q => q.item)), used = w.itemsUnder();
      for (const a of w.graph.samples(40)) { if (pts.has(a.item) || used.has(a.item) || Math.abs(a.s - w.graph.routeLength(a.item, a.route) / 2) > 30) continue;
        const p = w.graph.pose(a), s = v.toCanvas(p.x, p.y, p.z + 5);
        if (s && s.x > 40 && s.y > 40 && s.x < r.width - 40 && s.y < r.height - 160) return [r.left + s.x, r.top + s.y]; } return null; })()""")
    hover(pg, clear)
    check("F02-E1", "too long for the track: refused, with the train's length", "won't fit" in card.inner_text() and "mm long" in card.inner_text(), card.inner_text())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check("F02-E1", "Esc stops placing and stays in the drive view", pg.get_by_role("group", name="Place a train").count() == 0 and js(pg, "railplot.drive.open"))
    js(pg, f"railplot.drive.world().remove('{long}'); railplot.commit()")
    # take every vehicle out of the express: nothing breaks
    pg.keyboard.press("2"); pg.keyboard.press("t"); pg.wait_for_timeout(150)
    while strip.get_by_role("button").count():
        strip.get_by_role("button").first.focus(); pg.keyboard.press("Delete"); pg.wait_for_timeout(80)
    check("F02-E6", "a train with no vehicles says so", "No vehicles yet" in dlg.inner_text())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    check("F02-E6", "and the drive view keeps running", not errors and js(pg, "railplot.drive.open"), errors[:2])
    pg.keyboard.press("t"); pg.wait_for_timeout(150)
    dlg.get_by_role("button", name="Add a locomotive").click(); pg.wait_for_timeout(100)
    dlg.get_by_role("button", name="on the track").click(); pg.wait_for_timeout(300)
    spot = free_spot(pg, js(pg, "railplot.drive.placing.id")); pg.mouse.click(spot[0], spot[1]); pg.wait_for_timeout(300)
    check("F02-H3", "a new loco for the express goes on the track", js(pg, "!!railplot.drive.world().poseOf(railplot.p.control.trains[1].id)"))
    # refresh mid-flow: the stock is still there, where it stood
    before = js(pg, "railplot.drive.world().consists.map(c => [c.id, c.vehicles.length, c.at.length]).sort().join(';')")
    pg.wait_for_timeout(800); pg.reload(); pg.wait_for_timeout(600)
    drive(pg)
    after = js(pg, "railplot.drive.world().consists.map(c => [c.id, c.vehicles.length, c.at.length]).sort().join(';')")
    check("F02-E9", "after a reload every train and rake is still on the track", before == after, (before, after))

    # ---------- F03 shunt: couple up, uncouple, leave the wagons ----------
    js(pg, """(() => { const d = railplot.drive, w = d.world(), cfg = railplot.p.control;
      for (const c of [...w.consists]) if (!c.train) w.remove(c.id);
      railplot.commit(); })()""")
    pg.keyboard.press("2"); pg.wait_for_timeout(100)
    vans = js(pg, """(() => { const d = railplot.drive, w = d.world(), ex = w.consistOf(d.train);
      const r = w.newRake(['a', 'b'].map(x => ({ id: 'van-' + x, kind: 'van', length: 84, color: '#8a5a3c', detectable: true })));
      w.sync();
      // just ahead of the express, the way it will go
      let a = ex.at[0];
      for (let k = 0; k < 40; k++) { a = w.graph.advance(a, 20, (i) => railplot.p.control.points.find(q => q.item === i)?.state).pos;
        if (!w.placeConsist(r.id, a)) break; }
      railplot.commit(); return r.id; })()""")
    js(pg, "railplot.p.control.trains[1].momentum = 0")
    js(pg, "railplot.ctl.act({ c: 'throttle', train: railplot.drive.train, v: 0.06 })")
    try: pg.wait_for_function("railplot.drive.world().consistOf(railplot.drive.train).vehicles.length === 3", timeout=30000); coupled = True
    except Exception: coupled = False
    check("F03-H1", "running gently onto the vans couples them", coupled, js(pg, "railplot.drive.world().consists.map(c => c.id + ':' + c.vehicles.length)"))
    pg.keyboard.press("Space"); pg.wait_for_timeout(1500)
    pg.keyboard.press("u"); pg.wait_for_timeout(200)
    check("F03-H1", "U uncouples the loco", js(pg, "railplot.drive.world().consistOf(railplot.drive.train).vehicles.length") == 1)
    stand = js(pg, "(() => { const w = railplot.drive.world(), c = w.consists.find(c => !c.train); return [c.id, w.graph.pose(c.at[0]).x]; })()")
    js(pg, "railplot.ctl.act({ c: 'throttle', train: railplot.drive.train, v: -0.2 })"); pg.wait_for_timeout(2500)
    js(pg, "railplot.ctl.act({ c: 'throttle', train: railplot.drive.train, v: 0 })")
    left = js(pg, f"railplot.drive.world().graph.pose(railplot.drive.world().consists.find(c => c.id === '{stand[0]}').at[0]).x")
    check("F03-H1", "the loco pulls away and the vans stay", abs(left - stand[1]) < 0.5, (left, stand))
    # the vans have resistor wheelsets: current detection sees them where no train is booked
    js(pg, "railplot.p.control.detection = { current: true, threshold: 10 }; railplot.commit()")
    pg.wait_for_timeout(1500)
    js(pg, "railplot.ctl.act({ c: 'throttle', train: railplot.drive.train, v: -0.3 })"); pg.wait_for_timeout(4000)
    js(pg, "railplot.ctl.act({ c: 'throttle', train: railplot.drive.train, v: 0 })")
    try: pg.wait_for_function("railplot.ctl.engine.strays.size > 0", timeout=20000); seen = True
    except Exception: seen = False
    check("F03-E3", "wagons left behind show up through current detection", seen, js(pg, "[[...railplot.ctl.engine.detected], railplot.ctl.engine.blockName(railplot.p.control.trains[1].block)]"))
    js(pg, "railplot.p.control.detection = { current: false, threshold: 10 }; railplot.commit()")
    # a point with a train standing on it won't move
    under = js(pg, "(() => { const w = railplot.drive.world(), u = w.itemsUnder(); return railplot.p.control.points.map(q => q.item).find(i => u.has(i)) || null; })()")
    if under:
        st = js(pg, f"railplot.p.control.points.find(q => q.item === '{under}').state")
        js(pg, f"railplot.drive.throwPoint('{under}')")
        check("F03-E2", "a point with a vehicle on it won't throw", js(pg, f"railplot.p.control.points.find(q => q.item === '{under}').state") == st)

    # ---------- F07 derail and re-rail ----------
    js(pg, "(() => { const w = railplot.drive.world(); for (const c of [...w.consists]) if (!c.train) w.remove(c.id); railplot.commit(); })()")
    js(pg, "railplot.ctl.act({ c: 'place', train: railplot.p.control.trains[0].id, block: railplot.p.control.blocks.find(b => b.name === 'Loop').id })")
    js(pg, "railplot.ctl.act({ c: 'place', train: railplot.p.control.trains[1].id, block: railplot.p.control.blocks.find(b => b.name === 'East').id })")
    pg.wait_for_timeout(300)
    pg.keyboard.press("1")
    auto = js(pg, "railplot.ctl.engine.automations()[0].id")
    js(pg, f"railplot.ctl.act({{ c: 'auto', id: '{auto}', run: true }})")
    pg.wait_for_timeout(1500)
    js(pg, "(() => { const w = railplot.drive.world(); w.derail(w.consistOf(railplot.p.control.trains[0].id), 'curve', 0, 100, 371); })()")
    pg.wait_for_timeout(500)
    r = js(pg, f"railplot.ctl.engine.autoRuns.get('{auto}')")
    check("F07-E5", "an automation whose train derails stops and says why", r and not r["running"] and "derailed" in r["status"], r)
    try: pg.wait_for_selector("#drive-derailed", timeout=3000); card_up = True
    except Exception: card_up = False
    check("F07-H1", "the derailment card shows for the selected train", card_up)
    if card_up: axe(pg, "F07-E9", "#drive-derailed", "derailment card")
    pg.keyboard.press("r"); pg.wait_for_timeout(300)
    check("F07-H1", "R re-rails it", not js(pg, "!!railplot.drive.world().consistOf(railplot.p.control.trains[0].id).derailed"))

    check("ALL", "no page or console errors", not errors, errors[:3])
    b.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
