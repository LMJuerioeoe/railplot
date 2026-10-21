import sys, asyncio
from playwright.sync_api import sync_playwright
url = "file:///home/claude/railplot/dist/index.html"
out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shot.png"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1400, "height": 860})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error","warning") else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    pg.goto(url)
    pg.wait_for_timeout(800)
    pg.screenshot(path=out)
    print("\n".join(errs) or "no console errors")
    b.close()
