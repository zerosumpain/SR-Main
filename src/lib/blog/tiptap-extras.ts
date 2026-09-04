import { Mark, mergeAttributes, Node } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: {
      /** Insert a captioned image. */
      setFigure: (options: { src: string; alt?: string; caption?: string }) => ReturnType;
      /** Convert the selected plain image into a figure with an editable caption. */
      imageToFigure: () => ReturnType;
      /** Strip the caption: convert the figure at the selection back to a plain image. */
      figureToImage: () => ReturnType;
    };
    projectEmbed: {
      /** Embed a /projects/<slug> page as a live inline frame. */
      setProjectEmbed: (options: { src: string; title?: string }) => ReturnType;
    };
  }
}

/**
 * <figure><img …><figcaption>…</figcaption></figure> — image with an editable
 * caption. The caption is the node's inline content, so it round-trips through
 * getHTML()/setContent() and the blog sanitizer untouched.
 */
export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'inline*',
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.querySelector('img')?.getAttribute('src') ?? null,
      },
      alt: {
        default: null,
        parseHTML: (el: HTMLElement) => el.querySelector('img')?.getAttribute('alt') ?? null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
        contentElement: 'figcaption',
        getAttrs: (el) => {
          // Project embeds are their own node; a figure with no image is not ours.
          if (el.classList.contains('project-embed')) return false;
          return el.querySelector('img') ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      ['img', mergeAttributes(HTMLAttributes, { draggable: 'false', contenteditable: 'false' })],
      ['figcaption', 0],
    ];
  },

  addProseMirrorPlugins() {
    const name = this.name;
    return [
      // Clicking the image inside a figure resolves to a caret OUTSIDE the
      // figure (the img is not part of the content hole), which leaves the
      // toolbar's Caption button dead. Map that click to a NodeSelection of
      // the figure instead.
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement | null;
              if (!target || target.tagName !== 'IMG') return false;
              const fig = target.closest('figure');
              if (!fig || fig.classList.contains('project-embed') || !view.dom.contains(fig)) return false;
              const $pos = view.state.doc.resolve(view.posAtDOM(fig, 0));
              if ($pos.parent.type.name !== name) return false;
              const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, $pos.before($pos.depth)));
              view.dispatch(tr);
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setFigure:
        ({ caption, ...attrs }) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs,
              content: caption ? [{ type: 'text', text: caption }] : undefined,
            })
            .run(),

      imageToFigure:
        () =>
        ({ state, chain }) => {
          const sel = state.selection;
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false;
          const { src, alt } = sel.node.attrs;
          const pos = sel.from;
          return chain()
            .deleteSelection()
            .insertContentAt(pos, { type: this.name, attrs: { src, alt } })
            // +1 lands inside the (empty) caption so the user can type straight away.
            .setTextSelection(pos + 1)
            .run();
        },

      figureToImage:
        () =>
        ({ state, chain }) => {
          const sel = state.selection;
          let figurePos: number | null = null;
          let figureNode = null;
          if (sel instanceof NodeSelection && sel.node.type.name === this.name) {
            figurePos = sel.from;
            figureNode = sel.node;
          } else {
            for (let d = sel.$from.depth; d > 0; d--) {
              if (sel.$from.node(d).type.name === this.name) {
                figurePos = sel.$from.before(d);
                figureNode = sel.$from.node(d);
                break;
              }
            }
          }
          if (figurePos === null || !figureNode) return false;
          const { src, alt } = figureNode.attrs;
          return chain()
            .deleteRange({ from: figurePos, to: figurePos + figureNode.nodeSize })
            .insertContentAt(figurePos, { type: 'image', attrs: { src, alt } })
            .run();
        },
    };
  },
});

/**
 * <figure class="project-embed"><iframe …><figcaption><a …></figcaption></figure>
 * — a live same-origin embed of a /projects/<slug> page. Atom node: the frame
 * is inert inside the editor (CSS pointer-events) and interactive on the
 * published page. The sanitizer only lets iframes through when the src starts
 * with /projects/.
 */
