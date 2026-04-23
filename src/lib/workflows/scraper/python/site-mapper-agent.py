# Persistent browser harness for the site-mapper agent loop AND for
# replaying saved playbooks. Reads JSON commands from stdin one per line,
# writes a JSON response per command to stdout. Stays alive until it
# receives {"cmd":"close"} or stdin closes.
#
# The Node side drives the LLM loop + passes tool calls through; this
# Python process never talks to an LLM itself — it's just a controllable
# Chromium session.
#
# Commands (all take { "cmd": "<name>", ... }):
#   goto(url)                          → { url, title }
#   wait({selector?, ms?, timeoutMs?}) → { ok }
#   click(selector | text)             → { url, title }
#   fill(selector, value)              → { ok }
#   select(selector, value)            → { ok }
#   submit(formSelector?)              → { url, title }
#   altcha()                           → { solved: bool }
#   observe()                          → { url, title, html_snippet, interactive: [...] }
#   extract(rules)                     → { fields }  (same shape as apply_extract_rules)
#   close()                            → { bye: true } then exits
from __future__ import annotations
import asyncio, json, sys, time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from playwright.async_api import async_playwright
    from playwright_stealth import Stealth
except Exception as e:
    sys.stdout.write(json.dumps({"fatal": f"import failed: {e}"}) + "\n")
    sys.stdout.flush()
    sys.exit(1)

PROFILES_BASE = Path("/home/jkai/scraper-profiles")
REALISTIC_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


def ok(resp: Dict[str, Any]) -> str:
    return json.dumps({"ok": True, **resp}) + "\n"


def err(message: str) -> str:
    return json.dumps({"ok": False, "error": message}) + "\n"


async def try_altcha(page) -> bool:
    widget = page.locator("altcha-widget").first
    try:
        if await widget.count() == 0:
            return False
    except Exception:
        return False
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            handle = await widget.element_handle()
            if handle and await page.evaluate(
                """(w) => {
                  if (!w) return false;
                  const state = w.getAttribute('data-state') || w.getAttribute('state');
                  if (state === 'verified' || state === 'ok' || state === 'solved') return true;
                  if (w.verified === true) return true;
                  if (typeof w.value === 'string' && w.value.length > 20) return true;
                  const form = w.closest('form');
                  const input = form?.querySelector('input[name*="altcha" i]');
                  return !!(input && input.value && input.value.length > 20);
                }""",
                handle,
            ):
                return True
        except Exception:
            pass
        await asyncio.sleep(0.5)
    # Try clicking to start the PoW if needed.
    try:
        await widget.click(timeout=2000)
    except Exception:
        pass
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            handle = await widget.element_handle()
            if handle and await page.evaluate(
                """(w) => {
                  const form = w.closest('form');
                  const input = form?.querySelector('input[name*="altcha" i]');
                  return !!(input && input.value && input.value.length > 20);
                }""",
                handle,
            ):
                return True
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return False


# Actions that wait for a DOM element (fill/click/select) default to this.
# 8s was too aggressive during replay — cold render + altcha settle can
# eat 10s+ on civilservicejobs-like pages.
ACTION_TIMEOUT_MS = 30000


