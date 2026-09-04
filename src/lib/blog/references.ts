/**
 * References — the sources behind a post, kept OUT of the reading column.
 *
 * WHAT CHANGED AND WHY. The sources panel used to write its citations straight
 * into the prose: `<hr><h3>Sources</h3><ol class="footnotes">…` appended to the
 * body. That put a heading the size of a section break, and a list of raw URLs,
 * in the middle of the reading experience — the most visually prominent thing
 * on the page was the bibliography. Sources should be checkable, not loud.
 *
 * So references now live in ONE `<section class="references">` block at the end
 * of the body, and the reading surface lifts that block out of the prose and
 * renders it in the article footer. Two consequences worth knowing:
 *
 *  - The inline citation marker stays in the prose, because that IS the link
 *    between a claim and its source, and it is one superscript character.
 *  - Everything else about the post is unchanged. References ride in `content`
 *    rather than in a column of their own, so revisions, rollback, preview and
 *    export keep working with no new plumbing — `blog_post_revisions` snapshots
 *    `content`, and a separate column would have silently stopped rolling back
 *    with the prose it belongs to.
 *
 * Pure string handling, no DOM: this runs in the browser (the editor), on the
 * server (rendering) and inside tests, exactly like `./renderer`.
 */

export const REFERENCES_CLASS = 'references';

export type Reference = {
  /** 1-based; matches the marker in the prose. */
  n: number;
  url: string;
  /** The source's own title, when the search gave us one. */
  title: string;
};

/**
 * What may follow the block and still count as "the end".
 *
 * Both patterns below anchor to the end of the body, because a `<section
 * class="references">` in the MIDDLE of a draft is something the author put
 * there deliberately — only a trailing block is furniture.
 *
 * "The end" is not `\s*$` though, and assuming it was is a bug this module
 * shipped once: ProseMirror appends an empty trailing paragraph after a
 * block-level atom that sits last in the document, because the caret needs
 * somewhere to go. The editor's own output is therefore `…</section><p></p>`,
 * so a bare `\s*$` matched every hand-written fixture and failed on every
 * document the editor had actually touched — and the references then published
 * into the body, which is the one outcome this module exists to prevent.
 */
const TRAILING_EMPTY = '(?:\\s*<p>(?:\\s|<br\\s*/?>|&nbsp;)*</p>)*\\s*$';

const REFERENCES_RE = new RegExp(
  `<section class="${REFERENCES_CLASS}"[^>]*>[\\s\\S]*?</section>${TRAILING_EMPTY}`,
  'i',
);

/**
 * The legacy shape, and it is not dead code: every post written before this
 * change carries its sources as an `<h3>Sources</h3>` + `<ol class="footnotes">`
 * tail, and those posts are already published. Matching it here is what moves
 * their sources into the footer too, without rewriting a single stored row.
 */
