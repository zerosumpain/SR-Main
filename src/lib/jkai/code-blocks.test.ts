import { describe, it, expect } from 'vitest';
import { Marked } from 'marked';
import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
import { codeRenderer, enhanceCodeBlocks, isBuildable, normaliseLang, runLaneFor } from './code-blocks';

const marked = new Marked({ gfm: true, breaks: true, renderer: codeRenderer });

/** The real chat pipeline: parse → sanitise → enhance. */
function render(md: string): string {
  return enhanceCodeBlocks(sanitizeChatHtml(marked.parse(md) as string));
}

describe('normaliseLang', () => {
  it('folds the aliases a model actually writes', () => {
    expect(normaliseLang('py')).toBe('python');
    expect(normaliseLang('JS')).toBe('javascript');
    expect(normaliseLang('sh')).toBe('bash');
    expect(normaliseLang(' Python3 ')).toBe('python');
  });

  it('passes unknown languages through untouched', () => {
    expect(normaliseLang('rust')).toBe('rust');
    expect(normaliseLang(null)).toBe('');
  });
});

describe('runLaneFor', () => {
  it('sends web languages to the browser frame', () => {
    expect(runLaneFor('html')).toBe('browser');
    expect(runLaneFor('css')).toBe('browser');
    expect(runLaneFor('js')).toBe('browser');
  });

  it('sends python and bash to the container', () => {
    expect(runLaneFor('python')).toBe('container');
    expect(runLaneFor('sh')).toBe('container');
  });

  it('refuses anything with no runtime', () => {
    expect(runLaneFor('rust')).toBeNull();
    expect(runLaneFor('sql')).toBeNull();
    expect(runLaneFor('')).toBeNull();
  });
});

describe('highlighting survives the chat sanitiser', () => {
  // The reason this module uses highlight.js and not shiki: sanitizeChatHtml
  // allows `class` on span/code/pre and no `style` attribute at all.
  it('keeps hljs token classes through sanitisation', () => {
    const html = render('```python\ndef f():\n    return "hi"\n```');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
  });

  it('emits no inline styles for the sanitiser to strip', () => {
    const html = sanitizeChatHtml(
      marked.parse('```javascript\nconst x = 1;\n```') as string,
    );
    expect(html).not.toContain('style=');
    expect(html).toContain('hljs');
  });

  it('tags the block with its language class', () => {
    const html = render('```python\nx = 1\n```');
    expect(html).toContain('language-python');
  });
});

describe('enhanceCodeBlocks', () => {
  it('wraps a fenced block in a card with a toolbar', () => {
    const html = render('```python\nprint("hi")\n```');
    expect(html).toContain('class="code-card"');
    expect(html).toContain('data-lang="python"');
    expect(html).toContain('cc-copy');
  });

  it('offers run on a runnable language, with its lane', () => {
    expect(render('```python\nprint(1)\n```')).toContain('data-lane="container"');
    expect(render('```html\n<b>hi</b>\n```')).toContain('data-lane="browser"');
  });

  it('disables run when nothing can execute the language', () => {
    const html = render('```rust\nfn main() {}\n```');
    expect(html).toContain('cc-run-off');
    expect(html).not.toContain('data-lane');
  });

  it('leaves inline code in prose alone', () => {
    const html = render('Use `npm run dev` to start.');
    expect(html).not.toContain('code-card');
    expect(html).toContain('<code>npm run dev</code>');
  });

  it('handles several blocks in one reply', () => {
    const html = render('```python\nx = 1\n```\n\ntext\n\n```bash\nls\n```');
    expect(html.match(/class="code-card"/g)).toHaveLength(2);
    expect(html).toContain('data-lang="python"');
    expect(html).toContain('data-lang="bash"');
  });

  it('recovers the exact source from the rendered block', () => {
    // The Run button reads `textContent` off the <code> element, so the
    // highlighted markup has to un-escape to what the model wrote.
    const source = 'if (a < b && c > d) { console.log("x"); }';
    const html = render('```javascript\n' + source + '\n```');
    const body = /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1] ?? '';
    const text = body
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    expect(text.trim()).toBe(source);
  });

  it('escapes a language label that tries to break out of the attribute', () => {
    const html = enhanceCodeBlocks('<pre><code class="hljs language-a&quot;b">x</code></pre>');
    expect(html).not.toContain('data-lang="a"b"');
  });
});

describe('allowRun: false (the public share view)', () => {
  it('drops the run button but keeps copy', () => {
    const html = enhanceCodeBlocks(
      sanitizeChatHtml(marked.parse('```python\nprint(1)\n```') as string),
      { allowRun: false },
    );
    expect(html).toContain('cc-copy');
    expect(html).not.toContain('cc-run');
    expect(html).toContain('code-card');
  });

  it('still highlights and labels the block', () => {
    const html = enhanceCodeBlocks(
      sanitizeChatHtml(marked.parse('```python\ndef f(): pass\n```') as string),
      { allowRun: false },
    );
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('data-lang="python"');
  });
});

describe('build app button (the deterministic half of the choice)', () => {
  it('offers build on languages that could be an app', () => {
    expect(isBuildable('html')).toBe(true);
    expect(isBuildable('js')).toBe(true);
    expect(isBuildable('py')).toBe(true);
  });

  it('withholds it where an app makes no sense', () => {
    expect(isBuildable('bash')).toBe(false);
    expect(isBuildable('css')).toBe(false);
    expect(isBuildable('json')).toBe(false);
    expect(isBuildable('')).toBe(false);
  });

  it('renders on a buildable block regardless of what the model offered', () => {
    // The reported failure: "write me a flappy bird html script in chat" is an
    // explicit choice, so the model correctly emits no [[code-route]] marker —
    // and the route to an app then has to come from the block itself.
    const html = render('```html\n<canvas id="game"></canvas>\n```');
    expect(html).toContain('cc-build');
  });

  it('is absent on a bash block', () => {
    expect(render('```bash\nls -la\n```')).not.toContain('cc-build');
  });

  it('is withheld from the public share view along with run', () => {
    const html = enhanceCodeBlocks(
      sanitizeChatHtml(marked.parse('```python\nprint(1)\n```') as string),
      { allowRun: false },
    );
    expect(html).not.toContain('cc-build');
  });
});
