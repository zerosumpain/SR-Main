/**
 * A second pass over the SVG Mermaid hands back.
 *
 * Mermaid at `securityLevel: 'strict'` already runs its output through
 * DOMPurify, and that is what stops `<script>`, `onerror=` and `javascript:`
 * hrefs — verified against all three. But DOMPurify's SVG profile permits
 * `<img>` and `<foreignObject>`, and the diagram source is written by a model,
 * so a label of `<img src=https://elsewhere/p.gif>` would survive as a
 * viewer-triggered request to a third party: a tracking pixel that leaks "this
 * thread was read", from what is meant to be a drawing.
 *
 * The chat's prose sanitiser (`sanitizeChatHtml`) allows no `<img>` at all, and
 * the diagram lane should not be the one permissive route into a chat message.
 * This closes it back to parity. Deliberately narrow: everything mermaid needs
 * to draw — paths, shapes, text, markers, `<use>` — is untouched.
 */

/** Elements a diagram never needs, and that fetch or embed when present.
 *  NOT `<use>`: mermaid draws arrowheads with it, and the only dangerous form
 *  (a `use` pointing at an external document) is already covered by the href
 *  pass below, which keeps fragment references and drops everything else. */
const FORBIDDEN = ['img', 'image', 'foreignObject', 'iframe', 'script'];

/**
 * Strip remote-fetching and HTML-embedding nodes from a rendered diagram.
 *
 * Runs in the browser against the string mermaid returned, before it reaches
 * `{@html}`. Parsed as XML rather than regexed: an attribute value containing
 * `>` defeats string matching, and mermaid's output is well-formed SVG.
 */
export function hardenDiagramSvg(svg: string): string {
  // Fails CLOSED. This only ever runs in the browser (the component renders in
  // onMount), so a missing DOMParser means an environment this filter cannot
  // vouch for — and an unfiltered diagram is exactly what it exists to prevent.
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return '';
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch {
    return '';
  }
  // A parse failure yields a <parsererror> document rather than throwing.
  if (doc.querySelector('parsererror')) return '';

  for (const tag of FORBIDDEN) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) el.remove();
    // SVG lives in its own namespace; `getElementsByTagName` on an XML document
    // is case-sensitive, so `foreignObject` and `foreignobject` both need a look.
    for (const el of Array.from(doc.getElementsByTagName(tag.toLowerCase()))) el.remove();
  }

  // Any link that leaves the document, in either the SVG 2 or the xlink spelling.
  for (const el of Array.from(doc.querySelectorAll('[href], [*|href]'))) {
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
    if (!href.startsWith('#')) {
      el.removeAttribute('href');
      el.removeAttribute('xlink:href');
    }
  }

  const root = doc.documentElement;
  return root ? new XMLSerializer().serializeToString(root) : '';
}
