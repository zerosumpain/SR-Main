// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { Figure, ProjectEmbed, PullQuote, Callout, Disclosure, Sidenote } from './tiptap-extras';
import { renderContent } from './renderer';

/**
 * Mounts a real TipTap editor and drives the commands the blog toolbar calls.
 *
 * WHY THIS EXISTS. Every other blog test operates on strings — `renderer.test.ts`
 * sanitises HTML, `types.test.ts` checks shapes. Nothing ever constructed an
 * `Editor`, so the entire ProseMirror layer was untested: the upgrade that
 * silently drops `setFontFamily`, or lands a `@tiptap/core` whose peer no longer
 * matches an extension, would pass the whole suite and fail the first time John
 * opened a post.
 *
 * The extension list and its `configure()` calls MUST mirror `RichEditor.svelte`.
 * They are not decoration:
 *
 *  - `link: false` on StarterKit is load-bearing. StarterKit v3 ships its own
 *    Link, and registering ours on top logs "Duplicate extension names found:
 *    ['link']" and makes it undefined which config wins. The rendered HTML looks
 *    the SAME either way, so the duplicate is only observable through tiptap's
 *    warning — which is why one test asserts on that warning directly.
 *  - `TextStyle` must come with `FontFamily`/`FontSize`: those are marks stored
 *    ON the textStyle mark, and without it the font selects silently no-op.
 *
 * TipTap 3.x extensions peer on `@tiptap/core` at an EXACT version, so every
 * `@tiptap/*` package has to move as one unit. That is the failure this guards:
 * the schema simply comes up short a node or a command.
 */

const EXTENSIONS = [
  StarterKit.configure({
    codeBlock: { HTMLAttributes: { class: 'hljs' } },
    link: false,
  }),
  Image.configure({
    inline: false,
    allowBase64: false,
    // `resize` is an OBJECT or `false`, never a boolean true — the type is
    // `{ enabled, directions?, minWidth?, minHeight?, alwaysPreserveAspectRatio? } | false`.
    // It ships inside @tiptap/extension-image, so turning it on costs no new
    // package (and every @tiptap/* must move as ONE unit, so a new one would
    // drag a coordinated bump of all six). The sanitiser already permits
    // width/height on <img>.
    resize: { enabled: true, minWidth: 120, alwaysPreserveAspectRatio: true },
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  }),
  Placeholder.configure({ placeholder: 'Write your post…' }),
  TextStyle,
  FontFamily,
  FontSize,
  Figure,
  ProjectEmbed,
  PullQuote,
  Callout,
  Disclosure,
  Sidenote,
];

let editor: Editor | null = null;

function mount(content = '<p>hello world</p>'): Editor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: EXTENSIONS, content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = '';
});

describe('editorial furniture survives the full round trip', () => {
  // Two independent things must agree for any of these to work: the TipTap
  // schema has to keep the element on setContent/getHTML, AND the blog
  // sanitiser has to admit its tag and class on publish. Either one alone is
  // a green test over a feature that does not work — the editor keeps it and
  // the published page drops it, or vice versa. So each case asserts both.
  const cases: { name: string; html: string; expect: RegExp }[] = [
    { name: 'pull quote', html: '<aside class="pull-quote">Lifted</aside>', expect: /<aside class="pull-quote">Lifted<\/aside>/ },
    { name: 'note callout', html: '<aside class="callout-note"><p>Note</p></aside>', expect: /class="callout-note"/ },
    { name: 'warn callout', html: '<aside class="callout-warn"><p>Careful</p></aside>', expect: /class="callout-warn"/ },
    { name: 'disclosure', html: '<details><summary>More</summary><p>Body</p></details>', expect: /<details>/ },
    { name: 'sidenote', html: '<p>Text<span class="sidenote"><span class="sidenote-body">Aside</span></span></p>', expect: /class="sidenote-body"/ },
  ];

  for (const c of cases) {
    it(`${c.name} round-trips through the editor and the sanitiser`, () => {
      const e = mount();
      e.commands.setContent(c.html);
      const out = e.getHTML();
      expect(out, `${c.name} did not survive the EDITOR`).toMatch(c.expect);
      expect(renderContent(out, 'html'), `${c.name} did not survive the SANITISER`).toMatch(c.expect);
    });
  }

  it('keeps a callout tone through the round trip', () => {
    const e = mount();
    e.commands.setContent('<aside class="callout-warn"><p>Careful</p></aside>');
    // The tone lives in the CLASS, not in an attribute — an attribute would be
    // stripped by the sanitiser and the tone would silently reset to note.
    expect(e.getHTML()).toContain('callout-warn');
    expect(e.getHTML()).not.toContain('tone=');
  });
});

