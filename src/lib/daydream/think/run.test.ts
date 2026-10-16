import { describe, it, expect, vi } from 'vitest';

// The prompt builder and the outcome gate are pure; keep the cycle's runtime
// dependencies (model gateway, notifier, database readers) off the import graph.
vi.mock('$lib/llm/client', () => ({ getLLMClient: vi.fn() }));
vi.mock('$lib/server/notify', () => ({ notifyOwner: vi.fn() }));
vi.mock('./profile', () => ({ buildProfileLines: vi.fn(async () => []) }));

import { outcomesFor, systemPrompt } from './run';
import { questionForSlot } from './questions';

const base = {
  rounds: 5,
  profile: ['WHAT HE HAS CORRECTED: "PE days are kit reminders"'],
  said: ['Canva charged twice'],
  interest: { title: 'Roman aqueducts', from: 'notebook' as const, key: 'topic:roman-aqueducts' },
  today: '2026-09-25',
};

describe('outcomesFor', () => {
  it('confines a research cycle to research and suggestions', () => {
    expect([...outcomesFor('research')]).toEqual(['research', 'suggest']);
  });

  it('never lets a private cycle write the research outcome', () => {
    expect(outcomesFor('private')).not.toContain('research');
    expect(outcomesFor('private')).toContain('health_plan');
  });
});

describe('systemPrompt', () => {
  const research = questionForSlot(6); // slot 6 mod 7 = the research channel
  const health = questionForSlot(0);

  it('carries his profile into a private cycle and not into a research one', () => {
    expect(research.channel).toBe('research');
    const r = systemPrompt({ ...base, question: research, set: 'research', profile: [] });
    const p = systemPrompt({ ...base, question: health, set: 'private' });
    expect(p).toMatch(/PE days are kit reminders/);
    expect(r).not.toMatch(/PE days/);
    expect(r).toMatch(/RESEARCH CYCLE/);
    expect(r).toMatch(/Roman aqueducts/);
  });

  it('gives a research cycle one interest and the so-what rule', () => {
    const r = systemPrompt({ ...base, question: research, set: 'research', profile: [] });
    expect(r).toMatch(/THIS CYCLE'S INTEREST[^\n]*"Roman aqueducts"/);
    expect(r).toMatch(/SO WHAT/);
    expect(r).not.toMatch(/HIS INTERESTS/);
  });

  it('lists covered subjects, his taste, and tested pairs where they belong', () => {
    const subjects = [{ key: 'merchant:sky', title: 'Sky TV monthly charge increased by £1.69' }];
    const taste = ['WHAT HE HAS TOLD YOU IS NOT WORTH SAYING. Do not write another note like these:', '  • He already knew: "Steps are up"'];
    const tested = ['sleepMinutes against recoveryScore (tested 2026-10-15, 90-day window): same day r 0.04 over 62 days, p 0.783'];
    const p = systemPrompt({ ...base, question: health, set: 'private', subjects, taste, tested });
    const r = systemPrompt({ ...base, question: research, set: 'research', profile: [], subjects: [], taste, tested });
    expect(p).toMatch(/SUBJECTS ALREADY COVERED[\s\S]*\[merchant:sky\] Sky TV/);
    expect(p).toMatch(/He already knew: "Steps are up"/);
    expect(p).toMatch(/ALREADY TESTED[\s\S]*sleepMinutes against recoveryScore/);
    expect(p).toMatch(/"changed"/);
    // The ledger is his health data; a research cycle never holds it.
    expect(r).not.toMatch(/ALREADY TESTED/);
    expect(r).toMatch(/He already knew/);
  });

  it('leads a summary cycle with the summary brief', () => {
    const p = systemPrompt({ ...base, question: health, set: 'private', summary: true });
    expect(p).toMatch(/MONTHLY SUMMARY OF WHAT HAS BEEN TESTED/);
    expect(p).not.toContain(health.brief);
  });

  it('tells the model that silence is fine and generic notes are worthless', () => {
    const p = systemPrompt({ ...base, question: health, set: 'private' });
    expect(p).toMatch(/Silence is fine/);
    expect(p).toMatch(/your day is busy/);
    expect(p).toMatch(/CITE OR DIE/);
  });

  it('carries the lessons into a private cycle only, and always the money rule', () => {
    const lessons = ['WHERE YOU HAVE BEEN WRONG BEFORE.', '  • You said "Two £79 Apple charges". John found it wrong: one was the receipt email.'];
    const p = systemPrompt({ ...base, question: health, set: 'private', lessons });
    const r = systemPrompt({ ...base, question: research, set: 'research', profile: [], lessons });
    expect(p).toMatch(/WHERE YOU HAVE BEEN WRONG BEFORE[\s\S]*receipt email/);
    expect(r).not.toMatch(/WHERE YOU HAVE BEEN WRONG BEFORE/);
    expect(p).toMatch(/bank statement is the truth/);
    expect(p).toMatch(/top-up of PayPal/);
  });

  it('lists what was already said', () => {
    expect(systemPrompt({ ...base, question: health, set: 'private' })).toMatch(/ALREADY SAID[\s\S]*Canva charged twice/);
  });
});
