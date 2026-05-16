import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'publish-page-test-'));

vi.mock('$lib/jkai/sandbox', () => ({
  getPublishedDir: () => tmpRoot,
}));

import { handlePublishPage } from './publish-page';

afterEach(() => {
  // Each test cleans its own slug dir; this is a belt-and-braces sweep.
});

describe('handlePublishPage', () => {
  it('rejects empty/invalid slug', async () => {
    const r = await handlePublishPage({ slug: '   ', content: 'hi' });
    expect(r.success).toBe(false);
  });

  it('rejects empty content', async () => {
    const r = await handlePublishPage({ slug: 'foo', content: '' });
    expect(r.success).toBe(false);
  });

  it('writes raw HTML through unchanged', async () => {
    const slug = 'unit-html';
    const html = '<!doctype html><html><body><p>direct</p></body></html>';
    const r = await handlePublishPage({ slug, content: html, format: 'html' });
    expect(r.success).toBe(true);
    const out = readFileSync(join(tmpRoot, slug, 'index.html'), 'utf8');
    expect(out).toBe(html);
  });

  it('renders markdown into a basic HTML shell', async () => {
    const slug = 'unit-md';
    const md = '# Title\n\nSome **paragraph**.\n\n- one\n- two\n';
    const r = await handlePublishPage({ slug, content: md, format: 'markdown', title: 'My Page' });
    expect(r.success).toBe(true);
    const out = readFileSync(join(tmpRoot, slug, 'index.html'), 'utf8');
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<title>My Page</title>');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<li>one</li>');
  });

  it('auto-detects HTML format from doctype', async () => {
    const slug = 'unit-auto';
    const r = await handlePublishPage({ slug, content: '<!doctype html><body>x</body>' });
    expect(r.success).toBe(true);
    expect((r.data as any).format).toBe('html');
  });

  it('returns the public URL with the sanitised slug', async () => {
    const r = await handlePublishPage({ slug: 'My Cool Slug!!', content: '<!doctype html><body>x</body>' });
    expect(r.success).toBe(true);
    expect((r.data as any).slug).toBe('my-cool-slug');
    expect((r.data as any).url).toBe('https://strangeramblings.com/projects/my-cool-slug/');
  });

  it('escapes hostile markdown content', async () => {
    const slug = 'unit-escape';
    const md = '# Hello\n\n<script>alert(1)</script>\n';
    const r = await handlePublishPage({ slug, content: md, format: 'markdown' });
    expect(r.success).toBe(true);
    const out = readFileSync(join(tmpRoot, slug, 'index.html'), 'utf8');
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

// Teardown: best effort, vitest will tolerate junk in tmpdir.
process.on('exit', () => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});
