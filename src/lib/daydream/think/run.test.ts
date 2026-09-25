import { describe, it, expect, vi } from 'vitest';

// The prompt builder and the outcome gate are pure; keep the cycle's runtime
// dependencies (model gateway, notifier, database readers) off the import graph.
vi.mock('$lib/llm/client', () => ({ getLLMClient: vi.fn() }));
vi.mock('$lib/server/notify', () => ({ notifyOwner: vi.fn() }));
vi.mock('./profile', () => ({ buildProfileLines: vi.fn(async () => []) }));
vi.mock('$lib/selfimprove/backlog', () => ({ addIdeas: vi.fn(async () => []) }));

import { outcomesFor, systemPrompt } from './run';
import { questionForSlot } from './questions';

const base = {
  rounds: 5,
  profile: ['WHAT HE HAS CORRECTED: "PE days are kit reminders"'],
  said: ['Canva charged twice'],
  interests: ['notebook: Roman aqueducts'],
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

  it('tells the model that silence is fine and generic notes are worthless', () => {
    const p = systemPrompt({ ...base, question: health, set: 'private' });
    expect(p).toMatch(/Silence is fine/);
    expect(p).toMatch(/your day is busy/);
    expect(p).toMatch(/CITE OR DIE/);
  });

  it('lists what was already said', () => {
    expect(systemPrompt({ ...base, question: health, set: 'private' })).toMatch(/ALREADY SAID[\s\S]*Canva charged twice/);
  });
});
