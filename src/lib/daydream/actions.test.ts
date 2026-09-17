import { describe, it, expect } from 'vitest';
import {
  ACTION_KINDS,
  ASK_MAX_CHARS,
  DRAFT_MAX_CHARS,
  TAP_ONLY_KINDS,
  WATCH_MAX_CHARS,
  fromProposedAction,
  toProposedAction,
  validateAction,
  type AskParams,
  type DraftParams,
  type WatchParams,
} from './actions';

describe('the action vocabulary', () => {
  it('is closed', () => {
    expect([...ACTION_KINDS]).toEqual(['remind', 'watch', 'draft', 'ask']);
  });

  it('refuses anything outside it', () => {
    const r = validateAction({ kind: 'delete_everything', params: {} });
    expect(r).toHaveProperty('error');
  });
});

describe('the tap/rule capability boundary', () => {
  const watch = { kind: 'watch', params: { description: 'tell me when the bins change day' } };

  it('lets a one-tap action arm a watch', () => {
    expect(validateAction(watch, 'tap')).toHaveProperty('action');
  });

  it('refuses a watch on a STANDING RULE', () => {
    // A rule fires on its own for ever once approved. Arming a monitor from
    // one manufactures recurring notifications nobody read first, which is
    // the single thing the no-auto-activation design exists to prevent.
    const r = validateAction(watch, 'rule');
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('one-tap');
  });

  it('keeps the harmless kinds available to a rule', () => {
    expect(validateAction({ kind: 'remind', params: { inHours: 4, text: 'bins out' } }, 'rule')).toHaveProperty('action');
    expect(
      validateAction({ kind: 'draft', params: { title: 'Bins', text: 'They moved to Thursday.' } }, 'rule'),
    ).toHaveProperty('action');
    expect(validateAction({ kind: 'ask', params: { question: 'Did the bins move day?' } }, 'rule')).toHaveProperty('action');
  });

  it('defaults to the permissive context, so every pre-existing caller is a tap', () => {
    expect(validateAction(watch)).toHaveProperty('action');
  });

  it('names watch as the only tap-only kind', () => {
    expect([...TAP_ONLY_KINDS]).toEqual(['watch']);
  });
});

describe('remind', () => {
  it('still round-trips exactly as it did', () => {
    const v = validateAction({ kind: 'remind', params: { inHours: 5.4, text: 'collect the tickets' } });
    expect(v).toHaveProperty('action');
    const { action } = v as { action: Parameters<typeof toProposedAction>[0] };
    expect(action.params).toEqual({ inHours: 5, text: 'collect the tickets' });
    const back = fromProposedAction(toProposedAction(action));
    expect(back).toHaveProperty('action');
  });

  it('refuses an hour count outside the bounds', () => {
    expect(validateAction({ kind: 'remind', params: { inHours: 0, text: 'now' } })).toHaveProperty('error');
    expect(validateAction({ kind: 'remind', params: { inHours: 10_000, text: 'later' } })).toHaveProperty('error');
  });
});

describe('watch', () => {
  it('accepts a described check with no cron', () => {
    const v = validateAction({ kind: 'watch', params: { description: 'tell me when the 07:12 is cancelled' } });
    expect((v as { action: { params: WatchParams } }).action.params.cron).toBeUndefined();
  });

  it('accepts a five-field cron', () => {
    const v = validateAction({
      kind: 'watch',
      params: { description: 'check the rail feed each morning', cron: '0 7 * * *' },
    });
    expect((v as { action: { params: WatchParams } }).action.params.cron).toBe('0 7 * * *');
  });

  it('refuses a cron that is not five fields', () => {
    // A generated schedule runs for ever; a malformed one is not worth guessing at.
    expect(
      validateAction({ kind: 'watch', params: { description: 'check the rail feed daily', cron: 'hourly' } }),
    ).toHaveProperty('error');
  });

  it('refuses a description too thin to generate anything from', () => {
    expect(validateAction({ kind: 'watch', params: { description: 'trains' } })).toHaveProperty('error');
    expect(
      validateAction({ kind: 'watch', params: { description: 'x'.repeat(WATCH_MAX_CHARS + 1) } }),
    ).toHaveProperty('error');
  });
});

describe('draft', () => {
  it('accepts a title and a body', () => {
    const v = validateAction({ kind: 'draft', params: { title: 'Rome', text: 'What is still unbooked.' } });
    expect((v as { action: { params: DraftParams } }).action.params.title).toBe('Rome');
  });

  it('refuses an empty or oversized body', () => {
    expect(validateAction({ kind: 'draft', params: { title: 'Rome', text: 'no' } })).toHaveProperty('error');
    expect(
      validateAction({ kind: 'draft', params: { title: 'Rome', text: 'x'.repeat(DRAFT_MAX_CHARS + 1) } }),
    ).toHaveProperty('error');
  });
});

describe('ask', () => {
  it('accepts one question', () => {
    const v = validateAction({ kind: 'ask', params: { question: 'Is the brace date confirmed?' } });
    expect((v as { action: { params: AskParams } }).action.params.question).toBe('Is the brace date confirmed?');
  });

  it('refuses three questions wearing one action', () => {
    const r = validateAction({
      kind: 'ask',
      params: { question: 'Is it booked? Did you pay? Is it refundable?' },
    });
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('single question');
  });

  it('refuses a question too short to answer or too long to read', () => {
    expect(validateAction({ kind: 'ask', params: { question: 'why?' } })).toHaveProperty('error');
    expect(validateAction({ kind: 'ask', params: { question: `${'x'.repeat(ASK_MAX_CHARS)}?` } })).toHaveProperty(
      'error',
    );
  });
});

describe('round-tripping through storage', () => {
  it('re-validates every kind back out of the stored payload', () => {
    // The execute path must never run something the propose path would refuse,
    // so the stored form has to survive the same validator.
    const cases = [
      { kind: 'remind', params: { inHours: 3, text: 'collect tickets' } },
      { kind: 'watch', params: { description: 'watch the rail feed for cancellations' } },
      { kind: 'draft', params: { title: 'Rome', text: 'What is still unbooked.' } },
      { kind: 'ask', params: { question: 'Is the brace date confirmed?' } },
    ];
    for (const c of cases) {
      const v = validateAction(c);
      expect(v, c.kind).toHaveProperty('action');
      const stored = toProposedAction((v as { action: Parameters<typeof toProposedAction>[0] }).action);
      expect(fromProposedAction(stored), c.kind).toHaveProperty('action');
    }
  });

  it('refuses a stored payload that is not JSON', () => {
    expect(fromProposedAction({ kind: 'remind', label: 'x', payload: 'not json' })).toHaveProperty('error');
  });
});
