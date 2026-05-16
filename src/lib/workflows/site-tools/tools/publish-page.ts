// src/lib/workflows/site-tools/tools/publish-page.ts
// Publishes a chat-authored HTML (or markdown) page under /projects/<slug>/
// without requiring a rebuild or service restart. Writes into the same
// `data/jkai-projects/<slug>/index.html` location the JKAI builder uses, so
// the existing `/projects/[slug]/[...path]/+server.ts` route picks it up on
// the very next request.
//
// This is the missing primitive that turned the "make this analysis a URL"
// chat into a 25-minute SCP/static-cache saga: previously the model had to
// improvise via ssh+scp+restart; now it's one tool call.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { getPublishedDir } from '$lib/jkai/sandbox';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const PUBLIC_BASE_URL = 'https://strangeramblings.com';

function sanitizeSlug(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!slug || slug === '.' || slug === '..') return null;
  return slug;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Cheap markdown-ish → HTML conversion. Enough for headings, paragraphs,
 *  fenced code, and bullet lists. Not a full parser — for richer output the
 *  caller should pass `format: 'html'` and pre-render upstream. */
function renderMarkdown(md: string, title: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    if (line.startsWith('```')) {
      flushList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    if (/^#{1,6}\s+/.test(line)) {
      flushList();
      const m = line.match(/^(#{1,6})\s+(.*)$/)!;
      out.push(`<h${m[1].length}>${escapeHtml(m[2])}</h${m[1].length}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${escapeHtml(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (!line.trim()) { flushList(); continue; }
    flushList();
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushList();
  if (inCode) out.push('</code></pre>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 system-ui, -apple-system, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  h1, h2, h3 { line-height: 1.2; }
  pre { background: rgba(127,127,127,0.12); padding: 0.75rem 1rem; border-radius: 6px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
  ul { padding-left: 1.4rem; }
</style>
</head>
<body>
<main>
${out.join('\n')}
</main>
</body>
</html>`;
}

interface PublishArgs {
  slug: string;
  content: string;
  format?: 'html' | 'markdown';
  title?: string;
}

export async function handlePublishPage(args: PublishArgs): Promise<ToolResult> {
  const slug = sanitizeSlug(args.slug);
  if (!slug) {
    return { success: false, error: 'slug must be a non-empty string of letters, digits, and hyphens (max 80 chars).' };
  }
  if (typeof args.content !== 'string' || !args.content.length) {
    return { success: false, error: 'content must be a non-empty string.' };
  }
  if (args.content.length > 4 * 1024 * 1024) {
    return { success: false, error: 'content exceeds 4MB limit.' };
  }

  const format = args.format ?? (/<!doctype html>|<html[\s>]/i.test(args.content) ? 'html' : 'markdown');
  const title = args.title?.slice(0, 200) || slug.replace(/-/g, ' ');
  const html = format === 'html' ? args.content : renderMarkdown(args.content, title);

  const destDir = join(getPublishedDir(), slug);
  await mkdir(destDir, { recursive: true });
  await writeFile(join(destDir, 'index.html'), html, 'utf8');

  const url = `${PUBLIC_BASE_URL}/projects/${slug}/`;
  return {
    success: true,
    data: {
      slug,
      url,
      sizeBytes: Buffer.byteLength(html, 'utf8'),
      format,
    },
  };
}

register({
  name: 'publish_page',
  description:
    'Publish a static HTML or markdown page at https://strangeramblings.com/projects/<slug>/. Use this whenever the user asks for a URL/endpoint to view a report, analysis, or summary — it is faster and more reliable than editing the repo or copying files via ssh/scp. Pages are served live on the next request, no rebuild or restart required.',
  toolset: 'media',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'URL slug (letters, digits, hyphens; max 80 chars). The page will live at /projects/<slug>/. Choose something descriptive and stable.',
      },
      content: {
        type: 'string',
        description: 'Full HTML body (with <!doctype html>) or markdown. Max 4MB.',
      },
      format: {
        type: 'string',
        enum: ['html', 'markdown'],
        description: 'Optional. Inferred from a <!doctype html>/<html> probe when omitted.',
      },
      title: {
        type: 'string',
        description: 'Document <title> — only used when format=markdown to wrap in a basic HTML shell.',
      },
    },
    required: ['slug', 'content'],
  },
  handler: async (args) => {
    return handlePublishPage(args as unknown as PublishArgs);
  },
});
