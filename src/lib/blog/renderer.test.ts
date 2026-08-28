import { describe, expect, it } from 'vitest';
import { renderContent } from './renderer';

describe('renderContent — markdown', () => {
  it('keeps bullet and numbered lists', () => {
    const out = renderContent('- one\n- two\n\n1. first\n2. second', 'markdown');
    expect(out).toContain('<ul>');
    expect(out).toContain('<ol>');
    expect(out.match(/<li>/g)?.length).toBe(4);
  });

  it('renders an image title as a figcaption', () => {
    const out = renderContent('![alt text](/api/blog/images/1/x.png "The caption")', 'markdown');
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>The caption</figcaption>');
    expect(out).toContain('src="/api/blog/images/1/x.png"');
    expect(out).toContain('alt="alt text"');
  });

  it('renders a plain image without a figure', () => {
    const out = renderContent('![alt](/api/blog/images/1/x.png)', 'markdown');
    expect(out).toContain('<img');
    expect(out).not.toContain('<figure>');
  });
});

describe('renderContent — sanitizer', () => {
  it('keeps a same-origin /projects/ iframe embed', () => {
    const html =
      '<figure class="project-embed"><iframe src="/projects/terminal-descent" title="Terminal Descent" loading="lazy" allowfullscreen="true"></iframe>' +
      '<figcaption><a href="/projects/terminal-descent" target="_blank" rel="noopener noreferrer">Terminal Descent — open full page ↗</a></figcaption></figure>';
    const out = renderContent(html, 'html');
    expect(out).toContain('<iframe src="/projects/terminal-descent"');
    expect(out).toContain('class="project-embed"');
    expect(out).toContain('figcaption');
  });

  it('drops iframes pointing at other relative paths', () => {
    const out = renderContent('<p>hi</p><iframe src="/admin"></iframe>', 'html');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('<p>hi</p>');
  });

  it('drops external iframes not on the allow-list, tag and all', () => {
    const out = renderContent('<iframe src="https://evil.example.com/x"></iframe>', 'html');
    expect(out).not.toContain('<iframe');
  });

  it('still allows YouTube iframes', () => {
    const out = renderContent('<iframe src="https://www.youtube.com/embed/abc"></iframe>', 'html');
    expect(out).toContain('<iframe src="https://www.youtube.com/embed/abc"');
  });

  it('keeps site font-family tokens and strips arbitrary fonts', () => {
    const kept = renderContent('<p><span style="font-family: var(--font-mono)">code-ish</span></p>', 'html');
    expect(kept).toContain('font-family:var(--font-mono)');
    const stripped = renderContent('<p><span style="font-family: Comic Sans MS">nope</span></p>', 'html');
    expect(stripped).not.toContain('Comic Sans');
  });

  it('keeps font-size steps', () => {
    const out = renderContent('<p><span style="font-size: 1.25em">big</span></p>', 'html');
    expect(out).toContain('font-size:1.25em');
  });

  it('keeps captioned image figures', () => {
    const out = renderContent('<figure><img src="/api/blog/images/1/s.png" alt="a"><figcaption>Shot</figcaption></figure>', 'html');
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>Shot</figcaption>');
  });
});
