import { Marked } from 'marked';
import hljs from 'highlight.js';
import sanitize from 'sanitize-html';

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
  ]),
  allowedAttributes: {
    ...sanitize.defaults.allowedAttributes,
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    figure: ['class'],
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
      'font-family': [/^var\(--font-(sans|body|mono|display|brand)\)$/],
    },
  },
};

export function renderContent(content: string, format: 'html' | 'markdown'): string {
  const raw = format === 'html' ? content : (marked.parse(content) as string);
  return sanitize(raw, SANITIZE_OPTIONS);
}
