// src/lib/jkai/code-blocks.ts
// Fenced-code rendering for the chat thread: syntax highlighting, plus the
// toolbar that turns a block into something you can copy or run.
//
// Highlighter choice is forced by the sanitiser, not by taste. `sanitizeChatHtml`
// permits `class` on span/code/pre and **no `style` attribute at all**, so shiki
// — which colours via inline `style="--shiki-light:…"` — would be stripped down
// to grey text here. highlight.js emits class-only markup, which survives intact,
// and `src/lib/blog/renderer.ts` already pairs it with `marked` the same way.
// Shiki stays the right tool for the canvas/deck components, which render
// through a component and never meet this sanitiser.

import hljs from '$lib/highlight';

/** Where a code block can be executed, if anywhere. */
export type RunLane = 'browser' | 'container';

/** Aliases the model actually writes on a fence, mapped to one canonical id. */
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  htm: 'html',
};

/**
 * Runs in the runner window's sandboxed iframe — no server, no container,
 * instant. `javascript` lands here rather than on node because the
 * overwhelming majority of snippets in chat are browser code; the runner
 * window offers a node toggle for the ones that aren't.
 */
const BROWSER_LANGS = new Set(['html', 'css', 'javascript']);

/** Runs through `execInContainer` — the contained lane, never the build lane. */
const CONTAINER_LANGS = new Set(['python', 'bash']);

/**
 * Languages where "turn this into a real app" is a sensible offer. Narrower
 * than the runnable set on purpose: a bash one-liner or a stylesheet is not an
 * app, and a button that starts a paid build should not appear on one.
 *
 * This is the deterministic half of the build-vs-snippet choice. The
 * `[[code-route]]` marker asks BEFORE the code exists and depends on the model
 * judging the request ambiguous; this asks AFTER, on every snippet, and depends
 * on nothing. The marker was the whole mechanism at first, which made the
 * option appear unpredictably — "write me a flappy bird html script in chat"
 * correctly suppressed it, and the route was then nowhere to be found.
 */
const BUILDABLE_LANGS = new Set(['html', 'javascript', 'typescript', 'python']);

export function isBuildable(raw: string | null | undefined): boolean {
  return BUILDABLE_LANGS.has(normaliseLang(raw));
}

export function normaliseLang(raw: string | null | undefined): string {
  const l = (raw ?? '').toLowerCase().trim();
  return LANG_ALIASES[l] ?? l;
}