export const ProjectEmbed = Node.create({
  name: 'projectEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure.project-embed',
        priority: 100,
        getAttrs: (el) => {
          const iframe = el.querySelector('iframe');
          if (!iframe?.getAttribute('src')) return false;
          return {
            src: iframe.getAttribute('src'),
            title: iframe.getAttribute('title'),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const src = String(node.attrs.src ?? '');
    const title = String(node.attrs.title ?? 'Project');
    return [
      'figure',
      { class: 'project-embed' },
      ['iframe', { src, title, loading: 'lazy', allowfullscreen: 'true' }],
      ['figcaption', ['a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, `${title} — open full page ↗`]],
    ];
  },

  addCommands() {
    return {
      setProjectEmbed:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    };
  },
});

// ---------------------------------------------------------------------------
// Editorial furniture (2026-08-30).
//
// These exist as real schema nodes rather than raw HTML for one hard reason:
// TipTap parses everything against its schema, so `insertContent('<aside …>')`
// on a schema that has never heard of <aside> silently drops the element and
// keeps only its text. A slash-menu item that appears to work and quietly
// inserts a bare paragraph is worse than no slash-menu item.
//
// Every tag and class below is already admitted by the blog sanitiser's
// `allowedTags` / `allowedClasses` in $lib/blog/renderer — the two lists have
// to agree or the element round-trips in the editor and vanishes on publish.
// ---------------------------------------------------------------------------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pullQuote: {
      /** Lift the selection into a pull quote. */
      setPullQuote: () => ReturnType;
    };
    callout: {
      /** Insert a callout in the given tone. */
      setCallout: (tone?: CalloutTone) => ReturnType;
    };
    disclosure: {
      /** Insert a collapsible section. */
      setDisclosure: (summary?: string) => ReturnType;
    };
    sidenote: {
      /** Insert a margin note at the cursor. */
      setSidenote: () => ReturnType;
    };
    standfirst: {
      /** Lift the selection into a standfirst — the intro that sets up the piece. */
      setStandfirst: () => ReturnType;
    };
    references: {
      /** Replace the post's references block with these entries. */
      setReferences: (items: ReferenceItem[]) => ReturnType;
    };
    refMark: {
      /** Insert the inline citation marker for reference `n` at the cursor. */
      setRefMark: (n: number) => ReturnType;
    };
    highlight: {
      /** Emphasise the selection in the given tone. */
      setHighlight: (tone?: HighlightTone) => ReturnType;
      toggleHighlight: (tone?: HighlightTone) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

/**
 * `key` joined the tones on 2026-09-04 — the "this is the point" block, which
 * is the one an author reaches for most and the one the set was missing. It
 * reads as emphasis rather than as an interruption, which is what separates it
 * from `note`.
 */
export type CalloutTone = 'note' | 'warn' | 'aside' | 'key';

const CALLOUT_CLASS: Record<CalloutTone, string> = {
  note: 'callout-note',
  warn: 'callout-warn',
  aside: 'callout-aside',
  key: 'callout-key',
};

/**
 * Highlight tones.
 *
 * `hl` is the plain marker pen. The other two exist because a post that
 * highlights everything in one colour has highlighted nothing — a second and
 * third tone let the author separate "this matters" from "this is the caveat"
 * without inventing a colour per paragraph. Three is the whole vocabulary and
 * it is deliberately small.
 */
export type HighlightTone = 'plain' | 'warm' | 'cool';

const HIGHLIGHT_CLASS: Record<HighlightTone, string> = {
  plain: 'hl',
  warm: 'hl-warm',
  cool: 'hl-cool',
};

/** <aside class="pull-quote"> — a line lifted out of the body and set large. */
export const PullQuote = Node.create({
  name: 'pullQuote',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'aside.pull-quote' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { class: 'pull-quote' }), 0];
  },

  addCommands() {
    return {
      setPullQuote:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
    };
  },
});

/** <aside class="callout-…"> — a bordered note carrying block content. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: 'note' as CalloutTone,
        parseHTML: (el: HTMLElement) => {
          for (const tone of Object.keys(CALLOUT_CLASS) as CalloutTone[]) {
            if (el.classList.contains(CALLOUT_CLASS[tone])) return tone;
          }
          return 'note';
        },
        // `tone` is an editor-side concept; the DOM carries it as the class
        // below, so it must not also be emitted as a bare attribute — the
        // sanitiser would strip it and the round-trip would lose the tone.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'aside',
        getAttrs: (el) =>
          Object.values(CALLOUT_CLASS).some((c) => el.classList.contains(c)) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const tone = (node.attrs.tone as CalloutTone) ?? 'note';
    return ['aside', mergeAttributes(HTMLAttributes, { class: CALLOUT_CLASS[tone] }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (tone: CalloutTone = 'note') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { tone },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});

/**
 * <details><summary>…</summary>…</details> — the "interactive section".
 *
 * The summary is an ATTRIBUTE rather than a second content hole. Two content
 * holes in one node need a node view to edit both, and the Figure node above
 * already records what happens when attribute-driven DOM sits next to a content
 * hole: clicking it puts the selection somewhere the toolbar cannot see.
 */
