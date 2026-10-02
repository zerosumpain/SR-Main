"""A long-lived headless browser, driven over HTTP from the SvelteKit app.

Runs inside jkai-sandbox on homeserv, where Chromium and the residential IP
already live. One process holds one Playwright page for the life of a session,
so `navigate` then `click` then `snapshot` act on the SAME page — which is the
whole point, and the thing a one-shot script cannot do.

Deliberately stdlib-only for the HTTP part: the sandbox has no aiohttp and this
needs no dependency to serve half a dozen local routes.

Protocol: POST /<verb> with a JSON body, returns JSON {ok, ...}. Bound to
0.0.0.0 inside the container, which is reachable only on the docker bridge.
"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from playwright.sync_api import sync_playwright

IDLE_TIMEOUT_S = int(os.environ.get("BROWSER_IDLE_TIMEOUT", "900"))
MAX_TEXT = 40000

_state = {"last_used": time.time()}
_lock = threading.Lock()
_console: list[dict] = []


def _record_console(msg) -> None:
    # Bounded: a chatty page must not grow this without limit.
    if len(_console) >= 500:
        del _console[0]
    try:
        _console.append({"type": msg.type, "text": msg.text})
    except Exception:
        pass


class Browser:
    def __init__(self) -> None:
        self.pw = sync_playwright().start()
        profile = os.environ.get("BROWSER_PROFILE_DIR", "/home/jkai/browser-profile")
        os.makedirs(profile, exist_ok=True)
        self.ctx = self.pw.chromium.launch_persistent_context(
            profile,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
            viewport={"width": 1440, "height": 900},
        )
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.on("console", _record_console)
        self.page.on("pageerror", lambda e: _record_console_error(e))

    def close(self) -> None:
        try:
            self.ctx.close()
        finally:
            self.pw.stop()


def _record_console_error(err) -> None:
    if len(_console) >= 500:
        del _console[0]
    _console.append({"type": "pageerror", "text": str(err)})


BROWSER: Browser | None = None


def verb_navigate(b: Browser, args: dict) -> dict:
    url = (args.get("url") or "").strip()
    if not url:
        return {"ok": False, "error": "url is required"}
    _console.clear()  # a new page is a new console
    resp = b.page.goto(url, wait_until=args.get("waitUntil", "domcontentloaded"), timeout=45000)
    return {
        "ok": True,
        "url": b.page.url,
        "status": resp.status if resp else None,
        "title": b.page.title(),
    }


def _settle(page, before: str, ms: int = 2500) -> None:
    """Let a click land before we report where we are.

    `domcontentloaded` returns instantly on a client-side route change — the
    document never reloads — so reading the URL straight after a click on a
    SvelteKit page gives the OLD one. That is the page most often being debugged
    here, so wait briefly for the URL to actually move, then for the network to
    go quiet, and give up rather than hang if neither happens.
    """
    try:
        page.wait_for_url(lambda u: u != before, timeout=ms)
    except Exception:
        pass
    try:
        page.wait_for_load_state("networkidle", timeout=ms)
    except Exception:
        pass


def verb_click(b: Browser, args: dict) -> dict:
    sel = (args.get("selector") or "").strip()
    if not sel:
        return {"ok": False, "error": "selector is required"}
    before = b.page.url
    b.page.click(sel, timeout=int(args.get("timeoutMs", 10000)))
    _settle(b.page, before)
    return {
        "ok": True,
        "url": b.page.url,
        "title": b.page.title(),
        "navigated": b.page.url != before,
    }


def verb_type(b: Browser, args: dict) -> dict:
    sel = (args.get("selector") or "").strip()
    text = args.get("text")
    if not sel or text is None:
        return {"ok": False, "error": "selector and text are required"}
    before = b.page.url
    b.page.fill(sel, str(text), timeout=int(args.get("timeoutMs", 10000)))
    if args.get("submit"):
        b.page.keyboard.press("Enter")
        _settle(b.page, before)
    return {"ok": True, "url": b.page.url, "navigated": b.page.url != before}


def verb_scroll(b: Browser, args: dict) -> dict:
    dy = int(args.get("dy", 800))
    b.page.mouse.wheel(0, dy)
    return {"ok": True, "dy": dy}


def verb_snapshot(b: Browser, args: dict) -> dict:
    text = b.page.inner_text("body", timeout=10000)
    truncated = len(text) > MAX_TEXT
    links = b.page.eval_on_selector_all(
        "a[href]",
        "els => els.slice(0, 100).map(e => ({ text: (e.innerText||'').trim().slice(0,80), href: e.href }))",
    )
    return {
        "ok": True,
        "url": b.page.url,
        "title": b.page.title(),
        "text": text[:MAX_TEXT],
        "truncated": truncated,
        "links": links,
    }


def verb_console(b: Browser, args: dict) -> dict:
    level = args.get("level")
    entries = _console if not level else [e for e in _console if e["type"] == level]
    limit = int(args.get("limit", 100))
    return {"ok": True, "count": len(entries), "entries": entries[-limit:]}


def verb_get_images(b: Browser, args: dict) -> dict:
    imgs = b.page.eval_on_selector_all(
        "img[src]",
        "els => els.slice(0, 50).map(e => ({ src: e.src, alt: e.alt || null, w: e.naturalWidth, h: e.naturalHeight }))",
    )
    return {"ok": True, "count": len(imgs), "images": imgs}


VERBS = {
    "navigate": verb_navigate,
    "click": verb_click,
    "type": verb_type,
    "scroll": verb_scroll,
    "snapshot": verb_snapshot,
    "console": verb_console,
    "get_images": verb_get_images,
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # noqa: D401 - quiet
        pass

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "idleFor": round(time.time() - _state["last_used"])})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        global BROWSER
        verb = self.path.lstrip("/")
        if verb == "close":
            self._send(200, {"ok": True, "closing": True})
            threading.Thread(target=_shutdown, daemon=True).start()
            return
        fn = VERBS.get(verb)
        if not fn:
            self._send(404, {"ok": False, "error": f"unknown verb '{verb}'"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            args = json.loads(self.rfile.read(n) or b"{}")
        except Exception as exc:
            self._send(400, {"ok": False, "error": f"bad JSON: {exc}"})
            return
        with _lock:
            _state["last_used"] = time.time()
            try:
                if BROWSER is None:
                    BROWSER = Browser()
                self._send(200, fn(BROWSER, args))
            except Exception as exc:
                # Never leak a stack to the model; give it something actionable.
                self._send(200, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def _shutdown() -> None:
    time.sleep(0.2)
    if BROWSER:
        try:
            BROWSER.close()
        except Exception:
            pass
    os._exit(0)


def _reaper() -> None:
    # A forgotten session must not hold a Chromium open for ever.
    while True:
        time.sleep(30)
        if time.time() - _state["last_used"] > IDLE_TIMEOUT_S:
            _shutdown()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7800
    threading.Thread(target=_reaper, daemon=True).start()
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
