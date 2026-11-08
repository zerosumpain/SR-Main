import { describe, it, expect } from 'vitest';
import { rank, redact, renderReport, TRIAGE_SQL, type TriageRow } from '../../scripts/custom-tools-triage';

const base: TriageRow = {
  name: 't', toolset: 'misc', enabled: true, created_by: 'orchestrator', run_count: 10, error_count: 0,
  last_run_at: '2026-10-20T00:00:00Z', created_at: '2026-08-01T00:00:00Z', description: 'does a thing', code_chars: 100,
  shells_out: false, calls_platform: false, uses_network: false, touches_secrets: false, writes_db: false, writes_files: false,
  chat_calls: 2,
};
const NOW = Date.parse('2026-10-28T00:00:00Z');

describe('custom-tools triage', () => {
  it('never selects the handler code itself', () => {
    expect(TRIAGE_SQL).not.toMatch(/SELECT[\s\S]*\bhandler_code\s*(,|AS|\n\s*FROM)/i);
    expect(TRIAGE_SQL).toMatch(/length\(handler_code\)/);
  });

  it('ranks chat use and health above probe runs, and marks reach', () => {
    const ranked = rank([
      { ...base, name: 'used' },
      { ...base, name: 'shell', shells_out: true },
      { ...base, name: 'probe_only', chat_calls: 0, run_count: 60 },
      { ...base, name: 'never', run_count: 0, chat_calls: 0, last_run_at: null },
      { ...base, name: 'blog_list' },
    ], new Set(['blog_list']), NOW);
    const by = Object.fromEntries(ranked.map((r) => [r.name, r]));
    expect(by.used.tier).toBe('keep-candidate');
    expect(by.shell.tier).toBe('review');
    expect(by.probe_only.tier).toBe('review');
    expect(by.never.tier).toBe('retire');
    expect(by.blog_list).toMatchObject({ tier: 'retire', collides: true });
  });

  it('redacts token-shaped strings from descriptions', () => {
    expect(redact('key fake_token_0123456789abcdefghijklmn here')).toBe('key [redacted] here');
    expect(renderReport(rank([{ ...base, description: 'uses abcdefghijklmnopqrstuvwxyz0123456789' }], new Set(), NOW), 'now', 'test')).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});
