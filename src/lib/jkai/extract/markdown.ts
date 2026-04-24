// src/lib/jkai/extract/markdown.ts
import { marked } from 'marked';
import type { ExtractResult } from './types';

export function extractMarkdown(buffer: Buffer): ExtractResult {
  const md = buffer.toString('utf8');
  const tokens = marked.lexer(md);
  const headings: Array<{ level: number; text: string }> = [];
  const lines: string[] = [];

  const walk = (toks: unknown[]) => {
    for (const t of toks as Array<Record<string, unknown>>) {
      if (t.type === 'heading') {
        headings.push({ level: t.depth as number, text: (t.text as string).trim() });
        lines.push((t.text as string).trim());
      } else if (t.type === 'paragraph' || t.type === 'text') {
        if (t.text) lines.push((t.text as string).trim());
      } else if (t.type === 'list') {
        for (const item of (t.items as Array<Record<string, unknown>>) ?? []) {
          if (item.text) lines.push('- ' + (item.text as string).trim());
        }
      } else if (t.type === 'code') {
        if (t.text) lines.push((t.text as string).trim());
      } else if (t.type === 'blockquote' && Array.isArray(t.tokens)) {
        walk(t.tokens as unknown[]);
      }
    }
  };
  walk(tokens);

  // Strip residual md syntax (bold/italic markers) from line content
  const cleaned = lines
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/_([^_]+)_/g, '$1'))
    .join('\n\n');

  return {
    text: cleaned,
    meta: { kind: 'markdown', headings },
  };
}
