import { mergeAttributes, Node } from '@tiptap/core';
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
