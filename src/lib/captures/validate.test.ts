import { describe, expect, it } from 'vitest';
import {
  initialSpeakers,
  parseCaptureIntake,
  parseDecision,
  parsePatch,
  validateActionParams,
  validateAnalysis,
  validateProposedAction,
  validateScreenReply,
} from './validate';
import type { CaptureSpeaker } from './types';

// Every fixture is synthetic.

const BASE = { startedAt: '2026-10-26T10:00:00Z', endedAt: '2026-10-26T10:05:00Z', transcript: 'hello there' };

describe('parseCaptureIntake', () => {
  it('accepts the contract body and fills its defaults', () => {
    const r = parseCaptureIntake({
      ...BASE,
      turns: [{ speaker: 'S1', start: 0, end: 2, text: 'hello' }, { speaker: 'S2', start: 2, end: 4, text: 'there' }],
      speakerCount: 2,
      ownerSpeaker: 'S1',
      screen: { ocrText: 'Inbox', appHint: 'Mail' },
      place: { lat: 51.5, lon: -0.12 },
      audio: true,
      screenshot: true,
      source: 'button',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startedAt).toBe('2026-10-26T10:00:00.000Z');
    expect(r.value.speakerCount).toBe(2);
    expect(r.value.screen).toEqual({ ocrText: 'Inbox', appHint: 'Mail', denied: false });
    expect(r.value.screenshot).toBe(true);
    expect(r.value.source).toBe('button');
  });

  it('defaults to audio, no screenshot, one speaker, source app', () => {
    const r = parseCaptureIntake(BASE);
    expect(r).toMatchObject({ ok: true, value: { audio: true, screenshot: false, speakerCount: 1, source: 'app', turns: [] } });
  });

  it('refuses wrong types rather than coercing them', () => {
    expect(parseCaptureIntake({ ...BASE, startedAt: 'yesterday-ish' }).ok).toBe(false);
    expect(parseCaptureIntake({ ...BASE, endedAt: '2026-10-26T09:00:00Z' }).ok).toBe(false);
    expect(parseCaptureIntake({ ...BASE, audio: 'yes' }).ok).toBe(false);
    expect(parseCaptureIntake({ ...BASE, speakerCount: 0 }).ok).toBe(false);
    expect(parseCaptureIntake({ ...BASE, source: 'siri' }).ok).toBe(false);
    expect(parseCaptureIntake({ ...BASE, place: { lat: 200, lon: 0 } }).ok).toBe(false);
    expect(parseCaptureIntake({ ...BASE, turns: [{ speaker: 'a speaker with spaces', start: 0, end: 1, text: '' }] }).ok).toBe(false);
    expect(parseCaptureIntake({ ...BASE, turns: [{ speaker: 'S1', start: 3, end: 1, text: '' }] }).ok).toBe(false);
    expect(parseCaptureIntake('nope').ok).toBe(false);
  });

  it('needs audio or words', () => {
    expect(parseCaptureIntake({ startedAt: BASE.startedAt, audio: false }).ok).toBe(false);
    expect(parseCaptureIntake({ startedAt: BASE.startedAt, audio: false, transcript: 'typed note' }).ok).toBe(true);
  });

  it('never expects a screenshot the deny list dropped', () => {
    const r = parseCaptureIntake({ ...BASE, screenshot: true, screen: { ocrText: '', denied: true } });
    expect(r.ok && r.value.screenshot).toBe(false);
  });
});

describe('initialSpeakers', () => {
  it('marks the owner label and fills up to the count', () => {
    const s = initialSpeakers({ turns: [], speakerCount: 3, ownerSpeaker: 'S2' });
    expect(s.map((x) => x.label)).toEqual(['S1', 'S2', 'S3']);
    expect(s.filter((x) => x.isOwner).map((x) => x.label)).toEqual(['S2']);
  });

  it('treats a lone speaker as the recorder', () => {
    expect(initialSpeakers({ turns: [], speakerCount: 1, ownerSpeaker: null })).toEqual([
      { label: 'S1', guess: null, confirmed: null, isOwner: true },
    ]);
  });
});

describe('validateActionParams', () => {
  it('checks each kind against its own shape', () => {
    expect(validateActionParams('research', { question: 'What does a heat pump cost?' }).ok).toBe(true);
    expect(validateActionParams('research', { topic: 'wrong key' })).toMatchObject({ ok: false });
    expect(validateActionParams('calendar', { title: 'Dentist', start: '2026-11-02T09:00:00Z' }).ok).toBe(true);
    expect(validateActionParams('calendar', { title: 'Dentist', start: 'next tuesday' }).ok).toBe(false);
    expect(validateActionParams('calendar', { title: 'Dentist', start: '2026-11-02T09:00:00Z', end: '2026-11-02T08:00:00Z' }).ok).toBe(false);
    expect(validateActionParams('followup', { when: '2026-11-02T09:00:00Z', message: 'Chase the quote' }).ok).toBe(true);
    expect(validateActionParams('followup', { message: 'no time' }).ok).toBe(false);
    expect(validateActionParams('remember', { fact: 'Sarah moved to Leeds', entity: 'Sarah' }).ok).toBe(true);
    expect(validateActionParams('remember', { fact: 'x' }).ok).toBe(false);
    expect(validateActionParams('todo_me', undefined)).toEqual({ ok: true, value: {} });
  });

  it('names the keys it got, never the values', () => {
    const r = validateActionParams('research', { secret: 'my bank PIN is 1234' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('secret');
      expect(r.error).not.toContain('1234');
    }
  });
});

describe('validateProposedAction', () => {
  it('drops an unknown kind', () => {
    expect(validateProposedAction({ kind: 'send_email', title: 'Email Bob', params: {} })).toMatchObject({ ok: false });
  });
  it('needs who for todo_other', () => {
    expect(validateProposedAction({ kind: 'todo_other', title: 'Send the slides' }).ok).toBe(false);
    expect(validateProposedAction({ kind: 'todo_other', title: 'Send the slides', who: 'Sarah' }).ok).toBe(true);
  });
});

describe('validateAnalysis', () => {
  const speakers: CaptureSpeaker[] = [
    { label: 'S1', guess: null, confirmed: null, isOwner: true },
    { label: 'S2', guess: null, confirmed: null, isOwner: false },
  ];

  it('keeps the good, drops the bad, and never lets the owner be guessed', () => {
    const { analysis, dropped } = validateAnalysis(
      {
        title: 'Kitchen quote',
        summary: 'Talked through the quote.',
        flow: [{ topic: 'Price', from_s: 0, to_s: 30, speakers: ['S1', 'S9'] }],
        entities: [{ name: 'Acme Kitchens', type: 'org', mention: 'Acme' }, { name: 'X', type: 'galaxy' }],
        speakers: [
          { label: 'S1', guess: { name: 'Somebody Else', confidence: 0.9, evidence: [] } },
          { label: 'S2', guess: { name: 'Sarah', confidence: 1.4, evidence: ['named'] } },
        ],
        actions: [
          { kind: 'research', title: 'Compare quotes', params: { question: 'Typical kitchen fitting cost UK' } },
          { kind: 'launch_missiles', title: 'Nope', params: {} },
        ],
      },
      speakers,
      'John',
    );
    expect(analysis.title).toBe('Kitchen quote');
    expect(analysis.flow[0].speakers).toEqual(['S1']);
    expect(analysis.entities.map((e) => e.name)).toEqual(['Acme Kitchens']);
    expect(analysis.speakers[0].guess).toEqual({ name: 'John', confidence: 1, evidence: ['the recorder'] });
    // Out-of-range confidence is dropped, not clamped to certainty.
    expect(analysis.speakers[1].guess).toBeNull();
    expect(analysis.actions.map((a) => a.kind)).toEqual(['research']);
    expect(dropped.length).toBe(2);
  });

  it('caps the follow-ups at twelve', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'todo_me', title: `Thing number ${i}` }));
    expect(validateAnalysis({ actions: many }, speakers, 'John').analysis.actions).toHaveLength(12);
  });
});

