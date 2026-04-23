# src/lib/workflows/scraper/python/scrape.py
"""
Playwright + stealth scraper runner.

Input:  JSON ScrapeJob on stdin
Output: JSON ScrapeResult on stdout
Progress: NDJSON lines on stderr (one event per line, each a {"t":"...", ...})

Runs inside the jkai-sandbox container. Profiles persist at /home/jkai/scraper-profiles/<profile>/.
"""
from __future__ import annotations
import asyncio, json, sys, os, random, re, time, traceback
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional

try:
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout
    from playwright_stealth import Stealth
except Exception as e:
    print(json.dumps({"success": False, "pages": [], "error": f"import failed: {e}"}))
    sys.exit(1)


PROFILES_BASE = Path("/home/jkai/scraper-profiles")

REALISTIC_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

DEFAULT_VIEWPORTS = [
    {"width": 1366, "height": 768},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1920, "height": 1080},
]


def emit_progress(event: Dict[str, Any]) -> None:
    sys.stderr.write(json.dumps(event) + "\n")
    sys.stderr.flush()


async def human_delay(min_ms: int, max_ms: int) -> None:
    await asyncio.sleep(random.uniform(min_ms / 1000, max_ms / 1000))


async def human_scroll(page, pacing: Dict[str, int]) -> None:
    for _ in range(random.randint(2, 3)):
        await page.mouse.wheel(0, random.randint(200, 600))
        await human_delay(pacing["minMs"], pacing["maxMs"])


async def detect_challenge(page) -> Dict[str, Any] | None:
    """Heuristic bot-wall / CAPTCHA / cookie-consent detection.
    Returns { reason, selector } on hit, None when the page looks clear.

    Signatures, in priority order:
      - Altcha (civilservicejobs uses this): <altcha-widget> custom element
      - Cloudflare: div#challenge-form, iframe[src*='challenges.cloudflare.com']
      - hCaptcha / reCaptcha: iframe[src*='hcaptcha'], iframe[src*='recaptcha']
      - Cookie consent walls blocking the DOM: common selectors + page text
    """
    checks = [
        ("altcha", "altcha-widget, [data-altcha]"),
        ("cloudflare", "iframe[src*='challenges.cloudflare.com'], div#challenge-form"),
        ("hcaptcha", "iframe[src*='hcaptcha.com']"),
        ("recaptcha", "iframe[src*='recaptcha'], iframe[title*='reCAPTCHA']"),
        ("cookie-consent", "#onetrust-consent-sdk, #cookie-consent-banner, [aria-label*='cookie consent' i]:not(:has(*))"),
        ("generic-challenge", "text=/verify\\s+you\\s+are\\s+human|please\\s+confirm\\s+you\\s+are\\s+not\\s+a\\s+robot|human\\s+verification/i"),
    ]
    for reason, sel in checks:
        try:
            if await page.locator(sel).count() > 0:
                return {"reason": reason, "selector": sel}
        except Exception:
            continue
    return None


async def resolve_extract(page, extract: Any) -> Dict[str, Any]:
    """Normalise extract config. Accepts:
       - list of rule objects → apply rules
       - 'page' / 'html' string → return full page html + text
       - None / missing → {url, title, html} as a sensible default
    LLM-generated configs often pass a string shorthand.
    """
    if isinstance(extract, list):
        return await apply_extract_rules(page, extract)
    html = await page.content()
    title = await page.title()
    if isinstance(extract, str) and extract in ('page', 'html'):
        return {"html": html, "title": title, "url": page.url}
    if isinstance(extract, str) and extract == 'text':
        text = await page.evaluate("() => document.body.innerText")
        return {"text": text, "title": title, "url": page.url}
    # Default: return the page snapshot so downstream nodes have something to work with.
    return {"html": html, "title": title, "url": page.url}


