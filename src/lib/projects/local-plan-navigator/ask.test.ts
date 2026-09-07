import { describe, it, expect } from 'vitest';
import { parseAskBody, pickChunks, toChatChunks, MAX_PASSAGES, type NavigatorChunk } from './ask';

const chunk = (id: string): NavigatorChunk => ({
  id, doc: id.split('#')[0], docTitle: '2026 Regulations', kind: 'legislation', anchor: id.split('#')[1], route: '/reference/regulations-2026/part-4/', heading: '32. Gateway 3: prescribed requirements', text: 'x'.repeat(2000),
});

describe('local-plan-navigator ask body', () => {
  it('trims and caps the question and keeps only well-formed, distinct ids', () => {
    const { question, ids } = parseAskBody({ question: '  what   about\n reg 32? '.padEnd(900, 'z'), ids: ['regulations-2026#reg-32', 'regulations-2026#reg-32', 'nppf#PM15:1', '../etc/passwd', 42, 'a'.repeat(200)] });
    expect(question.length).toBe(600);
    expect(question.startsWith('what about reg 32?')).toBe(true);
    expect(ids).toEqual(['regulations-2026#reg-32', 'nppf#PM15:1']);
  });

  it(`keeps at most ${MAX_PASSAGES} ids and tolerates garbage`, () => {
    const ids = Array.from({ length: 12 }, (_, i) => `doc#a-${i}`);
    expect(parseAskBody({ ids }).ids).toHaveLength(MAX_PASSAGES);
    expect(parseAskBody(null)).toEqual({ question: '', ids: [] });
    expect(parseAskBody('nope')).toEqual({ question: '', ids: [] });
  });

  it('looks passages up by id in the page order and drops unknown ones', () => {
    const byId = new Map([chunk('a#1'), chunk('b#2')].map((c) => [c.id, c]));
    expect(pickChunks(['b#2', 'zzz#9', 'a#1'], byId).map((c) => c.id)).toEqual(['b#2', 'a#1']);
  });

  it('shapes chunks for the shared handler with a site URL and a bounded text', () => {
    const [out] = toChatChunks([chunk('regulations-2026#reg-32')]);
    expect(out.url).toBe('https://strangeramblings.com/projects/local-plan-navigator/reference/regulations-2026/part-4/#reg-32');
    expect(out.text).toHaveLength(1500);
    expect(out.title).toContain('prescribed requirements');
  });
});