async def observe(page) -> Dict[str, Any]:
    """Summarise the current page for the LLM — url/title, short text snippet,
    and a pruned list of interactive elements with stable selectors."""
    html_snippet = ""
    title = ""
    url = page.url
    try:
        title = await page.title()
    except Exception:
        pass
    try:
        # A text rendering keeps the context tight (headlines / prompts) while
        # letting the LLM spot "Search" or "Find jobs" type cues. Cap hard.
        text = await page.evaluate("() => document.body.innerText")
        html_snippet = (text or "")[:6000]
    except Exception:
        pass

    # Repeated-content clusters: for each CSS class that appears on 3+
    # elements at the same DOM depth, sample one's text. This is how the
    # LLM spots job-listing / card / row containers without seeing raw HTML,
    # so it can pick correct extract selectors. Returned separately from
    # `interactive` so the LLM doesn't confuse content with actions.
    content_groups: List[Dict[str, Any]] = []
    try:
        content_groups = await page.evaluate(
            """() => {
              const byClass = new Map();
              const all = Array.from(document.querySelectorAll('[class]'));
              for (const el of all) {
                if (!el.className || typeof el.className !== 'string') continue;
                const rect = el.getBoundingClientRect();
                if (rect.width < 50 || rect.height < 20) continue;
                for (const cls of el.className.trim().split(/\\s+/)) {
                  if (!cls || /[0-9a-f]{4,}$/i.test(cls) || cls.length < 3) continue;
                  if (!byClass.has(cls)) byClass.set(cls, []);
                  byClass.get(cls).push(el);
                }
              }
              const out = [];
              for (const [cls, els] of byClass) {
                if (els.length < 3 || els.length > 60) continue;
                // Skip classes whose elements are just text nodes (<span>, <a>)
                // — more likely content rows are <li>, <tr>, <div>, <article>.
                const tags = new Set(els.map(e => e.tagName.toLowerCase()));
                const container = els.filter(e => ['li','tr','div','article','section'].includes(e.tagName.toLowerCase()));
                if (container.length < 3) continue;
                const sample = container[0];
                out.push({
                  selector: '.' + cls,
                  count: els.length,
                  tag: sample.tagName.toLowerCase(),
                  sample_text: (sample.innerText || '').trim().slice(0, 240),
                });
              }
              // Sort: more matches first, then shorter text snippets
              // (row-shaped cards usually short)
              return out.sort((a, b) => b.count - a.count).slice(0, 8);
            }"""
        )
    except Exception as e:
        content_groups = [{"error": str(e)}]

    # Interactive elements: forms (with their inputs + submits), standalone
    # buttons, top links. All enriched with a best-effort CSS selector.
    elements: List[Dict[str, Any]] = []
    try:
        elements = await page.evaluate(
            """() => {
              // Ids that look auto-generated per session (trailing hex/random
              // suffix like "_50f4", "-abcd1234", etc.) are not stable — the
              // mapper agent should avoid picking those because the replay will
              // see a different id. Prefer [name=...], then tag+classname.
              function looksUnstableId(id) {
                return /[_-][0-9a-f]{4,}$/i.test(id) || /\\d{6,}$/.test(id);
              }
              function bestSelector(el) {
                if (!el || el.nodeType !== 1) return '';
                if (el.id && !looksUnstableId(el.id)) return '#' + CSS.escape(el.id);
                const name = el.getAttribute('name');
                if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
                const cls = (el.className || '').trim().split(/\\s+/).filter(Boolean).filter(c => !looksUnstableId(c)).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
                // If we ended up with nothing stable, fall back to the unstable
                // id rather than a bare tag name — something is better than a
                // `div` selector that matches hundreds of elements.
                if (!cls && el.id) return '#' + CSS.escape(el.id);
                return `${el.tagName.toLowerCase()}${cls}`;
              }
              function visible(el) {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              }
              const out = [];
              // Forms + their relevant descendants
              for (const form of Array.from(document.querySelectorAll('form'))) {
                if (!visible(form)) continue;
                const formSel = bestSelector(form) || 'form';
                const inputs = Array.from(form.querySelectorAll('input, textarea, select'))
                  .filter(visible).slice(0, 20).map(el => ({
                    kind: el.tagName.toLowerCase(),
                    type: el.getAttribute('type') || '',
                    name: el.getAttribute('name') || '',
                    placeholder: el.getAttribute('placeholder') || '',
                    label: (() => {
                      const id = el.getAttribute('id');
                      if (id) {
                        const lab = document.querySelector(`label[for="${id}"]`);
                        if (lab) return (lab.textContent || '').trim().slice(0, 80);
                      }
                      return '';
                    })(),
                    selector: bestSelector(el),
                  }));
                const submits = Array.from(form.querySelectorAll('button, input[type=submit]'))
                  .filter(visible).slice(0, 4).map(el => ({
                    text: (el.innerText || el.value || '').trim().slice(0, 40),
                    selector: bestSelector(el),
                  }));
                out.push({ kind: 'form', selector: formSel, inputs, submits });
              }
              // Stand-alone buttons / links that look action-y
              const loose = Array.from(document.querySelectorAll('a, button'))
                .filter(el => visible(el) && !el.closest('form'))
                .slice(0, 30)
                .map(el => ({
                  kind: el.tagName.toLowerCase(),
                  text: (el.innerText || '').trim().slice(0, 80),
                  href: el.getAttribute('href') || '',
                  selector: bestSelector(el),
                }))
                .filter(el => el.text.length > 0);
              out.push(...loose);
              return out;
            }"""
        )
    except Exception as e:
        elements = [{"error": str(e)}]

    return {
        "url": url,
        "title": title,
        "text_snippet": html_snippet,
        "interactive": elements,
        "content_groups": content_groups,
    }