describe('the taps', () => {
  it('parses a decision', () => {
    expect(parseDecision({ decision: 'approve' })).toEqual({ ok: true, value: { decision: 'approve' } });
    expect(parseDecision({ decision: 'approve', params: { question: 'edited' } }).ok).toBe(true);
    expect(parseDecision({ decision: 'maybe' }).ok).toBe(false);
    expect(parseDecision({ decision: 'approve', params: 'x' }).ok).toBe(false);
  });

  it('parses a patch', () => {
    expect(parsePatch({ speakers: [{ label: 'S2', confirmed: { name: 'Sarah' } }] })).toEqual({
      ok: true,
      value: { speakers: [{ label: 'S2', confirmed: { name: 'Sarah' } }] },
    });
    expect(parsePatch({}).ok).toBe(false);
    expect(parsePatch({ screenApp: '' }).ok).toBe(false);
  });

  it('reads the vision reply defensively', () => {
    expect(validateScreenReply({ app: { name: 'WhatsApp', confidence: 0.8 }, summary: 'A chat' })).toEqual({
      app: { name: 'WhatsApp', confidence: 0.8 },
      summary: 'A chat',
    });
    expect(validateScreenReply({ app: { name: 'WhatsApp', confidence: 3 } }).app).toBeNull();
  });
});