export const Disclosure = Node.create({
  name: 'disclosure',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      summary: {
        default: 'Details',
        parseHTML: (el: HTMLElement) => el.querySelector('summary')?.textContent?.trim() || 'Details',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details', contentElement: (el) => {
      // Everything except the <summary> is the body.
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelector('summary')?.remove();
      return clone;
    } }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'details',
      mergeAttributes(HTMLAttributes),
      ['summary', { contenteditable: 'false' }, String(node.attrs.summary ?? 'Details')],
      ['div', {}, 0],
    ];
  },

  addCommands() {
    return {
      setDisclosure:
        (summary = 'Details') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { summary },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});

/**
 * <span class="sidenote"><span class="sidenote-body">…</span></span>
 *
 * Inline, because a margin note is attached to a POINT in a sentence, not to a
 * block. The visible reference marker is drawn by a CSS counter on the reading
 * surface, so nothing here has to number anything — renumbering on every edit
 * is exactly the kind of state that goes wrong.
 */
export const Sidenote = Node.create({
  name: 'sidenote',
  group: 'inline',
  inline: true,
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'span.sidenote', contentElement: 'span.sidenote-body' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'sidenote' }),
      ['span', { class: 'sidenote-body' }, 0],
    ];
  },

  addCommands() {
    return {
      setSidenote:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [{ type: 'text', text: 'Note' }],
          }),
    };
  },
});

/**
 * <aside class="standfirst"> — the intro paragraph, set larger than the body.
 *
 * A block node rather than a mark: a standfirst is a structural position in the
 * piece (the bit before the piece starts), not decoration applied to a
 * sentence, and making it a node is what lets the reading surface give it its
 * own measure and spacing.
 */
export const Standfirst = Node.create({
  name: 'standfirst',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'aside.standfirst' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { class: 'standfirst' }), 0];
  },

  addCommands() {
    return {
      setStandfirst:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
    };
  },
});

/**
 * <mark class="hl…"> — inline emphasis for a phrase.
 *
 * A MARK, not a node: it applies to a run of text inside a paragraph and has to
 * survive being split, merged and partially selected, which is exactly what
 * marks do and nodes do not. `<mark>` was already in the sanitiser's allowed
 * tags and nothing could produce one, so this is the editor half of a
 * capability that was half-built.
 *
 * The tone rides as a CLASS, matching Callout above, and `renderHTML` on the
 * attribute returns nothing so it is never emitted as a bare `tone=` attribute
 * the sanitiser would strip.
 */