/** The lane a language runs on, or null when nothing can execute it. */
export function runLaneFor(raw: string | null | undefined): RunLane | null {
  const lang = normaliseLang(raw);
  if (BROWSER_LANGS.has(lang)) return 'browser';
  if (CONTAINER_LANGS.has(lang)) return 'container';
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A streaming reply re-parses its whole markdown body on every chunk, so every
// *completed* block above the cursor would be re-highlighted token after token.
// Memoising on (lang, text) makes those free; the block still growing at the
// tail misses every time, which is correct and is only ever one block.
const HIGHLIGHT_CACHE = new Map<string, string>();
const HIGHLIGHT_CACHE_MAX = 200;

// Auto-detection is both the expensive path and the inaccurate one. Bound it to
// the languages that actually turn up in chat, and skip it entirely once a block
// is large enough that guessing costs more than it is worth.
const AUTO_SUBSET = ['javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css', 'sql'];
const AUTO_DETECT_MAX_CHARS = 20_000;
const HIGHLIGHT_MAX_CHARS = 50_000;

function highlight(text: string, lang: string): string {
  if (text.length > HIGHLIGHT_MAX_CHARS) return escapeHtml(text);

  const key = `${lang}\n${text}`;
  const hit = HIGHLIGHT_CACHE.get(key);
  if (hit !== undefined) return hit;

  let out: string;
  try {
    if (lang && hljs.getLanguage(lang)) {
      out = hljs.highlight(text, { language: lang }).value;
    } else if (text.length <= AUTO_DETECT_MAX_CHARS) {
      out = hljs.highlightAuto(text, AUTO_SUBSET).value;
    } else {
      out = escapeHtml(text);
    }
  } catch {
    // An unparseable half-streamed block is normal here, not an error.
    out = escapeHtml(text);
  }

  if (HIGHLIGHT_CACHE.size >= HIGHLIGHT_CACHE_MAX) {
    const oldest = HIGHLIGHT_CACHE.keys().next().value;
    if (oldest !== undefined) HIGHLIGHT_CACHE.delete(oldest);
  }
  HIGHLIGHT_CACHE.set(key, out);
  return out;
}

/**
 * `renderer` override for a `Marked` instance. Mirrors the blog renderer's
 * `code()` so both surfaces emit the same `<pre><code class="hljs language-x">`
 * shape — that class is where `enhanceCodeBlocks` reads the language back out
 * of, and it is what the chat sanitiser is already configured to keep.
 */
export const codeRenderer = {
  code({ text, lang }: { text: string; lang?: string }): string {
    const language = normaliseLang(lang);
    const body = highlight(text, language);
    const cls = `hljs${language ? ` language-${language}` : ''}`;
    return `<pre><code class="${cls}">${body}</code></pre>`;
  },
};

// Tolerant of attribute reordering by sanitize-html, and deliberately anchored
// on `<pre>` so inline `<code>` spans in prose are left alone.
const PRE_BLOCK_RE = /<pre>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g;
const LANG_CLASS_RE = /language-([a-z0-9+#-]+)/i;

/**
 * Wrap each fenced block in a card with a toolbar. Runs POST-sanitise, exactly
 * as `wrapTables` does, so the chrome it adds survives — the alternative is
 * teaching the sanitiser to pass `<button>`, which would also let a reply forge
 * one. The buttons are spans carrying a role for the same reason: no new tag
 * has to be allowed through.
 *
 * Clicks are handled by delegation on the message container (see ChatMessage),
 * which reads the source back off the `<code>` element's textContent — the
 * highlighted markup un-escapes to exactly the text the model wrote.
 */
export function enhanceCodeBlocks(html: string, opts: { allowRun?: boolean } = {}): string {
  const allowRun = opts.allowRun ?? true;
  return html.replace(PRE_BLOCK_RE, (whole, attrs: string) => {
    const lang = normaliseLang(LANG_CLASS_RE.exec(attrs)?.[1] ?? '');
    const lane = runLaneFor(lang);
    const label = lang || 'code';

    // The public share view renders through this same component, and /jkai/run
    // is owner-gated — so offering an anonymous reader a Run button would just
    // open a sign-in page. Copy still works for everyone.
    const runBtn = !allowRun
      ? ''
      : lane
        ? `<span class="cc-btn cc-run" role="button" tabindex="0" data-lane="${lane}" title="Run this in a separate window">run</span>`
        : `<span class="cc-btn cc-run-off" title="No runtime for ${escapeHtml(label)} in the sandbox">run</span>`;

    // Always present on a buildable snippet, so the route to a real app never
    // depends on the model having offered it. Asks for confirmation before it
    // spends anything — see ChatMessage.
    const buildBtn =
      allowRun && isBuildable(lang)
        ? `<span class="cc-btn cc-build" role="button" tabindex="0" title="Turn this into a real app with the autonomous builder">build app</span>`
        : '';

    return (
      `<div class="code-card" data-lang="${escapeHtml(lang)}">` +
      `<div class="cc-bar">` +
      `<span class="cc-lang">${escapeHtml(label)}</span>` +
      `<span class="cc-spacer"></span>` +
      `<span class="cc-btn cc-copy" role="button" tabindex="0" title="Copy to clipboard">copy</span>` +
      runBtn +
      buildBtn +
      `</div>` +
      whole +
      `</div>`
    );
  });
}
