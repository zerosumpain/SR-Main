# src/lib/workflows/scraper/python/interactive.py
"""Interactive Playwright session launcher — headed Chromium with persistent profile.
Input: JSON {"profile":"<name>","url":"<url>"} on stdin.
Output: single {"status":"ready"} line on stdout once Chromium is up.
Waits on SIGTERM, then closes the Playwright context cleanly so session data flushes.
"""
from __future__ import annotations
import asyncio, json, signal, sys
from pathlib import Path

try:
    from playwright.async_api import async_playwright
except Exception as e:
    print(json.dumps({"status": "error", "error": f"import failed: {e}"}))
    sys.exit(1)

PROFILES_BASE = Path("/home/jkai/scraper-profiles")
REALISTIC_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

async def run(profile: str, url: str) -> None:
    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, shutdown.set)
    loop.add_signal_handler(signal.SIGINT, shutdown.set)

    profile_dir = PROFILES_BASE / profile
    profile_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            viewport=None,
            user_agent=REALISTIC_UA,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled", "--start-maximized"],
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            except Exception as e:
                sys.stderr.write(f"initial goto failed: {e}\n")
            sys.stdout.write(json.dumps({"status": "ready", "profile": profile}) + "\n")
            sys.stdout.flush()
            await shutdown.wait()
        finally:
            try:
                await context.close()
            except Exception as e:
                sys.stderr.write(f"context.close failed: {e}\n")

def main() -> None:
    raw = sys.stdin.read().strip()
    job = json.loads(raw)
    asyncio.run(run(job["profile"], job.get("url") or "about:blank"))

if __name__ == "__main__":
    main()
