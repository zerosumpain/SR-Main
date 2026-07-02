// sanitize.ts — DOM-free HTML sanitizer for the Author's contenteditable sections.
// Allowlist only; unknown tags are unwrapped (text kept), script/style content is
// dropped entirely, attributes are stripped except a[href] with http(s) schemes.
// DOM-free so it runs identically in the browser, on the server and under vitest.

const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote']);
const VOID = new Set(['br']);
const DROP_CONTENT = new Set(['script', 'style', 'head', 'iframe', 'object', 'noscript', 'svg', 'math', 'template']);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>|<!--[\s\S]*?-->/g;

function safeHref(attrs: string): string | null {
  const m = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const raw = m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
  const href = raw.trim();
  if (/^https?:\/\//i.test(href)) return href.replace(/"/g, '%22');
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return null;
}

/** Escape any raw angle brackets / stray ampersands left in a text node. */
function escapeText(text: string): string {
  return text.replace(/&(?![a-zA-Z#][a-zA-Z0-9]{0,10};)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeHtml(html: string): string {
  let out = '';
  let last = 0;
  let dropDepth = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html))) {
    const text = html.slice(last, m.index);
    if (dropDepth === 0 && text) out += escapeText(text);
    last = TAG_RE.lastIndex;

    const full = m[0];
    if (full.startsWith('<!--')) continue; // comment — drop
    const name = (m[1] ?? '').toLowerCase();
    const closing = full.startsWith('</');

    if (DROP_CONTENT.has(name)) {
      dropDepth = Math.max(0, dropDepth + (closing ? -1 : 1));
      continue;
    }
    if (dropDepth > 0) continue;
    if (!ALLOWED.has(name)) continue; // unwrap: drop the tag, keep surrounding text

    if (closing) {
      if (!VOID.has(name)) out += `</${name}>`;
    } else if (name === 'a') {
      const href = safeHref(m[2] ?? '');
      out += href ? `<a href="${href}">` : '<a>';
    } else {
      out += VOID.has(name) ? `<${name}>` : `<${name}>`;
    }
  }
  const tail = html.slice(last);
  if (dropDepth === 0 && tail) out += escapeText(tail);
  return out;
}
