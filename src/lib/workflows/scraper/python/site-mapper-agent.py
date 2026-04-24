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
import asyncio, contextlib, io, json, sys, textwrap, time, traceback
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
    solved = False
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
                solved = True
                break
        except Exception:
            pass
        await asyncio.sleep(0.5)
    if not solved:
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
                    solved = True
                    break
            except Exception:
                pass
            await asyncio.sleep(0.5)
    if not solved:
        return False
    # After solve, many sites (CS Jobs included) require a click on a
    # "Continue" / submit button on the challenge form to actually proceed.
    # Auto-press the parent form's submit so the scout doesn't have to.
    try:
        handle = await widget.element_handle()
        if handle:
            await page.evaluate(
                """(w) => {
                  const form = w.closest('form');
                  if (!form) return false;
                  const btn = form.querySelector('button[type="submit"], input[type="submit"], button');
                  if (btn) { btn.click(); return true; }
                  if (form.requestSubmit) { form.requestSubmit(); return true; }
                  form.submit?.();
                  return true;
                }""",
                handle,
            )
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
    except Exception:
        pass
    return True


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
              function isHidden(el) {
                if (!el) return true;
                if (el.hasAttribute('hidden')) return true;
                if (el.getAttribute('aria-hidden') === 'true') return true;
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return true;
                const cs = window.getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return true;
                return false;
              }
              // Walk the ancestor chain looking for a collapsed container. A
              // collapsed container is usually <details> (with no `open`), an
              // element with aria-hidden=true, or a hidden block whose
              // expander button references it via aria-controls / data-target.
              function collapsedAncestor(el) {
                let cur = el.parentElement;
                while (cur && cur !== document.body) {
                  if (cur.tagName === 'DETAILS' && !cur.hasAttribute('open')) return cur;
                  if (cur.getAttribute('aria-hidden') === 'true') return cur;
                  // Walk upwards until we find a hidden block — that's the
                  // collapsed panel the user would have to expand to reveal
                  // the input. Skip the element itself (isHidden === true for
                  // the input is what brought us here).
                  if (isHidden(cur)) return cur;
                  cur = cur.parentElement;
                }
                return null;
              }
              // For a collapsed container, try to identify the toggle button
              // that would expand it — so the LLM knows WHAT to click next.
              function findToggleFor(container) {
                if (!container) return null;
                // <details> → its <summary>
                if (container.tagName === 'DETAILS') {
                  const s = container.querySelector(':scope > summary');
                  if (s) return s;
                }
                // aria-controls="<id>" on any button/link in the document
                const id = container.id;
                if (id) {
                  const btn = document.querySelector(
                    `[aria-controls="${CSS.escape(id)}"], [data-target="#${CSS.escape(id)}"], [href="#${CSS.escape(id)}"]`
                  );
                  if (btn) return btn;
                }
                // Fallback: a sibling button preceding the container.
                let sib = container.previousElementSibling;
                while (sib) {
                  if (sib.tagName === 'BUTTON' || sib.tagName === 'A') return sib;
                  const inner = sib.querySelector?.('button, a');
                  if (inner) return inner;
                  sib = sib.previousElementSibling;
                }
                return null;
              }
              const out = [];
              const expandables = [];
              const seenToggleSelectors = new Set();
              // Forms + their relevant descendants
              for (const form of Array.from(document.querySelectorAll('form'))) {
                // Show the form if it's visible OR if it contains inputs the
                // user's query would need (we annotate hidden inputs rather
                // than dropping them — the LLM needs to know the slot exists).
                const allInputs = Array.from(form.querySelectorAll('input, textarea, select'));
                if (allInputs.length === 0 && !visible(form)) continue;
                const formSel = bestSelector(form) || 'form';
                const inputs = allInputs.slice(0, 40).map(el => {
                  const hidden = isHidden(el);
                  const collapsed = hidden ? collapsedAncestor(el) : null;
                  const toggle = collapsed ? findToggleFor(collapsed) : null;
                  const toggleSel = toggle ? bestSelector(toggle) : null;
                  const toggleText = toggle ? (toggle.innerText || toggle.textContent || '').trim().slice(0, 60) : null;
                  if (toggleSel && !seenToggleSelectors.has(toggleSel)) {
                    seenToggleSelectors.add(toggleSel);
                    expandables.push({
                      text: toggleText || '(toggle)',
                      selector: toggleSel,
                      expanded: false,
                      reveals_inputs: [],
                    });
                  }
                  const rec = {
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
                  };
                  if (hidden) rec.hidden = true;
                  if (toggleSel) {
                    rec.reveal_via = { selector: toggleSel, text: toggleText };
                    // Tag the expandable entry for the LLM's benefit.
                    const exp = expandables.find(e => e.selector === toggleSel);
                    if (exp && rec.name) exp.reveals_inputs.push(rec.name);
                  }
                  return rec;
                });
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
              // Append expandables as a pseudo-kind so the LLM can see them
              // inline alongside forms/buttons.
              for (const exp of expandables) {
                out.push({ kind: 'expandable', ...exp });
              }
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
                elif cmd == "exec_script":
                    # Run an LLM-authored Python scrape function inside the
                    # warm Playwright session. The `code` parameter is the
                    # body of an async function `scrape(page, vars)` — the
                    # author writes vanilla Python with await page.* calls
                    # and `return [...]` of items. We wrap, exec, await,
                    # and report items + stdout/stderr/error back to the
                    # caller. The page state persists across exec_script
                    # calls (so the LLM can iterate without losing cookies
                    # or solved captchas).
                    #
                    # Altcha auto-handling: we patch page.goto via a proxy
                    # so every navigation runs try_altcha once after the
                    # target URL settles. The LLM's script can then fill
                    # form fields immediately after a goto without seeing
                    # the "Quick Check Needed" interstitial.
                    code = msg.get("code") or ""
                    vars_arg = msg.get("vars") or {}
                    captured_stdout = io.StringIO()
                    captured_stderr = io.StringIO()
                    items: List[Any] = []
                    err_str: Optional[str] = None

                    class _GotoProxy:
                        def __init__(self, p):
                            self._p = p
                        def __getattr__(self, name):
                            return getattr(self._p, name)
                        async def goto(self, *args, **kwargs):
                            r = await self._p.goto(*args, **kwargs)
                            try:
                                await try_altcha(self._p)
                                await self._p.wait_for_load_state("networkidle", timeout=5000)
                            except Exception:
                                pass
                            return r
                    scripted_page = _GotoProxy(page)

                    # An explicit `solve_altcha()` helper the script can call
                    # ad-hoc (e.g. after a submit that triggers a new challenge).
                    async def _solve_altcha():
                        try: await try_altcha(page)
                        except Exception: pass

                    try:
                        body = textwrap.indent(code, "    ")
                        wrapper = "async def __scrape(page, vars, solve_altcha):\n" + (body if body.strip() else "    return []") + "\n"
                        ns: Dict[str, Any] = {"asyncio": asyncio, "json": json}
                        exec(wrapper, ns)  # noqa: S102 — sandboxed by docker
                        with contextlib.redirect_stdout(captured_stdout), contextlib.redirect_stderr(captured_stderr):
                            # Pre-solve any altcha present from the previous
                            # command so a goto to the same URL isn't wasted.
                            await try_altcha(page)
                            result = await ns["__scrape"](scripted_page, vars_arg, _solve_altcha)
                        if isinstance(result, list):
                            items = result
                        elif result is not None:
                            err_str = f"scrape returned {type(result).__name__}, expected list"
                    except Exception as e:
                        err_str = f"{type(e).__name__}: {e}\n{traceback.format_exc()[-2000:]}"
                    sys.stdout.write(ok({
                        "items": items,
                        "stdout": captured_stdout.getvalue()[-4000:],
                        "stderr": captured_stderr.getvalue()[-4000:],
                        "error": err_str,
                        "observed_url": page.url,
                    }))
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
