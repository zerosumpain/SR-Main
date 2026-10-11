import { describe, expect, it } from 'vitest';
import {
  ChronicleSchema,
  InventionsSchema,
  TalkSchema,
  TEXT_MAX,
  WhisperAcceptedSchema,
  WhispersSchema,
  chronicleId,
  clip,
  idempotencyKey,
  parseWhisperBody,
  talkQuery,
  whispersQuery,
} from './owner';

const valley = { seed: 4242, generation: 3, day: 12, clock: 'Day 12, 09:30' };

describe('clip', () => {
  it('strips control characters but keeps newlines and tabs', () => {
    expect(clip('a\u0000b\u0007c\nd\te\u007f', 100)).toBe('abc\nd\te');
  });
  it('caps with an ellipsis and never splits a surrogate pair', () => {
    expect(clip('abcdef', 4)).toBe('abc…');
    const out = clip(`ab${'\u{1F332}'}cd`, 4);
    expect(out).toBe('ab…');
    expect(out.length).toBeLessThanOrEqual(4);
  });
});

describe('TalkSchema', () => {
  const entry = {
    id: 7,
    minute: 1234.5,
    when: 'Day 12, 09:30',
    who: 'main',
    name: 'JKai',
    kind: 'speech',
    to: 'companion',
    toName: 'Wren',
    text: 'Shall we gather reeds?',
    detail: null,
  };

  it('keeps the contract and drops keys it does not name', () => {
    const out = TalkSchema.parse({
      v: 1,
      valley: { ...valley, secret: 'x' },
      entries: [{ ...entry, def: { visual: {} }, prompt: 'SYSTEM' }],
      oldestId: 7,
      latestId: 7,
      more: false,
      debug: 'x',
    });
    expect(Object.keys(out).sort()).toEqual(['entries', 'latestId', 'more', 'oldestId', 'v', 'valley']);
    expect(Object.keys(out.valley).sort()).toEqual(['clock', 'day', 'generation', 'seed']);
    expect(Object.keys(out.entries[0]).sort()).toEqual(['detail', 'id', 'kind', 'minute', 'name', 'text', 'to', 'toName', 'when', 'who']);
  });

  it('drops a malformed entry or an unknown kind instead of failing the page', () => {
    const out = TalkSchema.parse({
      v: 1,
      valley,
      entries: [entry, { ...entry, id: 'x' }, { ...entry, id: 8, kind: 'system' }, null, { ...entry, id: 9, kind: 'thought', to: 5 }],
      oldestId: 7,
      latestId: 9,
      more: true,
    });
    expect(out.entries.map((e) => e.id)).toEqual([7, 9]);
    expect(out.entries[1].to).toBeNull();
  });

  it('caps the text at TEXT_MAX and the page at 200 entries', () => {
    const out = TalkSchema.parse({
      v: 1,
      valley,
      entries: Array.from({ length: 250 }, (_, i) => ({ ...entry, id: i, text: 'w'.repeat(5000) })),
      oldestId: 0,
      latestId: 249,
      more: true,
    });
    expect(out.entries).toHaveLength(200);
    expect(out.entries[0].text.length).toBe(TEXT_MAX);
  });

  it('refuses a body that is not version 1 or has no valley seed', () => {
    expect(TalkSchema.safeParse({ v: 2, valley, entries: [] }).success).toBe(false);
    expect(TalkSchema.safeParse({ v: 1, valley: { day: 1 }, entries: [] }).success).toBe(false);
  });
});

