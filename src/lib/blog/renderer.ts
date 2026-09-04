import { Marked } from 'marked';
import hljs from '$lib/highlight';
import sanitize from 'sanitize-html';
import { FONT_FAMILY_STYLE_PATTERN } from './fonts';
import { splitReferences } from './references';

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // ![alt](src "caption") — the quoted title becomes a visible figcaption.
    image({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const img = `<img src="${escapeAttr(href || '')}" alt="${escapeAttr(text || '')}" loading="lazy">`;
      if (!title) return img;
      return `<figure>${img}<figcaption>${escapeAttr(title)}</figcaption></figure>`;
    },
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang || '';
      let highlighted: string;
      if (language && hljs.getLanguage(language)) {
        try {
          highlighted = hljs.highlight(text, { language }).value;
        } catch {
          highlighted = hljs.highlightAuto(text).value;
        }
      } else {
        highlighted = hljs.highlightAuto(text).value;
      }
      return `<pre><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre>`;
    },
  },
});

const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: sanitize.defaults.allowedTags.concat([
    'img', 'figure', 'figcaption', 'video', 'source', 'iframe',
    'details', 'summary', 'mark', 'del', 'ins', 'sup', 'sub',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Editorial furniture (2026-08-30). `aside` carries pull quotes and
    // standfirsts; `section` groups a bleed block. Both are inert containers —
    // the class allow-list below is what decides how they render, so an
    // unrecognised class degrades to an ordinary block rather than to
    // arbitrary layout.
    'aside', 'section',
  ]),
  allowedAttributes: {
    ...sanitize.defaults.allowedAttributes,
    // `srcset` and `sizes` are in sanitize-html's own img defaults; overriding
    // the whole `img` key without them silently dropped every responsive
    // source and left only `src`. A magazine layout that bleeds images to the
    // full viewport width is exactly where that costs the most.
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
    figure: ['class'],
    // Highlight carries its tone as a class, the way callouts do.
    mark: ['class'],
    // <video> and <source> were in allowedTags from the start but had NO
    // attribute entry, and sanitize-html's defaults cover only `a` and `img`.
    // So a published <video src=…> was silently reduced to an empty <video></video>
    // — the tag was allowed and every attribute that made it a video was not.
    // `controls` and `playsinline` are boolean attributes; `autoplay` is
    // deliberately absent, because an article that starts making noise on scroll
    // is not the reading experience this redesign is for.
    video: ['src', 'poster', 'width', 'height', 'controls', 'muted', 'loop', 'playsinline', 'preload'],
    source: ['src', 'type', 'srcset', 'media'],
    aside: ['class'],
    section: ['class'],
    iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'title', 'loading'],
    a: ['href', 'name', 'target', 'rel', 'title'],
    code: ['class'],
    pre: ['class'],
    span: ['class', 'style'],
    div: ['class', 'style'],
    sup: ['class', 'id'],
    sub: ['class', 'id'],
    ol: ['class', 'id', 'start'],
    ul: ['class', 'id'],
    li: ['class', 'id'],
  },
  // Class allow-list. Without this, `figure: ['class']` admits ANY class name,
  // and the editorial layout below keys real behaviour (full-bleed, floated,
  // margin-note positioning) off class names — so an arbitrary one is a layout
  // hole in the same way an arbitrary font-family was a typography one. An
  // unrecognised class is dropped and the element degrades to its plain form.
  allowedClasses: {
    figure: ['project-embed', 'bleed', 'wide', 'align-left', 'align-right', 'gallery'],
    // `callout-key` and `standfirst` joined on 2026-09-04. A tone that is in
    // the editor's menu and not in this list round-trips in the editor and is
    // stripped on publish — the exact failure the note in ./tiptap-extras
    // describes, and the reason both halves are tested together.
    aside: [
      'pull-quote', 'standfirst', 'callout',
      'callout-note', 'callout-warn', 'callout-aside', 'callout-key',
    ],
    // `references` is the sources block the reading surface lifts into the
    // article footer — see $lib/blog/references.
    section: ['interactive', 'references'],
    mark: ['hl', 'hl-warm', 'hl-cool'],
    span: ['sidenote', 'sidenote-body', 'small-caps'],
    // hljs writes these; the code renderer above emits `hljs language-x`.
    code: ['hljs', 'language-*'],
    pre: ['hljs', 'language-*'],
    ol: ['footnotes'],
    ul: ['footnotes'],
    li: ['*'],
    sup: ['*'],
    sub: ['*'],
    div: ['*'],
  },
  allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'],
  // Same-origin project embeds: relative iframe srcs are let through here,
  // then the exclusiveFilter below restricts them to /projects/ pages.
  allowIframeRelativeUrls: true,
  exclusiveFilter: (frame) => {
    if (frame.tag !== 'iframe') return false;
    const src = frame.attribs?.src ?? '';
    // No src left (external host that failed the allow-list, or none given) —
    // drop the whole tag instead of leaving an empty frame.
    if (!src) return true;
    if (/^https?:\/\//i.test(src)) return false;
    return !src.startsWith('/projects/');
  },
  allowedStyles: {
    '*': {
      'color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/^\d+(\.\d+)?(px|em|rem|%)$/],
      // Site font tokens only — the editor's font picker offers exactly these.
      // The pattern is DERIVED from the vocabulary in ./fonts rather than
      // written out again, so adding a face to the picker cannot leave the
      // sanitiser silently stripping it back off.
      'font-family': [FONT_FAMILY_STYLE_PATTERN],
    },
  },
};

