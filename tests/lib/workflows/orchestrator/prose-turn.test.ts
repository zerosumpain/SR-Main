import { describe, it, expect } from 'vitest';
import { proseTurnOutcome, PROSE_NUDGE } from '$lib/workflows/orchestrator/loop';

describe('proseTurnOutcome — a reply with no tool call', () => {
  it('a question before any node is built is shown to the user, not dropped', () => {
    // The 2026-09-25 production failure: "send me a random joke to my whatsapp
    // every hour" → the model asked for a number in prose → empty draft.
    const q = 'What WhatsApp number should receive the hourly jokes? Please provide it in E.164 format.';
    expect(proseTurnOutcome(q, { nodeCount: 0, nudged: false })).toEqual({ kind: 'followUp', text: q });
  });

  it('non-question prose gets ONE nudge back to the tools', () => {
    const r = proseTurnOutcome("I'll build a 3-step flow.", { nodeCount: 0, nudged: false });
    expect(r).toEqual({ kind: 'nudge', message: PROSE_NUDGE });
  });

  it('after the nudge, prose is surfaced rather than looping', () => {
    const text = "I'll build a 3-step flow.";
    expect(proseTurnOutcome(text, { nodeCount: 0, nudged: true })).toEqual({ kind: 'followUp', text });
  });

  it('prose after nodes exist also gets one nudge to finalize', () => {
    expect(proseTurnOutcome('Done — that should work.', { nodeCount: 3, nudged: false }).kind).toBe('nudge');
  });

  it('a question asked mid-build is still a question', () => {
    expect(proseTurnOutcome('Which calendar should I read?', { nodeCount: 2, nudged: false }).kind).toBe('followUp');
  });

  it('empty content stops, as before', () => {
    expect(proseTurnOutcome('', { nodeCount: 0, nudged: false })).toEqual({ kind: 'stop' });
    expect(proseTurnOutcome(null, { nodeCount: 0, nudged: false })).toEqual({ kind: 'stop' });
  });
});