describe('ChronicleSchema', () => {
  it('never carries the prompts or guardrails, and caps the thought', () => {
    const out = ChronicleSchema.parse({
      v: 1,
      valley,
      who: { id: 'main', name: 'JKai', alive: true, causeOfDeath: null, persona: 'Curious.' },
      now: {
        lastThought: 't'.repeat(3000),
        mood: 'calm',
        goal: 'Build a raft',
        ambitions: [{ text: 'Cross the lake', status: 'open' }],
        values: [{ text: 'Share food', strength: 40, since: 'Day 2, 08:00', kept: 2, broken: 0, rules: [{ effect: 'prefer', verb: 'give', target: 'food' }] }],
        attitudes: [{ subject: 'wolves', feeling: -30, reason: 'They bite', since: 'Day 3, 10:00' }],
        people: [{ name: 'Wren', set: true, trust: 60, affection: 55, note: 'Kind', partner: true }],
        skills: 'SECRET',
      },
      timeline: [{ minute: 10, day: 0, when: 'Day 0, 00:10', kind: 'start', icon: '*', text: 'Woke up.' }],
      diary: [{ day: 1, text: 'A long day.' }],
      origin: { system: 'SYSTEM PROMPT' },
      currentSystem: 'SYSTEM PROMPT',
      guardrails: [{ title: 'x', items: ['y'] }],
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain('SYSTEM PROMPT');
    expect(s).not.toContain('SECRET');
    expect(out).not.toHaveProperty('guardrails');
    expect(out.now?.lastThought?.length).toBe(TEXT_MAX);
    expect(out.now?.values[0].rules).toEqual([{ effect: 'prefer', verb: 'give', target: 'food' }]);
  });
});

describe('InventionsSchema', () => {
  it('drops visual and effects, keeps defs without a model, and caps refused', () => {
    const out = InventionsSchema.parse({
      v: 1,
      valley,
      inventions: [
        { id: 'reed_mat', name: 'Reed mat', kind: 'item', description: 'Woven.', inventor: 'Wren', day: 4, placed: false, summary: 'craft: 4 Reeds', notes: ['trimmed'], rationale: 'Dry floor.', visual: { parts: [1] }, effects: [{ type: 'x' }] },
        { id: 'pemmican', name: 'Pemmican', kind: 'food', description: null, inventor: null, day: null, placed: false, summary: null, notes: [], rationale: null },
      ],
      refused: Array.from({ length: 40 }, (_, i) => ({ when: `Day ${i}, 10:00`, text: 'Too heavy.' })),
    });
    expect(out.inventions).toHaveLength(2);
    expect(out.inventions[0].notes).toEqual(['trimmed']);
    expect(out.inventions[0]).not.toHaveProperty('visual');
    expect(out.inventions[0]).not.toHaveProperty('effects');
    expect(out.inventions[1].kind).toBe('food');
    expect(out.refused).toHaveLength(30);
  });

  it('keeps all twelve referee notes Wildmind stores, and no more', () => {
    const notes = Array.from({ length: 14 }, (_, i) => `note ${i + 1}`);
    const out = InventionsSchema.parse({
      v: 1,
      valley,
      inventions: [{ id: 'kiln', name: 'Kiln', kind: 'building', description: null, inventor: 'JKai', day: 9, placed: true, summary: null, notes, rationale: null }],
      refused: [],
    });
    expect(out.inventions[0].notes).toEqual(notes.slice(0, 12));
  });
});

describe('WhispersSchema and WhisperAcceptedSchema', () => {
  it('keeps the heard link and the reserve', () => {
    const out = WhispersSchema.parse({
      v: 1,
      pending: ['Look east'],
      reserveLeftUsd: 0.21,
      modelAvailable: true,
      whispers: [
        { logId: 30, when: 'Day 12, 09:00', text: 'Look east', status: 'pending', answer: null },
        { logId: 20, when: 'Day 12, 08:00', text: 'Rest', status: 'heard', answer: { logId: 21, when: 'Day 12, 08:05', thought: 'I should rest.', goal: 'Sleep', mood: 'tired', extra: 1 } },
        { logId: 10, when: 'Day 12, 07:00', text: 'x', status: 'lost' },
      ],
    });
    expect(out.whispers.map((w) => w.status)).toEqual(['pending', 'heard']);
    expect(out.whispers[1].answer).toEqual({ logId: 21, when: 'Day 12, 08:05', thought: 'I should rest.', goal: 'Sleep', mood: 'tired' });
    expect(out.reserveLeftUsd).toBe(0.21);
  });

  it('reads an accepted whisper', () => {
    const out = WhisperAcceptedSchema.parse({ v: 1, ok: true, logId: 31, when: 'Day 12, 09:01', pending: ['a', 'b'], dropped: null, asleep: false, modelAvailable: true, token: 'x' });
    expect(out).toEqual({ v: 1, ok: true, logId: 31, when: 'Day 12, 09:01', pending: ['a', 'b'], dropped: null, asleep: false, modelAvailable: true });
  });
});

describe('queries', () => {
  it('rebuilds the talk query from checked values only', () => {
    const q = talkQuery(new URLSearchParams('before=120&since=abc&limit=999&who=wolf&kinds=speech,system,thought,speech&token=x'));
    expect(Object.fromEntries(q)).toEqual({ before: '120', limit: '200', kinds: 'speech,thought' });
    expect(Object.fromEntries(talkQuery(new URLSearchParams('who=companion&since=5')))).toEqual({ since: '5', limit: '100', who: 'companion' });
    expect(talkQuery(new URLSearchParams('limit=0')).get('limit')).toBe('1');
    expect(Object.fromEntries(talkQuery(new URLSearchParams('before=0&since=0')))).toEqual({ since: '0', limit: '100' });
  });

  it('accepts only main or companion for a chronicle', () => {
    expect(chronicleId(new URLSearchParams())).toBe('main');
    expect(chronicleId(new URLSearchParams('id=companion'))).toBe('companion');
    expect(chronicleId(new URLSearchParams('id=../settings'))).toBeNull();
  });

  it('clamps the whispers limit', () => {
    expect(whispersQuery(new URLSearchParams()).toString()).toBe('limit=20');
    expect(whispersQuery(new URLSearchParams('limit=500')).toString()).toBe('limit=50');
  });
});

describe('parseWhisperBody and idempotencyKey', () => {
  it('trims, strips control characters and enforces 1..240', () => {
    expect(parseWhisperBody({ text: '  Look\n east\u0007 ' })).toEqual({ ok: true, text: 'Look east' });
    expect(parseWhisperBody({ text: '   ' })).toEqual({ error: 'empty' });
    expect(parseWhisperBody({ text: 'x'.repeat(241) })).toEqual({ error: 'too-long' });
    expect(parseWhisperBody({ text: 'x'.repeat(240) })).toEqual({ ok: true, text: 'x'.repeat(240) });
    // Characters, not UTF-16 units: 240 trees are 480 units and still fit.
    expect(parseWhisperBody({ text: '\u{1F332}'.repeat(240) })).toMatchObject({ ok: true });
    expect(parseWhisperBody({ text: '\u{1F332}'.repeat(241) })).toEqual({ error: 'too-long' });
    expect(parseWhisperBody(null)).toEqual({ error: 'bad-request' });
    expect(parseWhisperBody({ text: 5 })).toEqual({ error: 'bad-request' });
    expect(parseWhisperBody(['x'])).toEqual({ error: 'bad-request' });
  });

  it('accepts only a UUID key', () => {
    expect(idempotencyKey('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(idempotencyKey('not-a-uuid')).toBeNull();
    expect(idempotencyKey(null)).toBeNull();
  });
});
