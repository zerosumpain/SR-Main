import { describe, it, expect, vi } from 'vitest';

// workspace-grounding imports `$lib/db`, which eagerly constructs a pg Pool from
// $env at module load. Stub it — the pure renderers under test never touch it.
vi.mock('$lib/db', () => ({ db: {} }));

import {
  renderWorkflowMemorySection,
  previewStoreValue,
} from '$lib/workflows/orchestrator/workspace-grounding';

describe('renderWorkflowMemorySection (B8 always-on workflow memory)', () => {
  it('emits the empty-state guidance when there are no stored keys', () => {
    const out = renderWorkflowMemorySection([]);
    expect(out).toContain('### Workflow memory');
    expect(out).toContain('No stored keys yet');
    expect(out).toContain('{{state.KEY}}');
  });

  it('lists each key with its updated_at and a value preview when keys exist', () => {
    const out = renderWorkflowMemorySection([
      { key: 'seen_news_urls', value: ['https://a', 'https://b'], updatedAt: '2026-07-16T07:00:00.000Z' },
      { key: 'last_run', value: 'done', updatedAt: new Date('2026-07-15T06:30:00.000Z') },
    ]);
    expect(out).toContain('### Workflow memory');
    expect(out).toContain('`seen_news_urls`');
    expect(out).toContain('2026-07-16T07:00:00.000Z');
    expect(out).toContain('`last_run`');
    expect(out).toContain('done');
    // The populated form must NOT emit the empty-state guidance.
    expect(out).not.toContain('No stored keys yet');
  });
});

describe('previewStoreValue', () => {
  it('passes short strings through', () => {
    expect(previewStoreValue('hello')).toBe('hello');
  });
  it('JSON-encodes non-strings on a single line', () => {
    expect(previewStoreValue({ a: 1 })).toBe('{"a":1}');
  });
  it('caps the preview at 120 chars with an ellipsis', () => {
    const long = 'x'.repeat(500);
    const out = previewStoreValue(long);
    expect(out.length).toBe(121); // 120 chars + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
  it('renders null/undefined as "null"', () => {
    expect(previewStoreValue(null)).toBe('null');
    expect(previewStoreValue(undefined)).toBe('null');
  });
});
