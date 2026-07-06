// The preview sanitiser is a superset of the chat profile: it must allow document
// images (incl. mammoth `data:` base64) and table structure, while STILL stripping
// scripts, event handlers and dangerous URL schemes.
import { describe, it, expect } from 'vitest';
import { sanitizePreviewHtml, sanitizeChatHtml } from './sanitize-chat';

describe('sanitizePreviewHtml', () => {
  it('keeps inline data: images (mammoth) and http(s) images', () => {
    const data = sanitizePreviewHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">');
    expect(data).toContain('<img');
    expect(data).toContain('data:image/png;base64');
    const web = sanitizePreviewHtml('<img src="https://example.com/a.png">');
    expect(web).toContain('https://example.com/a.png');
  });

  it('keeps table + heading structure', () => {
    const html = sanitizePreviewHtml('<h2>T</h2><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('keeps <section> wrappers and class names (slide cards / table styling)', () => {
    const html = sanitizePreviewHtml('<section class="pptx-slide"><h3 class="pptx-title">T</h3><ul class="pptx-body"><li>x</li></ul></section>');
    expect(html).toContain('<section');
    expect(html).toContain('class="pptx-slide"');
    expect(html).toContain('class="pptx-title"');
    expect(html).toContain('class="pptx-body"');
  });

  it('still strips scripts, event handlers and javascript: urls', () => {
    expect(sanitizePreviewHtml('<script>alert(1)</script>')).not.toContain('<script');
    expect(sanitizePreviewHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
    expect(sanitizePreviewHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    // data: is allowed ONLY on <img>, never as a link href.
    expect(sanitizePreviewHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')).not.toContain('data:text/html');
  });

  it('leaves the strict chat sanitiser unchanged (no <img>)', () => {
    expect(sanitizeChatHtml('<img src="data:image/png;base64,AAAA">')).not.toContain('<img');
  });
});
