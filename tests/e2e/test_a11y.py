"""Accessibility: an axe scan (WCAG 2.1 A and AA) of every screen and dialog, in the light and dark
themes, and the main things done with the keyboard alone.

Run:  bun install && bun run build && python3 tests/e2e/test_a11y.py
"""
import os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
URL = "file://" + os.path.join(ROOT, "dist", "index.html")
AXE = open(os.path.join(ROOT, "node_modules", "axe-core", "axe.min.js")).read()
CHROME = os.environ.get("CHROME")
failures = []

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond: failures.append(name)

def axe(pg, name, sel="body"):
    pg.evaluate(AXE)
    v = pg.evaluate("""async (sel) => (await axe.run(document.querySelector(sel), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }))
      .violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 4).join(', '))""", sel)
    check(f"axe: {name}", not v, v)

def close_dialogs(pg):
    for _ in range(3):
        if pg.locator(".dialog").count() == 0: break
        pg.keyboard.press("Escape"); pg.wait_for_timeout(120)

def dialog_scan(pg, name, open_js):
    pg.evaluate(open_js); pg.wait_for_timeout(250)
    if pg.locator(".dialog").count() == 0:
        check(f"{name} opens", False); return
    axe(pg, f"{name} dialog", ".scrim")
    close_dialogs(pg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME or None, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    for theme in ["light", "dark"]:
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, color_scheme=theme)
        ctx.route("https://api.github.com/**", lambda r: r.fulfill(json={"tag_name": "v0.0.1", "body": "", "assets": []}))
        pg = ctx.new_page(); errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(1200)
        t = f"[{theme}] "
        axe(pg, t + "plan with the first-run tour")
        pg.evaluate("document.querySelector('.tour .icon-btn')?.click()")
        # menus
        pg.get_by_role("button", name="File").first.click(); pg.wait_for_timeout(150)
        axe(pg, t + "File menu")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
        # a selected piece, with its details
        pg.evaluate("railplot.sel = new Set([railplot.p.items[0].id]); railplot.refresh()"); pg.wait_for_timeout(200)
        axe(pg, t + "plan with a piece selected")
        pg.evaluate("railplot.sel = new Set(); railplot.refresh()")
        for name, js in [("Parts list", "railplot.showPartsList()"), ("Print", "railplot.showPrint()"), ("Settings", "railplot.showPrefs()"),
                         ("Keyboard shortcuts", "railplot.showShortcuts()"), ("About", "railplot.showAbout()"), ("Connect Claude", "railplot.showClaudeHelp()"),
                         ("Shunting session", "railplot.showShunting()"), ("Rectangular baseboard", "railplot.showRectBoard()"), ("Examples", "railplot.showExamples()")]:
            dialog_scan(pg, t + name, js)
        # 3D view of the plan
        pg.evaluate("railplot.toggle3d(true)"); pg.wait_for_timeout(1200)
        axe(pg, t + "3D view")
        pg.evaluate("railplot.toggle3d(false)"); pg.wait_for_timeout(300)
        # Control: the two-train demo, each tab and its dialogs
        pg.evaluate("void railplot.openControlDemo()"); pg.wait_for_timeout(400)
        if pg.is_visible("text=Discard and open demo"): pg.get_by_text("Discard and open demo").click(); pg.wait_for_timeout(500)
        close_dialogs(pg)
        for tab in ["Drive", "Auto", "Set up"]:
            pg.click(f"button[role=tab]:has-text('{tab}')"); pg.wait_for_timeout(250)
            axe(pg, t + f"Control, {tab} tab")
        pg.click("button[role=tab]:has-text('Auto')"); pg.wait_for_timeout(200)
        for name, sel in [("New trip", "button:has-text('New trip')"), ("New timetable", "#new-timetable"), ("New automation", "button:has-text('New automation')"), ("New route", "button:has-text('New route')")]:
            pg.click(sel); pg.wait_for_timeout(250)
            axe(pg, t + f"{name} dialog", ".scrim")
            close_dialogs(pg)
        # driving in 3D: the HUD and the Trains dialog
        pg.click("button[role=tab]:has-text('Drive')"); pg.wait_for_timeout(200)
        pg.click("#drive-3d"); pg.wait_for_timeout(1500)
        axe(pg, t + "drive view")
        pg.keyboard.press("t"); pg.wait_for_timeout(300)
        axe(pg, t + "Trains dialog", ".scrim")
        close_dialogs(pg)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        check(t + "no page errors", not errors, errors[:3])
        ctx.close()

    # the keyboard alone: menus, dialogs and driving
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.goto(URL); pg.wait_for_timeout(1000)
    pg.evaluate("document.querySelector('.tour .icon-btn')?.click()")
    pg.keyboard.press("Control+p"); pg.wait_for_timeout(250)
    check("Ctrl+P opens Print with the focus in the dialog", pg.evaluate("!!document.activeElement.closest('.dialog')"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    check("Escape closes it", pg.locator(".dialog").count() == 0)
    # Tab reaches the menu bar, the toolbar and the plan, each showing where the focus is
    seen = set(); shown = True
    for _ in range(40):
        pg.keyboard.press("Tab")
        info = pg.evaluate("""(() => { const e = document.activeElement; if (!e || e === document.body) return null;
          const s = getComputedStyle(e); const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none';
          return [e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20) || e.tagName, ring]; })()""")
        if info: seen.add(info[0]); shown = shown and info[1]
    check("Tab moves through the menus, toolbar and plan", any("File" in s for s in seen) and any("plan" in s.lower() for s in seen), sorted(seen)[:12])
    check("every focused control shows a focus ring", shown)
    b.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
