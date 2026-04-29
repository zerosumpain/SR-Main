import { Marked } from 'marked';
import hljs from 'highlight.js';
import sanitize from 'sanitize-html';

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
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
    iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'title'],
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
  allowedStyles: {
    '*': {
      'color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/^\d+(\.\d+)?(px|em|rem|%)$/],
    },
  },
};

export function renderContent(content: string, format: 'html' | 'markdown'): string {
  const raw = format === 'html' ? content : (marked.parse(content) as string);
  return sanitize(raw, SANITIZE_OPTIONS);
}
