import { Marked } from 'marked';
import hljs from 'highlight.js';

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

export function renderContent(content: string, format: 'html' | 'markdown'): string {
  if (format === 'html') return content;
  return marked.parse(content) as string;
}
