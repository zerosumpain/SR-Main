import { describe, it, expect } from 'vitest';
import { renderContent } from '$lib/blog/renderer';

describe('renderContent', () => {
  it('renders markdown to HTML', () => {
    const result = renderContent('**bold** and *italic*', 'markdown');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('passes HTML through unchanged', () => {
    const html = '<p>Hello <strong>world</strong></p>';
    expect(renderContent(html, 'html')).toBe(html);
  });

  it('renders headings', () => {
    expect(renderContent('## Heading Two', 'markdown')).toContain('<h2');
  });

  it('renders code blocks', () => {
    const result = renderContent('```ts\nconst x = 1;\n```', 'markdown');
    expect(result).toContain('<code');
  });

  it('renders links', () => {
    const result = renderContent('[link](https://example.com)', 'markdown');
    expect(result).toContain('href="https://example.com"');
  });

  it('renders images', () => {
    const result = renderContent('![alt](/img.png)', 'markdown');
    expect(result).toContain('<img');
  });

  it('renders blockquotes', () => {
    expect(renderContent('> quote', 'markdown')).toContain('<blockquote');
  });

  it('renders lists', () => {
    expect(renderContent('- one\n- two', 'markdown')).toContain('<ul>');
  });

  it('renders inline code', () => {
    expect(renderContent('Use `console.log()`', 'markdown')).toContain(
      '<code>console.log()</code>'
    );
  });
});
