/**
 * THE OFFLINE PACK IS ONE FILE, AND THAT IS NOT A STYLE CHOICE.
 *
 * A page opened from `file://` has an opaque origin. It cannot `fetch()` a JSON
 * file sitting beside it, it cannot load a sibling stylesheet through a module
 * graph, and Chrome reports none of that as an error the reader would see — the
 * page simply comes up empty. So a zip of `index.html` + `assets/app.js` +
 * `data/assessment.json` LOOKS like the tidy answer and does not work at all
 * without a local web server, which is exactly what an offline pack is for not
 * needing.
 *
 * Everything is therefore inlined: the stylesheet, the fonts as `data:` URIs,
 * the compiled dashboard, and the assessment itself as a JSON island the script
 * reads out of the DOM. One file, double-clicked, no server, no network.
 *
 * This module is pure so `offline.test.ts` can assert the property that matters
 * — that nothing in the output reaches for the network — without building
 * anything.
 */
import type { OfflinePayload } from './payload';

/** Where the script finds its data. Shared with `entry.ts`; changing one breaks the pack. */
export const PAYLOAD_ELEMENT_ID = 'pa-payload';
/** Where the dashboard mounts. It carries `.policy-page`, which every chrome rule is scoped to. */
export const ROOT_ELEMENT_ID = 'pa-root';

export type OfflineShell = {
  /** The compiled dashboard, as an IIFE. */
  js: string;
  /** `app.css` plus every component's styles, as one stylesheet. */
  css: string;
  /** `@font-face` rules whose `src` is a `data:` URI. */
  fontCss: string;
};

/**
 * A `<script type="application/json">` block ends at the first `</script`, in
 * any case, and nothing else — the parser does not care about quoting. Escaping
 * `<` as `\u003c` is therefore sufficient AND necessary: an artefact quoting a
 * policy paper that contains the characters `</script>` would otherwise end the
 * island mid-assessment and spill the rest of the report into the page as text.
 *
 * U+2028 and U+2029 are legal in JSON strings and are line terminators in older
 * JavaScript parsers. They cost nothing to escape and a policy PDF is exactly
 * the kind of document that carries them.
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Text bound for markup rather than for a JSON island. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the pack's single page.
 *
 * `<title>` matters more here than on the web: this file lives in somebody's
 * Downloads folder next to eleven others, and the browser tab is how they tell
 * it apart.
 */
export function offlineHtml(payload: OfflinePayload, shell: OfflineShell): string {
  const title = `${payload.title} — policy assessment`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="generator" content="strangeramblings.com policy assessment — offline pack v${payload.version}">
<title>${escapeHtml(title)}</title>
<style>${shell.fontCss}</style>
<style>${shell.css}</style>
</head>
<body>
<div id="${ROOT_ELEMENT_ID}" class="policy-page"></div>
<script type="application/json" id="${PAYLOAD_ELEMENT_ID}">${embedJson(payload)}</script>
<script>${shell.js}</script>
<noscript><p style="font-family:system-ui,sans-serif;padding:2rem;max-width:60ch">This pack draws its charts, grids and drill-downs in the browser, so it needs JavaScript. The same assessment is in <code>report.docx</code> and <code>report.md</code> beside this file, and neither of those does.</p></noscript>
</body>
</html>
`;
}

/**
 * The `@font-face` block, from faces already read off disk.
 *
 * Without this the pack falls back per token: `--font-display` is
 * `'Archivo Black', Impact, sans-serif`, so every headline in an offline copy
 * would be set in Impact. That exact fallback shipped to production once when a
 * `@import` was silently dropped from the built CSS, and it is the reason the
 * faces are carried rather than linked.
 *
 * DM Sans and JetBrains Mono are variable, so one file covers the whole weight
 * range and is declared once. Declaring 400, 500 and 700 separately — which is
 * what Google's own stylesheet does — would put the same 36 KB in the pack three
 * times.
 */
export type EmbeddedFace = {
  family: string;
  /** A single weight (`400`) or a variable range (`100 1000`). */
  weight: string;
  base64: string;
};

export function fontFaceCss(faces: EmbeddedFace[]): string {
  return faces
    .map(
      (f) => `@font-face{font-family:'${f.family}';src:url(data:font/woff2;base64,${f.base64}) format('woff2');font-weight:${f.weight};font-style:normal;font-display:block;}`,
    )
    .join('\n');
}

/**
 * Drop `@font-face` rules whose file the pack does not carry.
 *
 * `app.css` self-hosts Selawik from `/fonts/selawik/*.woff2`. Inside a pack that
 * is a root-relative path with no root: the browser resolves it against the
 * filesystem, finds nothing, and moves on. Harmless, but it leaves three
 * references to files that are not there in a document whose whole promise is
 * that everything it needs is inside it — and the family is never used here
 * anyway, because `--font-read` belongs to /jkai and the blog.
 *
 * Only `url(/…)` faces are removed. A `data:` face is the pack's own, and a
 * relative one would be a bug this should surface rather than hide.
 */
export function stripUnresolvableFonts(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (block) => (/url\(\s*['"]?\//.test(block) ? '' : block));
}