export const Highlight = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      tone: {
        default: 'plain' as HighlightTone,
        parseHTML: (el: HTMLElement) => {
          for (const tone of Object.keys(HIGHLIGHT_CLASS) as HighlightTone[]) {
            if (el.classList.contains(HIGHLIGHT_CLASS[tone])) return tone;
          }
          return 'plain';
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const tone = (mark.attrs.tone as HighlightTone) ?? 'plain';
    return ['mark', mergeAttributes(HTMLAttributes, { class: HIGHLIGHT_CLASS[tone] }), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (tone: HighlightTone = 'plain') =>
        ({ commands }) =>
          commands.setMark(this.name, { tone }),
      toggleHighlight:
        (tone: HighlightTone = 'plain') =>
        ({ commands }) =>
          commands.toggleMark(this.name, { tone }),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** One citation. Mirrors `Reference` in $lib/blog/references — the two are the
 *  same record, declared here so this module stays free of that import cycle
 *  (references.ts is pure string handling and must not pull in TipTap). */
export type ReferenceItem = { n: number; url: string; title: string };

/**
 * <section class="references"><ol class="footnotes">…</ol></section> — the
 * post's sources, which the reading surface lifts into the article footer.
 *
 * THIS HAD TO BE A SCHEMA NODE, and the reason is the one written at the top of
 * this section rather than a new one. The first cut of the footer-references
 * feature wrote the block as raw HTML and handed it to `setContent`. TipTap
 * parsed it against a schema that had never heard of `<section>`, threw the
 * wrapper away, and kept an ordinary `<ol>` — dropping `class="footnotes"` and
 * every `id="fn-N"` with it. Measured, in :
 *
 *   in   <section class="references"><ol class="footnotes"><li id="fn-1">…
 *   out  <ol><li><p>…
 *
 * Three things then fail together and none of them looks like a failure: the
 * block stops being findable by `splitReferences`, so it publishes as a numbered
 * list at the END OF THE PROSE — precisely the thing this feature exists to
 * remove; `parseReferences` returns [] so the next citation is numbered 1 again
 * and collides; and the author sees a list that looks approximately right.
 *
 * ATOM, because the citation ids are load-bearing — the markers in the prose
 * link to them — and a content hole would let a caret into the middle of them.
 * The author edits the block through the sources panel, not by typing in it.
 */
export const References = Node.create({
  name: 'references',
  group: 'block',
  atom: true,
  draggable: false,
  // It is always the last thing in the document, and nothing should end up
  // after it by accident.
  isolating: true,

  addAttributes() {
    return {
      items: {
        default: [] as ReferenceItem[],
        // Read the list back out of the DOM rather than out of a serialised
        // attribute: the DOM is what the sanitiser sees and what the published
        // page renders, so it is the only representation guaranteed to survive
        // a round trip through the database.
        parseHTML: (el: HTMLElement): ReferenceItem[] =>
          Array.from(el.querySelectorAll('li')).map((li) => {
            const anchor = li.querySelector('a');
            const n = Number((li.getAttribute('id') ?? '').replace(/^fn-/, ''));
            const url = anchor?.getAttribute('href') ?? '';
            const title = (li.textContent ?? '')
              .replace(/\s+/g, ' ')
              .replace(/\s*—\s*https?:\/\/\S+\s*$/, '')
              .trim();
            return {
              n: Number.isFinite(n) ? n : 0,
              url,
              title: title && !/^https?:\/\//i.test(title) ? title : '',
            };
          }),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section.references', priority: 100 }];
  },

  renderHTML({ node }) {
    const items = (node.attrs.items as ReferenceItem[]) ?? [];
    return [
      'section',
      { class: 'references' },
      [
        'ol',
        { class: 'footnotes' },
        ...items
          .slice()
          .sort((a, b) => a.n - b.n)
          .map((r) => [
            'li',
            { id: `fn-${r.n}` },
            ...(r.title ? [`${r.title} — `] : []),
            ['a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.url],
          ]),
      ],
    ];
  },

  addCommands() {
    return {
      setReferences:
        (items: ReferenceItem[]) =>
        ({ state, chain }) => {
          // Replace the existing block if there is one, otherwise append. Two
          // references sections in one document would each be half the truth.
          let pos: number | null = null;
          let size = 0;
          state.doc.descendants((node, at) => {
            if (node.type.name === 'references') {
              pos = at;
              size = node.nodeSize;
              return false;
            }
            return true;
          });
          if (!items.length) {
            return pos === null ? true : chain().deleteRange({ from: pos, to: pos + size }).run();
          }
          const content = { type: this.name, attrs: { items } };
          return pos === null
            ? chain().insertContentAt(state.doc.content.size, content).run()
            : chain().deleteRange({ from: pos, to: pos + size }).insertContentAt(pos, content).run();
        },
    };
  },
});

/**
 * <sup class="ref-mark" id="fnref-N"><a href="#fn-N">N</a></sup> — the inline
 * citation marker.
 *
 * A NODE, and an atom, for two measured reasons.
 *
 * StarterKit has no superscript, so a `<sup>` handed to `insertContent` is
 * dropped and only its contents survive. What came back was a bare
 * `<a target="_blank" rel="noopener noreferrer nofollow" href="#fn-1">1</a>`:
 * the marker lost the class the reading surface styles it with, lost the
 * `fnref-` id that `removeReference` finds it by, and — because the Link mark's
 * config applies to every anchor — gained `target="_blank"`, so clicking a
 * citation opened a blank tab instead of jumping to the footer.
 *
 * Atom because the number is derived state. A caret inside the marker lets the
 * author edit "1" into "12" and silently break the link to its source.
 */
export const RefMark = Node.create({
  name: 'refMark',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      n: {
        default: 1,
        parseHTML: (el: HTMLElement) => {
          const fromId = Number((el.getAttribute('id') ?? '').replace(/^fnref-/, ''));
          if (Number.isFinite(fromId) && fromId > 0) return fromId;
          const fromText = Number((el.textContent ?? '').trim());
          return Number.isFinite(fromText) && fromText > 0 ? fromText : 1;
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // Priority over the Link mark, which would otherwise claim the anchor
    // inside and leave the <sup> behind as an empty wrapper.
    return [{ tag: 'sup.ref-mark', priority: 100 }];
  },

  renderHTML({ node }) {
    const n = Number(node.attrs.n) || 1;
    return [
      'sup',
      { class: 'ref-mark', id: `fnref-${n}` },
      ['a', { href: `#fn-${n}` }, String(n)],
    ];
  },

  addCommands() {
    return {
      setRefMark:
        (n: number) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { n } }),
    };
  },
});
