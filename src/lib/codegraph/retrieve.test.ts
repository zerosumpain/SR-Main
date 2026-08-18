import { describe, it, expect } from 'vitest';
import { buildContextBlock, type RetrievalResult } from './retrieve';
import { parseCgql, cgqlForFiles } from './query';
import { relevanceOf } from './relevance';

const rel = () => relevanceOf({ served: 0, helpful: 0, unhelpful: 0, observedAt: null });

function result(over: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    plan: parseCgql(cgqlForFiles(['src/lib/connectors/probes.ts'])!),
    seedNodeIds: ['n1'],
    nodes: [],
    lessons: [],
    episodes: [],
    outcome: 'served',
    durationMs: 1,
    ...over,
  };
}

const node = (canonicalPath: string) => ({
  id: canonicalPath,
  canonicalPath,
  kind: 'file',
  episodeCount: 0,
  lessonCount: 0,
});

const lesson = (title: string, body: string) => ({
  id: title,
  title,
  body,
  citedPaths: [],
  origin: 'memory-note',
  relevance: rel(),
});

describe('the related-file list reaches the agent', () => {
  it('renders the neighbourhood the walk found', () => {
    const block = buildContextBlock(
      result({ nodes: [node('src/lib/connectors/monitor.ts'), node('src/lib/connectors/summary.ts')] }),
    );
    expect(block).toContain('Files that change alongside these');
    expect(block).toContain('src/lib/connectors/monitor.ts');
  });

  it('survives a full lesson budget', () => {
    /*
     * The regression this test exists for: the list was assembled AFTER the
     * lessons packer had spent the budget, behind an "if it still fits". The
     * packer fills the budget by design, so it never fitted — the section was
     * live code that had never once been rendered, and no counter said so.
     */
    const fat = Array.from({ length: 4 }, (_, i) => lesson(`Rule ${i}`, 'x'.repeat(2000)));
    const block = buildContextBlock(result({ lessons: fat, nodes: [node('src/lib/connectors/monitor.ts')] }));
    expect(block).toContain('Rule 0');
    expect(block).toContain('Files that change alongside these');
  });

  it('drops the files the caller already named', () => {
    // Naming the agent the file it just told us about is pure cost, and it
    // crowds out the neighbours that are the entire point of the section.
    const block = buildContextBlock(
      result({ nodes: [node('src/lib/connectors/probes.ts'), node('src/lib/connectors/monitor.ts')] }),
    );
    expect(block).toContain('src/lib/connectors/monitor.ts');
    expect(block).not.toContain('### Files that change alongside these\nsrc/lib/connectors/probes.ts');
  });

  it('omits the heading entirely when the seed is all there is', () => {
    const block = buildContextBlock(result({ nodes: [node('src/lib/connectors/probes.ts')] }));
    expect(block).not.toContain('Files that change alongside these');
  });

  it('still says NO PRECEDENT rather than nothing', () => {
    // An empty block is indistinguishable from a retrieval that never ran —
    // which is exactly how the tool bridge stayed broken for sixty days.
    const block = buildContextBlock(result({ outcome: 'empty' }));
    expect(block).toContain('NO PRECEDENT');
  });
});