export function renderContent(content: string, format: 'html' | 'markdown'): string {
  const raw = format === 'html' ? content : (marked.parse(content) as string);
  return sanitize(raw, SANITIZE_OPTIONS);
}

// ---------------------------------------------------------------------------
// Article rendering — the reading surface's entry point.
//
// `renderContent` stays exactly as it was: sanitise and return a string. Every
// existing caller (the preview route, the tag pages, tests) keeps that
// contract. `renderArticle` wraps it with the two things a long-form editorial
// layout needs and a bare string cannot carry: stable heading anchors, and the
// outline built from them.
//
// Heading ids are assigned HERE rather than trusted from the content. Author-
// supplied ids would have to be admitted through the sanitiser's attribute
// allow-list, which hands anyone who can post an arbitrary DOM id — enough to
// collide with the page's own elements and break `getElementById` lookups
// elsewhere on the page. Generating them after sanitising means they are always
// well-formed, always unique, and never attacker-chosen.
// ---------------------------------------------------------------------------

export type TocEntry = {
  id: string;
  text: string;
  /** 2 or 3. h1 is the article title and never appears in the outline; h4+ is
   *  below the granularity a reader can usefully navigate. */
  level: 2 | 3;
};

export type RenderedArticle = {
  html: string;
  toc: TocEntry[];
  /** The sources block, already sanitised, for the page to render in its
   *  FOOTER rather than in the reading column. Null when the post cites
   *  nothing. See $lib/blog/references for why it travels inside `content`. */
  references: string | null;
};

const HEADING_RE = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugifyHeading(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  // A heading of pure punctuation ("—", "***") slugifies to nothing; an empty
  // fragment is a link that goes to the top of the page, which reads as broken.
  return base || 'section';
}

/**
 * Sanitise a post and return it with anchored headings plus its outline.
 *
 * Ids are prefixed `h-` so they cannot collide with the page's own element ids,
 * and de-duplicated with a numeric suffix — two sections both called "Notes"
 * are common and must still be separately linkable.
 */
export function renderArticle(content: string, format: 'html' | 'markdown'): RenderedArticle {
  // Sources come off BEFORE the heading pass, not after. A legacy post carries
  // its list behind a literal <h3>Sources</h3>, and leaving that in would put
  // "Sources" in the contents rail as though it were a section of the argument
  // — which is precisely the prominence this change exists to remove.
  const { body, references } = splitReferences(renderContent(content, format));
  const toc: TocEntry[] = [];
  const used = new Map<string, number>();

  const html = body.replace(HEADING_RE, (_m, lvl: string, attrs: string | undefined, inner: string) => {
    const level = Number(lvl) as 2 | 3;
    const text = textOf(inner);
    // A genuinely empty heading gets no anchor and no outline entry — linking
    // to it would produce a blank row in the rail.
    if (!text) return `<h${lvl}${attrs ?? ''}>${inner}</h${lvl}>`;

    const base = `h-${slugifyHeading(text)}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen + 1}`;

    toc.push({ id, text, level });
    // The sanitiser has already run, so `attrs` holds only allowed attributes
    // and cannot contain an id (headings have no attribute allow-list entry).
    return `<h${lvl} id="${id}"${attrs ?? ''}>${inner}</h${lvl}>`;
  });

  return { html, toc, references };
}
