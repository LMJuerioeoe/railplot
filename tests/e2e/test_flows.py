"""End-to-end click-through of Railplot's core flows in headless Chromium.

Run:  bun run build && python3 tests/e2e/test_flows.py [screenshot-dir]
"""
import json, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
URL = "file://" + os.path.join(ROOT, "dist", "index.html")
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
failures = []

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond: failures.append(name)

def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))

def js(pg, expr):
    return pg.evaluate(expr)

def to_screen(pg, x, y):
    return pg.evaluate("""([x,y]) => { const a = window.railplot; const r = a.canvas.getBoundingClientRect();
      return { x: r.left + a.view.ox + x * a.view.s, y: r.top + a.view.oy - y * a.view.s }; }""", [x, y])

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1400, "height": 860}, accept_downloads=True)
    ctx.add_init_script("delete window.showSaveFilePicker;")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(URL)
    pg.wait_for_timeout(500)

    # F00 sample opens on first launch
    check("sample loads with no open ends", js(pg, "railplot.an.free.length") == 0 and js(pg, "railplot.p.items.length") == 27)
    shot(pg, "01-sample")

    # F00b will my trains fit?
    pg.click("#train-fit button:has-text('Main line')"); pg.wait_for_timeout(150)
    check("a long train is too long for the sample's loops", pg.locator("#train-fit .fit-row[data-kind='short-road']").count() == 2)
    pg.locator("#train-fit .fit-row").first.click(); pg.wait_for_timeout(100)
    check("clicking a finding selects its track", js(pg, "railplot.sel.size") >= 1)
    shot(pg, "01b-train-fit")
    pg.keyboard.press("Escape")
    pg.fill("#train-length", "500"); pg.press("#train-length", "Enter"); pg.fill("#train-vehicle", "0"); pg.press("#train-vehicle", "Tab"); pg.wait_for_timeout(150)
    check("a short train fits", pg.locator("#train-fit >> text=Your trains fit").count() == 1, js(pg, "JSON.stringify(railplot.p.train)"))

    # F02 new layout with a baseboard
    pg.click("#tb-new")
    pg.wait_for_timeout(200)
    if pg.is_visible("text=Discard and start new"): pg.click("text=Discard and start new"); pg.wait_for_timeout(200)
    pg.fill("#new-name", "Test layout")
    pg.fill("#new-w", "2000")
    pg.fill("#new-d", "1000")
    pg.click("text=Create layout")
    pg.wait_for_timeout(200)
    check("new layout has one board", js(pg, "railplot.p.boards.length") == 1 and js(pg, "railplot.p.items.length") == 0)

    # start point
    pg.keyboard.press("s")
    s = to_screen(pg, 500, 150)
    pg.mouse.click(s["x"], s["y"])
    check("start point placed", js(pg, "railplot.p.starts.length") == 1)
    pg.keyboard.press("v")

    # F01 oval from sectional track: straights + 8 curves + straights + 8 curves
    pg.select_option("#lib-select", "hornby-oo")
    tile = lambda pid: pg.click(f'[data-part="hornby-oo/{pid}"]')
    tile("R601"); tile("R601")
    tile("R606")
    for _ in range(7): pg.keyboard.press("Space")
    tile("R601"); tile("R601")
    tile("R606")
    for _ in range(7): pg.keyboard.press("Space")
    check("oval closes (no open ends)", js(pg, "railplot.an.free.length") == 0, js(pg, "railplot.an.free.length"))
    check("oval has 20 pieces", js(pg, "railplot.p.items.length") == 20)
    check("start point consumed", js(pg, "railplot.p.starts.length") == 0)
    shot(pg, "02-oval")

    # flip + next end on a turnout off an open end: delete one straight to open the oval
    n_before = js(pg, "railplot.p.items.length")
    first = js(pg, "railplot.p.items[0].id")
    pg.evaluate(f"railplot.sel = new Set(['{first}']); railplot.refresh()")
    pg.keyboard.press("Delete")
    check("delete removes a piece", js(pg, "railplot.p.items.length") == n_before - 1)
    check("two open ends after delete", js(pg, "railplot.an.free.length") == 2)
    # click an open end to make it the anchor, then add a point
    e = js(pg, "railplot.an.free[0]")
    sp = to_screen(pg, e["x"], e["y"])
    pg.mouse.click(sp["x"], sp["y"])
    check("clicking an open end sets the anchor", js(pg, "railplot.anchor && railplot.anchor.kind") == "end")
    tile("R8073")
    k0 = js(pg, "railplot.last.k")
    pg.keyboard.press("Tab")
    check("Tab joins the turnout by its next end", js(pg, "railplot.last.k") == (k0 + 1) % 3)
    m0 = js(pg, "railplot.last.mirror")
    pg.keyboard.press("f")
    check("F flips the new piece", js(pg, "railplot.last.mirror") != m0)
    check("placement bar visible", pg.is_visible(".place-bar"))
    shot(pg, "03-turnout")
    pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z")
    check("undo removes the turnout", js(pg, "railplot.p.items.length") == n_before - 1)

    # F03 flex track closes the gap
    pg.keyboard.press("g")
    ends = js(pg, "railplot.an.free")
    a = to_screen(pg, ends[0]["x"], ends[0]["y"]); bpt = to_screen(pg, ends[1]["x"], ends[1]["y"])
    pg.mouse.click(a["x"], a["y"])
    pg.mouse.move(bpt["x"], bpt["y"], steps=6)
    check("flex preview snaps to the other end", js(pg, "!!(railplot.flex && railplot.flex.snapTo)"))
    pg.mouse.click(bpt["x"], bpt["y"])
    check("flex closes the oval again", js(pg, "railplot.an.free.length") == 0, js(pg, "railplot.an.free.length"))
    check("flex piece created", js(pg, "railplot.p.items.some(i => i.part.endsWith('SL-100'))"))
    pg.keyboard.press("Escape")

    # F04 heights: raise one joint by 12 mm
    pg.keyboard.press("h")
    j = js(pg, "railplot.an.ends[5]")
    jp = to_screen(pg, j["x"], j["y"])
    pg.mouse.click(jp["x"], jp["y"])
    check("joint selected in heights mode", js(pg, "!!railplot.heightSel"))
    for _ in range(12): pg.keyboard.press("ArrowUp")
    z = js(pg, "railplot.heightAtSel()")
    check("joint raised 12 mm", abs(z - 12) < 1e-6, z)
    check("gradient appears", js(pg, "railplot.p.items.some(i => Math.abs(i.z[0]-i.z[1]) > 0)"))
    shot(pg, "04-heights")
    pg.keyboard.press("h")

    # layers
    pg.click('[aria-label="Add layer"]')
    check("layer added and active", js(pg, "railplot.p.layers.length") == 2 and js(pg, "railplot.p.activeLayer") == js(pg, "railplot.p.layers[1].id"))

    # F10 3D view
    pg.keyboard.press("3")
    pg.wait_for_timeout(600)
    check("3D view opens", pg.is_visible(".view3d"))
    shot(pg, "05-3d")
    pg.keyboard.press("Escape")
    check("3D view closes", not pg.is_visible(".view3d"))

    # F11 parts list
    pg.click("#tb-parts")
    rows = pg.locator("table.parts tbody tr").count()
    check("parts list has rows", rows >= 3, rows)
    first = pg.locator("input.price-in").first
    key = first.get_attribute("data-price")
    first.fill("2.40"); first.press("Enter"); pg.wait_for_timeout(150)
    n = js(pg, f"railplot.p.items.filter(i => i.part === '{key}').length")
    check("a price is saved with the layout", js(pg, f"railplot.p.prices.each['{key}']") == 2.4)
    check("the total follows", f"{2.4 * n:.2f}" in pg.locator("#pl-total").inner_text(), pg.locator("#pl-total").inner_text())
    check("prices start in the browser's currency ($ in the US)", pg.locator("#pl-currency").input_value() == "$" and "$" in pg.locator("#pl-total").inner_text())
    pg.select_option("#pl-currency", "£"); pg.wait_for_timeout(100)
    check("and can be pounds", js(pg, "railplot.p.prices.currency") == "£" and "£" in pg.locator("#pl-total").inner_text())
    shot(pg, "06-parts")
    pg.click("text=Done")

    # F14 save (browser download) and reopen
    with pg.expect_download() as d:
        pg.keyboard.press("Control+s")
    path = d.value.path()
    data = json.load(open(path))
    check("saved file is a Railplot layout", data.get("format") == "railplot" and len(data["items"]) == js(pg, "railplot.p.items.length"))
    with pg.expect_file_chooser() as fc:
        pg.keyboard.press("Control+o")
    fc.value.set_files(path)
    pg.wait_for_timeout(300)
    check("reopened layout matches", js(pg, "railplot.p.items.length") == len(data["items"]))

    # export PNG
    with pg.expect_download() as d:
        pg.evaluate("railplot.exportPng()")
    check("PNG export", d.value.suggested_filename.endswith(".png"))

    # autosave survives reload
    pg.wait_for_timeout(700)
    count = js(pg, "railplot.p.items.length")
    pg.reload(); pg.wait_for_timeout(500)
    check("autosave restores layout after reload", js(pg, "railplot.p.items.length") == count)

    # F02b baseboard modules from the project's laser-cut design
    pg.click("#tb-new")
    pg.fill("#new-name", "Module layout")
    pg.select_option("#new-kind", "std-1200x600")
    pg.fill("#new-count", "2")
    pg.click("text=Create layout")
    pg.wait_for_timeout(200)
    check("new layout made of 2 joined modules", js(pg, "railplot.p.boards.filter(b => b.module).length") == 2)
    pg.select_option("#lib-select", "@boards")
    check("the baseboard library lists the whole range", pg.locator(".board-tile").count() == 25 and pg.locator(".lib-group").count() == 4)
    pg.click('[data-module="std-1200x600"]')
    check("module tile adds a third module", js(pg, "railplot.p.boards.length") == 3)
    # drag the new module away and back so it snaps on again
    c = js(pg, "railplot.p.boards[2].module")
    s0 = to_screen(pg, c["cx"], c["cy"])
    pg.mouse.move(s0["x"], s0["y"]); pg.mouse.down(); pg.mouse.move(s0["x"] + 120, s0["y"] + 60, steps=5); pg.mouse.up()
    moved = js(pg, "railplot.p.boards[2].module.cx") - c["cx"]
    check("module dragged away", abs(moved) > 50, moved)
    s1 = to_screen(pg, js(pg, "railplot.p.boards[2].module.cx"), js(pg, "railplot.p.boards[2].module.cy"))
    pg.mouse.move(s1["x"], s1["y"]); pg.mouse.down(); pg.mouse.move(s1["x"] - 116, s1["y"] - 57, steps=5); pg.mouse.up()
    check("module snaps back onto its neighbour", abs(js(pg, "railplot.p.boards[2].module.cx") - c["cx"]) < 0.01 and abs(js(pg, "railplot.p.boards[2].module.cy") - c["cy"]) < 0.01)
    # a corner on the end, turned the other way, then taken off again
    pg.select_option("#lib-select", "@boards")
    pg.click('[data-module="corner90-600"]'); pg.wait_for_timeout(100)
    check("a corner joins the end of the run", js(pg, "railplot.p.boards.length") == 4)
    rot0 = js(pg, "railplot.p.boards[3].module.rot")
    pg.click("#rejoin"); pg.wait_for_timeout(100)
    check("join by its other face turns the corner the other way", abs(js(pg, "railplot.p.boards[3].module.rot") - rot0) > 0.1)
    shot(pg, "08b-corner")
    pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z"); pg.wait_for_timeout(100)
    check("undo takes the corner off", js(pg, "railplot.p.boards.length") == 3)
    # track positions: two tracks across the first module, build from one, lay flex on the guides
    pg.evaluate("railplot.sel = new Set([railplot.p.boards[0].id]); railplot.refresh()")
    pg.wait_for_timeout(100)
    pg.click("#tracks-2"); pg.wait_for_timeout(100)
    check("two tracks across shows four track positions", js(pg, "railplot.p.boards[0].module.tracks") == 2)
    pg.click("#tracks-all"); pg.wait_for_timeout(100)
    check("use on every module", js(pg, "railplot.p.boards.every(b => b.module.tracks === 2)"))
    b0 = js(pg, "railplot.p.boards[0].module")
    # the track position on the left face nearest the front, nudged inside the board
    # 600 mm boards spread two tracks 200 mm in from the edges, so they are 100 mm either side of the middle
    port = to_screen(pg, b0["cx"] - 600 + 3, b0["cy"] - 100)
    pg.mouse.click(port["x"], port["y"]); pg.wait_for_timeout(150)
    check("clicking a track position anchors there", js(pg, "railplot.anchor && railplot.anchor.kind") == "port")
    pg.select_option("#lib-select", "peco-setrack-oo")
    pg.click('[data-part="peco-setrack-oo/ST-201"]'); pg.wait_for_timeout(100)
    it = js(pg, "(() => { const i = railplot.p.items[railplot.p.items.length - 1]; return { x: i.x, y: i.y }; })()")
    check("track starts exactly on the track position", abs(it["x"] - (b0["cx"] - 600)) < 0.01 and abs(it["y"] - (b0["cy"] - 100)) < 0.01, it)
    n0 = js(pg, "railplot.p.items.length")
    pg.evaluate("railplot.sel = new Set([railplot.p.boards[1].id]); railplot.refresh()"); pg.wait_for_timeout(100)
    pg.click("#lay-guides"); pg.wait_for_timeout(150)
    check("laying flex along the guides adds two lengths", js(pg, "railplot.p.items.length") == n0 + 2)
    shot(pg, "08c-tracks")
    pg.select_option("#lib-select", "hornby-oo")
    pg.keyboard.press("s")
    st = to_screen(pg, 150, 200)
    pg.mouse.click(st["x"], st["y"]); pg.keyboard.press("v")
    n1 = js(pg, "railplot.p.items.length")
    tile("R8072"); tile("R8077"); tile("R8076")
    check("new Hornby points place", js(pg, "railplot.p.items.length") == n1 + 3)
    pg.click(".pb-part") if False else None
    pg.evaluate("railplot.sel.clear(); railplot.refresh()")
    shot(pg, "08-modules")
    pg.click("#tb-parts")
    check("parts list includes modules and hardware", pg.locator("text=10 mm alignment dowel").count() == 1)
    pg.click("text=Done")

    # F16 ready-made yards: an Inglenook built from a track position on a module
    nb = js(pg, "railplot.p.items.length")
    b1 = js(pg, "railplot.p.boards[1].module")
    port = to_screen(pg, b1["cx"] - 600 + 3, b1["cy"] + 100)
    pg.mouse.click(port["x"], port["y"]); pg.wait_for_timeout(100)
    pg.select_option("#lib-select", "@yards"); pg.wait_for_timeout(100)
    check("the yards list shows four yards", pg.locator("[data-yard]").count() == 4)
    pg.click('[data-yard="inglenook"]'); pg.wait_for_timeout(150)
    check("the yard dialog draws a preview", pg.locator(".yard-preview svg path").count() > 5)
    shot(pg, "08d-yard-dialog")
    pg.click(".dialog button:has-text('Build')"); pg.wait_for_timeout(200)
    added = js(pg, "railplot.p.items.length") - nb
    check("the Inglenook is built: 2 points, a curve and 4 lengths of flex", added == 7, added)
    first = js(pg, "(() => { const ids = [...railplot.sel]; const i = railplot.p.items.find(x => x.id === ids[0]); return { x: i.x, y: i.y }; })()")
    check("it starts on the track position", abs(first["x"] - (b1["cx"] - 600)) < 0.01 and abs(first["y"] - (b1["cy"] + 100)) < 0.01, first)
    check("all its joints line up", js(pg, "railplot.an.bad.length") == 0)
    pg.keyboard.press("Control+z"); pg.wait_for_timeout(100)
    check("undo takes the whole yard away", js(pg, "railplot.p.items.length") == nb)

    # F16b example shunting layouts
    pg.click("text=File"); pg.click("text=Example shunting layouts")
    pg.wait_for_timeout(600)
    check("the examples dialog lists three layouts with pictures", pg.locator("[data-example]").count() == 3 and pg.locator(".example-pic svg").count() == 3)
    pg.click('[data-example="traverser-plank"]'); pg.wait_for_timeout(200)
    pg.click(".dialog button:has-text('Open')"); pg.wait_for_timeout(200)
    if pg.is_visible("text=Discard and open example"): pg.click("text=Discard and open example"); pg.wait_for_timeout(300)
    check("an example opens on its boards", js(pg, "railplot.p.boards.length") == 3 and js(pg, "railplot.p.items.length") > 10)
    check("its joints line up and its motors clear the frame", js(pg, "railplot.an.bad.length") == 0 and pg.locator(".chip:has-text('Point motors clear of frame')").count() == 1)
    shot(pg, "08e-example")

    # F16c a proposal from the Claude connector: show, accept, undo, reject
    n0 = js(pg, "railplot.p.items.length")
    js(pg, """(() => { const p = JSON.parse(JSON.stringify(railplot.p));
      const a = p.items[0], gone = p.items[1];
      const it = { ...a, id: 't900', y: a.y - 150 };
      p.proposals = [{ id: 'Ptest1', title: 'Add a siding', why: 'Room for a coal wagon.', by: 'Claude', at: new Date().toISOString(),
        add: { boards: [], items: [it], starts: [], layers: [] }, change: { boards: [], items: [], starts: [] }, remove: [gone.id],
        before: { boards: [], items: [gone], starts: [] } }];
      railplot.applyRemoteProject(p); })()""")
    pg.wait_for_timeout(200)
    check("a proposal shows under Claude's proposals", pg.locator(".prop-card:has-text('Add a siding')").count() == 1 and pg.locator(".prop-card >> text=adds 1 piece of track and removes 1 piece of track").count() == 1)
    check("its arrival is announced", pg.locator(".toast:has-text('Claude proposes: Add a siding')").count() >= 1)
    pg.click(".prop-card button:has-text('Show')"); pg.wait_for_timeout(200)
    check("show draws it on the plan", js(pg, "railplot.showProp") == "Ptest1")
    shot(pg, "08f-proposal")
    pg.click(".prop-card button:has-text('Accept')"); pg.wait_for_timeout(200)
    check("accept applies it and clears the list", js(pg, "railplot.p.items.length") == n0 and js(pg, "railplot.p.items.some(i => i.id === 't900')") and pg.locator(".prop-card").count() == 0)
    pg.keyboard.press("Control+z"); pg.wait_for_timeout(200)
    check("undo takes the accept back and the proposal returns", js(pg, "railplot.p.items.some(i => i.id === 't900')") == False and pg.locator(".prop-card").count() == 1)
    pg.click(".prop-card button:has-text('Reject')"); pg.wait_for_timeout(200)
    check("reject throws it away", pg.locator(".prop-card").count() == 0 and js(pg, "railplot.p.items.length") == n0)
    pg.keyboard.press("Control+z"); pg.wait_for_timeout(150)
    check("undo brings a rejected proposal back", pg.locator(".prop-card").count() == 1)
    pg.keyboard.press("Control+y"); pg.wait_for_timeout(150)
    check("redo rejects it again", pg.locator(".prop-card").count() == 0)
    pg.click("text=Help"); pg.click("text=Connect Claude")
    pg.wait_for_timeout(150)
    check("Help explains how to connect Claude", pg.locator(".dialog >> text=railplot-claude-windows.mcpb").count() == 1)
    pg.click(".dialog button:has-text('Close')")

    check("there's no Claude chat in the app", pg.locator("#tb-claude").count() == 0 and pg.locator(".chat").count() == 0)

    # F16e shunting session
    pg.click("text=Tools"); pg.click("text=Shunting session…"); pg.wait_for_timeout(200)
    check("a session deals a train of five cards", pg.locator(".shunt-cards li").count() == 5)
    check("all eight wagons start in the sidings", pg.locator(".shunt-siding .wagon").count() == 8)
    first = pg.locator("#sh-out h3").inner_text()
    pg.click(".dialog button:has-text('Deal new cards')"); pg.wait_for_timeout(100)
    check("new cards have a new number", pg.locator("#sh-out h3").inner_text() != first)
    pg.click("#sh-start"); pg.click("#sh-move"); pg.click("#sh-move"); pg.wait_for_timeout(1300)
    check("the clock runs and moves are counted", pg.locator("#sh-clock").inner_text() != "0:00" and pg.locator("#sh-moves").inner_text() == "2")
    shot(pg, "08g-shunting")
    pg.click(".dialog button:has-text('Done')")

    # F17 control: the two-train demo on the simulator
    pg.click("text=File"); pg.click("text=Open the two-train control demo")
    if pg.is_visible("text=Discard and open demo"): pg.click("text=Discard and open demo")
    pg.wait_for_timeout(300)
    check("control mode opens with the demo", js(pg, "railplot.mode") == "control" and js(pg, "railplot.p.control.trains.length") == 2)
    ex = js(pg, "railplot.p.control.trains[1].id")
    start_block = js(pg, "railplot.p.control.trains[1].block")
    pg.fill(f"#thr-{ex}", "100"); pg.evaluate(f"document.getElementById('thr-{ex}').dispatchEvent(new Event('input'))")
    pg.wait_for_timeout(6000)
    check("the express moves on to another block", js(pg, "railplot.p.control.trains[1].block") != start_block)
    pg.click("text=Stop all trains")
    check("stop all stops every train", js(pg, "railplot.ctl.engine.run(railplot.p.control.trains[1].id).target") == 0)
    pg.click("text=Set up"); pg.wait_for_timeout(100)
    check("Claude can't use the controls until allowed", js(pg, "!!railplot.p.control.claude") == False and pg.locator("#claude-control").count() == 1)
    pg.check("#claude-control"); pg.wait_for_timeout(100)
    check("the owner can let Claude use the controls", js(pg, "railplot.p.control.claude") == True)
    pg.uncheck("#claude-control"); pg.wait_for_timeout(100)
    pg.locator("button:has-text('Wiring list')").click()
    check("wiring list shows block drivers", pg.locator("text=Driver 1: EN GPIO25").count() >= 1)
    pg.click("text=Done")
    check("Set up shows the joiners and track feeds on the plan", js(pg, "railplot.ctl.wiringPlan().js.length") == js(pg, "railplot.ctl.engine.topo.boundaries.length") and js(pg, "railplot.ctl.wiringPlan().fs.length") >= js(pg, "railplot.p.control.blocks.length"))
    pg.click("#wiring-diagram"); pg.wait_for_timeout(150)
    check("the wiring diagram opens", pg.locator(".wiring-svg svg").count() == 1)
    pg.click(".dialog button:has-text('Done')")
    pg.check("#det-current"); pg.wait_for_timeout(100)
    # a block with no train in it or booked for one (a train that just left it may take 10 s to clear)
    empty = js(pg, "(() => { const e = railplot.ctl.engine; return railplot.p.control.blocks.map(b => b.id).find(b => !e.trainIn(b) && !e.claimedBy.get(b)); })()")
    pg.select_option("#det-stray-block", empty); pg.click("#det-stray")
    try: pg.wait_for_function(f"railplot.ctl.engine.strays.has('{empty}')", timeout=15000); found = True
    except Exception: found = False
    check("current detection finds a wagon left where no train is booked", found, js(pg, "[...railplot.ctl.engine.detected]"))
    pg.click("#det-stray"); pg.wait_for_timeout(1500)
    check("and lets go when it's taken away", js(pg, "railplot.ctl.engine.strays.size") == 0)
    pg.uncheck("#det-current"); pg.wait_for_timeout(100)
    shot(pg, "09-control")

    # F18 routes and automations
    pg.click("button[role=tab]:has-text('Drive')"); pg.wait_for_timeout(100)
    pg.click("button:has-text('Into the loop')"); pg.wait_for_timeout(150)
    check("a route sets both points", js(pg, "railplot.p.control.points.every(q => q.state === 1)"))
    pg.click("button[role=tab]:has-text('Auto')"); pg.wait_for_timeout(100)
    check("Auto tab lists routes and the demo automation", pg.locator(".setup-sec >> text=Main line").count() == 1 and pg.locator("text=Goods shuttle").count() >= 1)
    goods = js(pg, "railplot.p.control.trains[0].id")
    gstart = js(pg, "railplot.p.control.trains[0].block")
    pg.locator(".auto-row button:has-text('Start')").first.click()
    pg.wait_for_timeout(5000)
    check("the goods shuttle sets off on its own", js(pg, "railplot.p.control.trains[0].block") != gstart, js(pg, "JSON.stringify([...railplot.ctl.engine.autoRuns])"))
    check("its status shows the step it is on", pg.locator(".auto-row .auto-status").first.inner_text().startswith("Step "))
    pg.locator(".auto-row button:has-text('Stop')").first.click()
    check("stopping an automation", not js(pg, "[...railplot.ctl.engine.autoRuns.values()][0].running"))
    pg.click("text=Stop all trains") if pg.is_visible("text=Stop all trains") else None
    # the trip builder
    pg.click("button:has-text('New trip')"); pg.wait_for_timeout(150)
    pg.select_option("#trip-train", ex)
    dest = js(pg, """(() => { const c = railplot.p.control, e = railplot.ctl.engine, here = c.trains[1].block;
      const busy = new Set(c.trains.map(t => t.block));
      const next = e.topo.boundaries.filter(b => b.blocks.includes(here)).map(b => b.blocks.find(x => x !== here));
      return next.find(b => !busy.has(b)); })()""")
    pg.select_option("#trip-dest", dest); pg.wait_for_timeout(100)
    check("the trip builder finds ways there", pg.locator(".trip-ways input[type=radio]").count() >= 1)
    shot(pg, "10-trip")
    pg.click("button:has-text('Save and start')"); pg.wait_for_timeout(15000)
    check("a trip takes the express to its destination", js(pg, "railplot.p.control.trains[1].block") == dest, js(pg, "JSON.stringify([...railplot.ctl.engine.autoRuns])"))
    # the step editor
    n0 = js(pg, "railplot.p.control.automations[0].steps.length")
    pg.locator(".auto-row button:has-text('Edit')").first.click(); pg.wait_for_timeout(150)
    pg.click("button:has-text('Add step')")
    pg.select_option(f"#sk-{n0}", "light")
    shot(pg, "11-steps")
    pg.click(".dialog button:has-text('Save')"); pg.wait_for_timeout(100)
    check("the step editor adds a step", js(pg, "railplot.p.control.automations[0].steps.length") == n0 + 1 and js(pg, f"railplot.p.control.automations[0].steps[{n0}].do") == "light")
    # DCC-EX in Set up
    pg.click("button[role=tab]:has-text('Set up')"); pg.wait_for_timeout(100)
    pg.click("button:has-text('Add DCC-EX')"); pg.wait_for_timeout(100)
    did = js(pg, "railplot.p.control.controllers.find(c => c.kind === 'dccex').id")
    check("a DCC-EX controller can be added", did is not None and pg.locator(f"#cc-{did}").count() == 1)
    bid = js(pg, "railplot.p.control.blocks[0].id")
    pg.select_option(f"#bctl-{bid}", did); pg.wait_for_timeout(100)
    check("its outputs are named by track letter", pg.locator(f"#bc-{bid} option:has-text('Track H')").count() == 1)
    check("Set up warns about joints between DCC-EX and other blocks", pg.locator(".warn-note:has-text('never be bridged')").count() >= 1)
    pg.keyboard.press("Control+z"); pg.wait_for_timeout(100)
    pg.keyboard.press("c")
    check("C goes back to editing", js(pg, "railplot.mode") == "design")

    # narrow screen
    pg.set_viewport_size({"width": 400, "height": 760})
    pg.wait_for_timeout(300)
    check("no horizontal page scroll at phone width", js(pg, "document.documentElement.scrollWidth <= window.innerWidth"))
    shot(pg, "07-phone")

    check("no page errors", not errors, errors[:3])
    b.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
