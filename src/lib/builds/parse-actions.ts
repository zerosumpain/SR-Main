import type { JkaiIteration } from '$lib/db/schema';

export interface FileChange {
  path: string;
  iter: number;
  action: 'write' | 'edit' | 'read' | 'bash' | 'tool';
  preview: string;
}

interface ActionLike {
  lang?: string;
  code?: string;
}

export function buildFileTimeline(iterations: JkaiIteration[]): FileChange[] {
  const out: FileChange[] = [];
  for (const it of iterations) {
    const acts = (it.actions as ActionLike[] | null) ?? [];
    for (const a of acts) {
      const lang = String(a.lang ?? '').toLowerCase();
      const code = String(a.code ?? '');
      if (lang === 'write' || lang === 'edit') {
        const firstLine = code.split('\n')[0] ?? '';
        const path = firstLine.replace(/^(write|edit)\s+/, '').trim();
        if (!path) continue;
        out.push({
          path,
          iter: it.number,
          action: lang as 'write' | 'edit',
          preview: code.slice(0, 1500),
        });
      }
    }
  }
  // Latest first by iter; within iter, preserve original order (later actions later)
  return out.sort((a, b) => b.iter - a.iter);
}
