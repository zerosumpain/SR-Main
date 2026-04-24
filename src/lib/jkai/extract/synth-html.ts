// src/lib/jkai/extract/synth-html.ts
import { marked } from 'marked';
import type { SynthesizeResult } from './types';

export async function synthesizeHtml(markdown: string, title?: string): Promise<SynthesizeResult> {
  const body = await marked.parse(markdown, { async: true });
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title ?? 'Document')}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.55;} pre{background:#f5f5f5;padding:.75rem;overflow:auto;} code{font-family:ui-monospace,Menlo,monospace;}</style>
</head>
<body>
${body}
</body>
</html>`;
  return {
    buffer: Buffer.from(html, 'utf8'),
    mimeType: 'text/html',
    suggestedExtension: '.html',
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