const LEGACY_SOURCES_RE = new RegExp(
  `(?:<hr\\s*/?>\\s*)?<h[23][^>]*>\\s*Sources\\s*</h[23]>\\s*<ol class="footnotes">[\\s\\S]*?</ol>${TRAILING_EMPTY}`,
  'i',
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Split a body into its prose and its trailing references block.
 *
 * Returns the references as RAW HTML rather than parsed `Reference` objects.
 * The block has already been through the sanitiser by the time the reading
 * surface calls this, and re-parsing it into a list only to re-serialise it
 * would be one more place for an entity or a foreign-language title to get
 * mangled. The editor, which owns the structured form, builds the block from
 * `renderReferences` instead.
 */
export function splitReferences(html: string): { body: string; references: string | null } {
  if (!html) return { body: '', references: null };

  const current = html.match(REFERENCES_RE);
  if (current) {
    // The match may have swallowed ProseMirror's trailing empty paragraphs.
    // Cut back to the closing tag so the footer renders the list and nothing
    // else — an empty <p> in the footer is a stray gap under the sources.
    const end = current[0].toLowerCase().lastIndexOf('</section>');
    return {
      body: html.slice(0, current.index).trimEnd(),
      references: current[0].slice(0, end + '</section>'.length),
    };
  }

  // Legacy tail — rewrapped into the current shape so the footer has one
  // element to render whatever the post was written with.
  const legacy = html.match(LEGACY_SOURCES_RE);
  if (legacy) {
    const list = legacy[0].match(/<ol class="footnotes">[\s\S]*?<\/ol>/i)?.[0] ?? '';
    return {
      body: html.slice(0, legacy.index).trimEnd(),
      references: list ? `<section class="${REFERENCES_CLASS}">${list}</section>` : null,
    };
  }

  return { body: html, references: null };
}

/**
 * The body with its references removed.
 *
 * Used wherever the post is being MEASURED or READ BY A MODEL rather than
 * displayed: `segmentBody` (so autopilot never offers to rewrite a citation),
 * the readability score (a list of URLs is not prose and drags the score
 * around), and claim extraction (the sources are the evidence, not claims to
 * check). Without this the references would be scored as the post's closing
 * paragraphs.
 */
export function stripReferences(html: string): string {
  return splitReferences(html).body;
}

/** Parse a references block back into structured entries. The editor needs
 *  this to renumber after a deletion; nothing on the reading path does. */
export function parseReferences(html: string): Reference[] {
  const { references } = splitReferences(html);
  if (!references) return [];
  const out: Reference[] = [];
  const itemRe = /<li[^>]*\bid="fn-(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(references)) !== null) {
    const n = Number(m[1]);
    const inner = m[2];
    const url = inner.match(/href="([^"]+)"/i)?.[1] ?? '';
    // The title is the text before the em dash the renderer writes; a legacy
    // row with no title falls back to the URL's own anchor text.
    const title = inner
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*—\s*https?:\/\/\S+\s*$/, '')
      .trim();
    if (!Number.isFinite(n) || !url) continue;
    out.push({ n, url, title: title && !/^https?:\/\//i.test(title) ? title : '' });
  }
  return out;
}

/**
 * Build the references block from structured entries.
 *
 * THE CANONICAL SHAPE. Nothing in the running app calls this — the editor
 * writes the block through the `References` TipTap node's own command, because
 * a node is the only thing TipTap will not strip. So this function and
 * `withReferences` below exist as the specification of what that node must
 * produce, and `rich-editor.editor.test.ts` asserts the node's output is a
 * block `splitReferences` can find while `references.test.ts` asserts this
 * one's is too. Two producers of one markup shape is a drift risk; a shared
 * definition plus tests on both sides is what makes the drift visible.
 *
 * Every tag and attribute here must also be admitted by the sanitiser in
 * `./renderer` — `section.references`, `ol.footnotes`, `li[id]` and an anchor
 * with `target`/`rel`. An element that round-trips in the editor and is
 * stripped on publish is the failure mode this whole module exists inside, so
 * there is a test asserting the output survives `renderContent` unchanged.
 */
export function renderReferences(refs: Reference[]): string {
  if (!refs.length) return '';
  const items = refs
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((r) => {
      const label = r.title ? `${escapeHtml(r.title)} — ` : '';
      return `<li id="fn-${r.n}">${label}<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.url)}</a></li>`;
    })
    .join('');
  return `<section class="${REFERENCES_CLASS}"><ol class="footnotes">${items}</ol></section>`;
}

/** Replace (or append) the references block on a body. */
export function withReferences(html: string, refs: Reference[]): string {
  const { body } = splitReferences(html);
  const block = renderReferences(refs);
  if (!block) return body;
  return body ? `${body}${block}` : block;
}

/** The next free citation number for a body. */
export function nextReferenceNumber(html: string): number {
  const refs = parseReferences(html);
  return refs.reduce((max, r) => Math.max(max, r.n), 0) + 1;
}

/**
 * The inline marker that points at a footer entry. One superscript character in
 * the prose — the only part of a citation the reader meets mid-sentence.
 *
 * Canonical, like `renderReferences`: the editor inserts markers through the
 * `RefMark` node, and `rich-editor.editor.test.ts` mounts THIS string to prove
 * the node parses what this function writes. If the two ever disagree, an
 * existing post's markers stop being recognised on reopen.
 */
export function referenceMarker(n: number): string {
  return `<sup class="ref-mark" id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>`;
}