async def apply_extract_rules(page, rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for rule in rules:
        selector = rule.get("selector", "")
        field = rule.get("field", "value")
        attr = rule.get("attr", "text")
        multi = bool(rule.get("multi", False))
        trim = rule.get("trim", True)
        loc = page.locator(selector)
        count = await loc.count()
        if count == 0:
            out[field] = [] if multi else None
            continue
        limit = count if multi else 1
        values: List[str] = []
        for i in range(min(limit, 200)):
            el = loc.nth(i)
            if attr == "text":
                v = await el.text_content() or ""
            elif attr == "html":
                v = await el.inner_html() or ""
            else:
                v = await el.get_attribute(attr) or ""
            if trim:
                v = v.strip()
            values.append(v)
        out[field] = values if multi else values[0]
    return out


async def run_agent(profile: str) -> None:
    profile_dir = PROFILES_BASE / profile
    profile_dir.mkdir(parents=True, exist_ok=True)
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"):
        try:
            (profile_dir / name).unlink()
        except FileNotFoundError:
            pass
        except Exception:
            pass

    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=True,
            viewport={"width": 1280, "height": 860},
            user_agent=REALISTIC_UA,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        await Stealth().apply_stealth_async(context)
        page = context.pages[0] if context.pages else await context.new_page()

        # Announce ready.
        sys.stdout.write(ok({"ready": True, "profile": profile}))
        sys.stdout.flush()

        loop = asyncio.get_running_loop()
        while True:
            # Read one JSON command per line from stdin.
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception as e:
                sys.stdout.write(err(f"bad json: {e}"))
                sys.stdout.flush()
                continue
            cmd = msg.get("cmd")
            try:
                if cmd == "goto":
                    await page.goto(msg["url"], wait_until="domcontentloaded", timeout=30000)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15000)
                    except Exception:
                        pass
                    sys.stdout.write(ok({"url": page.url, "title": await page.title()}))
                elif cmd == "wait":
                    sel = msg.get("selector")
                    ms = msg.get("ms")
                    if sel:
                        await page.wait_for_selector(sel, timeout=msg.get("timeoutMs", 15000))
                    elif ms is not None:
                        await asyncio.sleep(ms / 1000)
                    else:
                        await page.wait_for_load_state("networkidle", timeout=15000)
                    sys.stdout.write(ok({"url": page.url}))
                elif cmd == "click":
                    sel = msg.get("selector") or ""
                    text = msg.get("text") or ""
                    timeout = msg.get("timeoutMs", ACTION_TIMEOUT_MS)
                    if sel:
                        # Explicit wait_for before click so we don't hit a
                        # "not attached" race when the prior step triggers
                        # an async re-render (post-altcha / post-submit).
                        try:
                            await page.wait_for_selector(sel, timeout=timeout, state="visible")
                        except Exception:
                            pass
                        await page.locator(sel).first.click(timeout=timeout)
                    elif text:
                        await page.get_by_text(text, exact=False).first.click(timeout=timeout)
                    else:
                        raise Exception("click requires selector or text")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15000)
                    except Exception:
                        pass
                    sys.stdout.write(ok({"url": page.url, "title": await page.title()}))
                elif cmd == "fill":
                    sel = msg["selector"]
                    timeout = msg.get("timeoutMs", ACTION_TIMEOUT_MS)
                    try:
                        await page.wait_for_selector(sel, timeout=timeout, state="visible")
                    except Exception:
                        pass
                    await page.locator(sel).first.fill(msg["value"], timeout=timeout)
                    sys.stdout.write(ok({}))
                elif cmd == "select":
                    sel = msg["selector"]
                    timeout = msg.get("timeoutMs", ACTION_TIMEOUT_MS)
                    try:
                        await page.wait_for_selector(sel, timeout=timeout, state="attached")
                    except Exception:
                        pass
                    await page.locator(sel).first.select_option(msg["value"], timeout=timeout)
                    sys.stdout.write(ok({}))
                elif cmd == "submit":
                    form_sel = msg.get("formSelector")
                    if form_sel:
                        # Find a submit-button inside this form and click it.
                        loc = page.locator(f"{form_sel} button[type=submit], {form_sel} input[type=submit]").first
                        if await loc.count() == 0:
                            # Fall back to form.requestSubmit()
                            await page.evaluate(
                                "(sel) => document.querySelector(sel)?.requestSubmit?.()",
                                form_sel,
                            )
                        else:
                            await loc.click(timeout=8000)
                    else:
                        # No form selector — press Enter on active element.
                        await page.keyboard.press("Enter")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=20000)
                    except Exception:
                        pass
                    sys.stdout.write(ok({"url": page.url, "title": await page.title()}))
                elif cmd == "altcha":
                    solved = await try_altcha(page)
                    # After solve, the form may re-render or the page may
                    # auto-submit. Give it a moment to settle so the next
                    # fill/click doesn't race with post-altcha DOM updates.
                    try:
                        await page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass
                    sys.stdout.write(ok({"solved": solved}))
                elif cmd == "observe":
                    sys.stdout.write(ok(await observe(page)))
                elif cmd == "extract":
                    rules = msg.get("rules") or []
                    sys.stdout.write(ok({"fields": await apply_extract_rules(page, rules)}))
                elif cmd == "close":
                    sys.stdout.write(ok({"bye": True}))
                    sys.stdout.flush()
                    break
                else:
                    sys.stdout.write(err(f"unknown command: {cmd}"))
                sys.stdout.flush()
            except Exception as e:
                sys.stdout.write(err(str(e)))
                sys.stdout.flush()

        try:
            await context.close()
        except Exception:
            pass


def main() -> None:
    raw = sys.stdin.readline()
    try:
        init = json.loads(raw)
    except Exception:
        init = {}
    profile = init.get("profile") or "default"
    asyncio.run(run_agent(profile))


if __name__ == "__main__":
    main()