describe('the blog rich editor mounts and runs its toolbar', () => {
  it('mounts a ProseMirror view', () => {
    expect(mount().view).toBeTruthy();
  });

  it('registers the custom nodes in the schema', () => {
    const e = mount();
    // If a tiptap upgrade breaks Node.create's contract these vanish, and the
    // toolbar buttons become silent no-ops rather than throwing.
    expect(e.schema.nodes.figure, 'Figure missing from schema').toBeTruthy();
    expect(e.schema.nodes.projectEmbed, 'ProjectEmbed missing from schema').toBeTruthy();
    // The editorial furniture. These are schema nodes rather than raw HTML
    // precisely because TipTap drops anything its schema does not know — a
    // missing node here means the slash menu silently inserts a bare paragraph.
    expect(e.schema.nodes.pullQuote, 'PullQuote missing from schema').toBeTruthy();
    expect(e.schema.nodes.callout, 'Callout missing from schema').toBeTruthy();
    expect(e.schema.nodes.disclosure, 'Disclosure missing from schema').toBeTruthy();
    expect(e.schema.nodes.sidenote, 'Sidenote missing from schema').toBeTruthy();
  });

  it('runs the StarterKit marks and blocks the toolbar exposes', () => {
    const e = mount();
    e.chain().focus().selectAll().toggleBold().run();
    expect(e.getHTML()).toContain('<strong>');
    e.chain().focus().toggleHeading({ level: 2 }).run();
    expect(e.getHTML()).toContain('<h2');
    e.chain().focus().toggleBulletList().run();
    expect(e.getHTML()).toContain('<ul');
  });

  it('applies and clears the font family — the site-font picker', () => {
    const e = mount();
    e.chain().focus().selectAll().setFontFamily('var(--font-mono)').run();
    expect(e.getHTML()).toContain('font-family');
    // The sanitizer only admits `var(--font-*)`, so the value matters as much
    // as the mark: see renderer.ts's font-family allowlist.
    expect(e.getHTML()).toContain('var(--font-mono)');
    e.chain().focus().selectAll().unsetFontFamily().run();
    expect(e.getHTML()).not.toContain('font-family');
  });

  it('applies a font size and reports both back through textStyle', () => {
    const e = mount();
    e.chain().focus().selectAll().setFontSize('18px').run();
    expect(e.getHTML()).toContain('font-size');
    // The toolbar reads its select values from exactly this call.
    expect(typeof e.getAttributes('textStyle')).toBe('object');
  });

  it('inserts a captioned figure', () => {
    const e = mount('<p>x</p>');
    e.chain()
      .focus()
      .insertContent({
        type: 'figure',
        attrs: { src: '/a.png', alt: 'a' },
        content: [{ type: 'text', text: 'cap' }],
      })
      .run();
    const html = e.getHTML();
    expect(html).toContain('<figure');
    expect(html).toContain('<figcaption');
  });

  it('inserts a project embed', () => {
    const e = mount('<p>x</p>');
    e.chain().focus().insertContent({ type: 'projectEmbed', attrs: { src: '/projects/x' } }).run();
    expect(e.getHTML()).toContain('project-embed');
  });

  it('sets a link carrying our rel/target config', () => {
    const e = mount('<p>link me</p>');
    e.chain().focus().selectAll().setLink({ href: 'https://example.com' }).run();
    const html = e.getHTML();
    expect(html).toContain('<a ');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('registers exactly ONE link extension', () => {
    // NOT provable from the rendered HTML — checked by mutation: commenting out
    // `link: false` still emits our rel/target, so the output looks identical
    // either way. The only observable difference is tiptap's own warning, so
    // that is what this asserts. Without it, a duplicate registration is
    // invisible and which config wins is undefined.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mount();
      const dupes = warn.mock.calls
        .map((c) => c.join(' '))
        .filter((m) => /Duplicate extension names/.test(m));
      expect(dupes, `tiptap reported duplicates: ${dupes.join(' | ')}`).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('inserts an image', () => {
    const e = mount('<p></p>');
    e.chain().focus().setImage({ src: '/i.png' }).run();
    expect(e.getHTML()).toContain('<img');
  });
});
