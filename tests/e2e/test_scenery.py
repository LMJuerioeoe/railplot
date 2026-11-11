"""End-to-end click-through of scenery, the room, themes, the outline export and scenery in 3D, in headless Chromium.

Run:  bun run build && python3 tests/e2e/test_scenery.py [screenshot-dir]
"""
import os, sys
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

def to_screen(pg, x, y):
    return pg.evaluate("""([x,y]) => { const a = window.railplot; const r = a.canvas.getBoundingClientRect();
      return { x: r.left + a.view.ox + x * a.view.s, y: r.top + a.view.oy - y * a.view.s }; }""", [x, y])

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1400, "height": 860}, color_scheme="light", accept_downloads=True)
    ctx.add_init_script("delete window.showSaveFilePicker;")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(URL)
    pg.wait_for_timeout(500)
    js = pg.evaluate

    # S01 the scenery list
    pg.click("#tb-scenery")
    check("scenery list shows every group", pg.locator(".lib-group").count() >= 6 and pg.locator(".obj-tile").count() >= 30, str(pg.locator(".obj-tile").count()))
    check("tiles carry a drawn picture", js("[...document.querySelectorAll('.obj-thumb')].every(c => c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(v => v > 0))"))
    pg.fill("#lib-filter", "signal")
    check("the filter narrows the list", 2 <= pg.locator(".obj-tile").count() <= 5)
    pg.fill("#lib-filter", "")

    # S02 place a station, edit it in Details
    pg.click('[data-object="scenery/station"]')
    check("station added and selected", js("railplot.p.objects.length") == 1 and js("railplot.sel.size") == 1)
    check("Details shows the station", "Station building" in pg.inner_text("#insp-main"))
    pg.fill("#ob-w", "300"); pg.press("#ob-w", "Enter"); pg.locator("#ob-w").blur()
    check("length can be changed", js("railplot.p.objects[0].w") == 300)
    pg.locator(".sw").nth(1).click()
    check("colour can be changed", js("!!railplot.p.objects[0].color"))
    o = js("railplot.p.objects[0]")
    a = to_screen(pg, o["x"], o["y"]); dst = to_screen(pg, 1000, 560)
    pg.mouse.move(a["x"], a["y"]); pg.mouse.down(); pg.mouse.move(dst["x"], dst["y"], steps=6); pg.mouse.up()
    o2 = js("railplot.p.objects[0]")
    check("scenery drags to a new place", abs(o2["x"] - 1000) < 8 and abs(o2["y"] - 560) < 8, str(o2))
    pg.keyboard.press("Shift+R")
    check("R turns it", abs(js("railplot.p.objects[0].rot")) > 0.1)
    shot(pg, "s01-station")

    # S03 a buffer stop needs an open end; an engine shed follows the track it is dropped on
    pg.click("#tb-scenery")
    pg.click('[data-object="scenery/engine-shed"]')
    v = js("railplot.p.objects[1]")
    t = js("(() => { const g = railplot.p.items.find(i => i.part.endsWith('ST-201') || i.part.endsWith('ST-200')); return { x: g.x, y: g.y }; })()")
    a = to_screen(pg, v["x"], v["y"]); dst = to_screen(pg, t["x"] + 30, t["y"] + 12)
    pg.mouse.move(a["x"], a["y"]); pg.mouse.down(); pg.mouse.move(dst["x"], dst["y"], steps=6); pg.mouse.up()
    v2 = js("railplot.p.objects[1]")
    check("an engine shed dropped on track sits on it", v2.get("onTrack") is True, str(v2))
    check("Details says it is on track", "Standing on track" in pg.inner_text("#insp-main"))
    pg.keyboard.press("Control+z")
    check("undo takes the move back", js("railplot.p.objects[1].onTrack") is None)
    pg.keyboard.press("Control+y")
    pg.keyboard.press("Delete")
    check("Delete removes the selected item", js("railplot.p.objects.length") == 1)

    # S04 plan style and theme
    check("plan starts in the realistic style", js("railplot.planStyle") == "real")
    pg.click("text=View"); pg.click("text=Realistic track and boards")
    check("View menu switches to the diagram style", js("railplot.planStyle") == "diagram")
    shot(pg, "s02-diagram")
    pg.click("text=View"); pg.click("text=Realistic track and boards")
    pg.click("#tb-theme"); pg.click("#tb-theme")
    check("theme button reaches the dark theme", js("document.documentElement.dataset.theme") == "dark" and js("railplot.pal.dark") is True)
    shot(pg, "s03-dark")

    # S04b baseboard outlines for planning scenery by hand
    pg.click("text=File"); pg.click("text=Export baseboard outlines for scenery (PDF)…")
    check("outline dialog says what will print", "One landscape page at 1:" in pg.inner_text("#ol-info"), pg.inner_text("#ol-info"))
    pg.select_option("#ol-scale", "5")
    check("a larger scale needs more pages", " pages (" in pg.inner_text("#ol-info"), pg.inner_text("#ol-info"))
    pg.select_option("#ol-scale", "fit")
    with pg.expect_download() as dl:
        pg.click("text=Save the PDF")
    path = dl.value.path()
    head = open(path, "rb").read(8)
    check("a PDF is saved", head.startswith(b"%PDF-1.4") and dl.value.suggested_filename.endswith("baseboard outlines.pdf"), dl.value.suggested_filename)
    if SHOTS:
        import shutil; shutil.copy(path, os.path.join(SHOTS, "outlines.pdf"))

    # S05 the room
    pg.click("text=Tools"); pg.click("text=Room…")
    pg.fill("#room-bh", "830"); pg.check("#room-open-0")
    pg.click("text=Add the room")
    r = js("railplot.p.room")
    check("room saved with its heights and open side", r is not None and r["boardHeight"] == 830 and r.get("open") == [0], str(r))

    # S06 3D: scenery and the room are in the scene
    pg.keyboard.press("Escape")
    n0 = js("(() => { const p = JSON.parse(JSON.stringify(railplot.p)); return 0; })()")
    js("railplot.toggle3d(true)")
    pg.wait_for_timeout(900)
    with_room = js("railplot.view3d.count")
    size = js("railplot.view3d.snapshot().then(b => b.size)")
    check("3D picture is not blank", size > 40000, str(size))
    shot(pg, "s04-3d-room")
    pg.uncheck("#v3-room"); pg.wait_for_timeout(300)
    without_room = js("railplot.view3d.count")
    check("Room switches the room off in 3D", without_room < with_room, f"{with_room} -> {without_room}")
    pg.check("#v3-room"); pg.uncheck("#v3-legs"); pg.wait_for_timeout(300)
    check("Legs switches the legs off", without_room < js("railplot.view3d.count") < with_room)
    shot(pg, "s05-3d-no-legs")
    pg.click("text=Back to plan")
    check("back on the plan", js("railplot.mode3d") is False)
    check("no page errors", not errors, "; ".join(errors[:3]))
    b.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
