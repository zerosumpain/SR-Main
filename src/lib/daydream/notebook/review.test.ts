import { describe, expect, it } from 'vitest';
import { MAX_ACTIONS_PER_NOTE, parsePlan } from './review';

const plan = (o: unknown) => parsePlan(JSON.stringify(o));

describe('parsePlan', () => {
  it('takes a well-formed plan', () => {
    const p = plan({
      summary: 'A note about boiler options',
      actions: [
        { kind: 'research', title: 'Costs of a hydrogen retrofit', params: { topic: 'hydrogen boiler retrofit UK', depth: 'scan' } },
        { kind: 'context', title: 'What the standard says', params: { text: 'The relevant standard was published in 2019.' } },
      ],
    });
    expect(p.error).toBeNull();
    expect(p.summary).toContain('boiler');
    expect(p.actions).toHaveLength(2);
    expect(p.refused).toHaveLength(0);
  });

  it('AN EMPTY PLAN IS A GOOD ANSWER — "buy milk" must cost nothing', () => {
    const p = plan({ summary: 'A shopping list', actions: [] });
    expect(p.error).toBeNull();
    expect(p.actions).toHaveLength(0);
  });

  it('records what it refused instead of dropping it silently', () => {
    const p = plan({
      summary: 'x',
      actions: [
        { kind: 'research', title: 'Do a proper deep dive', params: { topic: 'a real topic', depth: 'investigation' } },
        { kind: 'send_email', title: 'Email the council', params: {} },
      ],
    });
    expect(p.actions).toHaveLength(0);
    expect(p.refused).toHaveLength(2);
    expect(p.refused[0].error).toContain('not a short run');
    expect(p.refused[1].error).toContain('unknown action kind');
    // The kind it ASKED for is kept — a model repeatedly reaching past its
    // vocabulary is the thing this record exists to make visible.
    expect(p.refused[1].kind).toBe('send_email');
  });

  it('caps the actions one note can plan', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      kind: 'context',
      title: `Context item ${i}`,
      params: { text: `Some genuinely useful background number ${i}.` },
    }));
    expect(plan({ summary: 's', actions: many }).actions).toHaveLength(MAX_ACTIONS_PER_NOTE);
  });

  it('survives prose, fences and rubbish', () => {
    expect(parsePlan('I had a think and decided nothing was needed.').error).toBe(
      'reviewer did not return JSON',
    );
    expect(parsePlan('').error).toBe('reviewer did not return JSON');
    const fenced = parsePlan('```json\n{"summary":"ok","actions":[]}\n```');
    expect(fenced.error).toBeNull();
    expect(fenced.summary).toBe('ok');
  });

  it('tolerates a missing or wrongly-typed actions list', () => {
    for (const actions of [undefined, null, 'none', 42, {}]) {
      const p = plan({ summary: 'x', actions });
      expect(p.error).toBeNull();
      expect(p.actions).toHaveLength(0);
    }
  });

  it('does not invent a summary it was not given', () => {
    expect(plan({ actions: [] }).summary).toBe('');
  });
});