async def apply_extract_rules(page, rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for rule in rules:
        selector = rule["selector"]
        attr = rule.get("attr", "text")
        multi = bool(rule.get("multi", False))
        trim = rule.get("trim", True)
        regex_pat = rule.get("regex")
        locator = page.locator(selector)
        count = await locator.count()
        if count == 0:
            out[rule["field"]] = [] if multi else None
            continue

        async def pull(i: int) -> str:
            el = locator.nth(i)
            if attr == "text":
                return await el.text_content() or ""
            elif attr == "html":
                return await el.inner_html() or ""
            else:
                return await el.get_attribute(attr) or ""

        values: List[str] = []
        limit = count if multi else 1
        for i in range(limit):
            v = await pull(i)
            if trim:
                v = v.strip()
            if regex_pat:
                m = re.search(regex_pat, v)
                v = m.group(1) if m and m.groups() else ""
            values.append(v)
        out[rule["field"]] = values if multi else (values[0] if values else None)
    return out


async def wait_condition(page, wait_for: Any) -> None:
    # Accept three shapes so LLM-generated configs don't break the run:
    #   - a number (ms to sleep)
    #   - a string (CSS selector to wait for)
    #   - a {type, ...} object (structured, the canonical form)
    if isinstance(wait_for, (int, float)):
        await asyncio.sleep(float(wait_for) / 1000)
        return
    if isinstance(wait_for, str):
        await page.wait_for_selector(wait_for, timeout=20000)
        return
    if not isinstance(wait_for, dict):
        await page.wait_for_load_state("networkidle", timeout=30000)
        return
    t = wait_for.get("type", "networkidle")
    if t == "networkidle":
        await page.wait_for_load_state("networkidle", timeout=30000)
    elif t == "selector":
        await page.wait_for_selector(wait_for["selector"], timeout=wait_for.get("timeoutMs", 20000))
    elif t == "timeout":
        await asyncio.sleep(wait_for["ms"] / 1000)


async def do_login(page, cred: Dict[str, Any]) -> None:
    strategy = cred.get("loginStrategy", "form")
    if strategy == "cookie":
        cookies = cred.get("credential", {}).get("cookies", [])
        if cookies:
            await page.context.add_cookies(cookies)
        return
    if strategy != "form":
        emit_progress({"t": "login.skipped", "reason": f"unknown strategy {strategy}"})
        return
    login_url = cred.get("loginUrl")
    if not login_url:
        return
    emit_progress({"t": "login.start", "url": login_url})
    await page.goto(login_url, wait_until="domcontentloaded")
    user = cred["credential"].get("username")
    pw = cred["credential"].get("password")
    if user and pw:
        user_selectors = ['input[type="email"]', 'input[name*="user" i]', 'input[name*="email" i]',
                          'input[id*="user" i]', 'input[id*="email" i]']
        pw_selectors = ['input[type="password"]']
        for sel in user_selectors:
            if await page.locator(sel).count() > 0:
                await page.locator(sel).first.fill(user, timeout=5000)
                break
        for sel in pw_selectors:
            if await page.locator(sel).count() > 0:
                await page.locator(sel).first.fill(pw, timeout=5000)
                break
        await page.keyboard.press("Enter")
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except PWTimeout:
            pass
    emit_progress({"t": "login.done"})


async def run_job(job: Dict[str, Any]) -> Dict[str, Any]:
    profile = job["profile"]
    profile_dir = PROFILES_BASE / profile
    profile_dir.mkdir(parents=True, exist_ok=True)
    # Clean stale singleton locks left by a crashed previous run — Playwright
    # refuses to launch ("Failed to create ProcessSingleton") otherwise.
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"):
        try:
            (profile_dir / name).unlink()
        except FileNotFoundError:
            pass
        except Exception:
            pass
    pacing = job.get("pacing", {"minMs": 800, "maxMs": 2500})
    viewport = job.get("viewport") or random.choice(DEFAULT_VIEWPORTS)
    user_agent = job.get("userAgent") or REALISTIC_UA

    result = {"success": False, "pages": []}

    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=True,
            viewport=viewport,
            user_agent=user_agent,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        await Stealth().apply_stealth_async(context)

        page = await context.new_page()

        try:
            if job.get("_credential"):
                await do_login(page, job["_credential"])

            emit_progress({"t": "nav", "url": job["url"]})
            await page.goto(job["url"], wait_until="domcontentloaded")
            await wait_condition(page, job.get("waitFor", {"type": "networkidle"}))

            # Bot-wall / CAPTCHA check BEFORE extraction. If tripped, return a
            # structured signal that the Node-side executor will handle by
            # opening a VNC session on the same profile, pausing for human
            # solve, and retrying headlessly.
            challenge = await detect_challenge(page)
            if challenge is not None:
                emit_progress({"t": "challenge", **challenge})
                result = {
                    "success": False,
                    "pages": [],
                    "needsInteractive": True,
                    "challengeReason": challenge["reason"],
                    "currentUrl": page.url,
                }
                await context.close()
                return result

            await human_scroll(page, pacing)

            pages_collected = []

            fields = await resolve_extract(page, job.get("extract"))
            pages_collected.append({"url": page.url, "fields": fields})
            emit_progress({"t": "page.done", "url": page.url, "pageIndex": 0})

            pag = job.get("pagination")
            if pag:
                max_pages = pag["maxPages"]
                if pag["type"] == "next-link":
                    for i in range(1, max_pages):
                        next_loc = page.locator(pag["nextSelector"]).first
                        if await next_loc.count() == 0:
                            break
                        await human_delay(pacing["minMs"], pacing["maxMs"])
                        await next_loc.click()
                        await wait_condition(page, job.get("waitFor", {"type": "networkidle"}))
                        await human_scroll(page, pacing)
                        fields = await resolve_extract(page, job.get("extract"))
                        pages_collected.append({"url": page.url, "fields": fields})
                        emit_progress({"t": "page.done", "url": page.url, "pageIndex": i})
                elif pag["type"] == "url-template":
                    for i in range(pag["start"] + 1, pag["start"] + max_pages):
                        target = pag["template"].replace("{n}", str(i))
                        await human_delay(pacing["minMs"], pacing["maxMs"])
                        await page.goto(target, wait_until="domcontentloaded")
                        await wait_condition(page, job.get("waitFor", {"type": "networkidle"}))
                        fields = await resolve_extract(page, job.get("extract"))
                        pages_collected.append({"url": page.url, "fields": fields})
                        emit_progress({"t": "page.done", "url": page.url, "pageIndex": i})

            result = {"success": True, "pages": pages_collected}
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            result = {"success": False, "pages": [], "error": err}
            if job.get("screenshotOnFailure", True):
                shot = f"/tmp/scraper-failure-{int(time.time())}.png"
                try:
                    await page.screenshot(path=shot, full_page=True)
                    result["screenshotPathInSandbox"] = shot
                except Exception:
                    pass
            emit_progress({"t": "error", "error": err, "trace": traceback.format_exc()[-1500:]})
        finally:
            await context.close()

    return result


def main() -> None:
    raw = sys.stdin.read()
    job = json.loads(raw)
    res = asyncio.run(run_job(job))
    sys.stdout.write(json.dumps(res))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
