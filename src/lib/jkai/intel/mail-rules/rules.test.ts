// The rule engine's safety properties, stated as tests.
//
// Three promises this feature makes, and each is a describe block below:
//
//   1. A rule is data. Nothing outside the fact allow-list can be named, and a
//      comparison that makes no sense is REFUSED rather than coerced.
//   2. A rule cannot activate itself. A proposal that asks to be active is
//      rejected at validation.
//   3. A rule that would re-admit refused mail, or admit most of the mailbox,
//      cannot be offered for approval at all.
import { describe, it, expect } from 'vitest';
import { validateCondition, validateRule, describeCondition, type Condition } from './spec';
import { evaluateCondition, decide } from './evaluate';
import { backtestRule, judgeBacktest, MAX_ADMIT_SHARE, type CorpusNote } from './backtest';
import type { MailFacts } from '../mail-facts';
import type { MailDecision } from '../mail-decisions';

const FACTS: MailFacts = {
  senderDomain: 'example.com',
  emailKind: 'correspondence',
  participantCount: 2,
  messageCount: 3,
  ownerReplied: true,
  twoWay: true,
  gmailImportant: false,
  hasAttachments: false,
  bodyChars: 1200,
  ageDays: 7,
  // An unscored thread. Every relevance test sets these explicitly, so the
  // baseline stays "the graph has nothing to say about this one".
  graphEntityHits: 0,
  graphTopHitWeight: 0,
  graphSimilarity: 0,
};

describe('a rule is data', () => {
  it('refuses a fact that is not on the list', () => {
    const result = validateCondition({ fact: 'senderPassword', op: 'eq', value: 'x' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/unknown fact/);
  });

  it('refuses a nonsense comparison rather than coercing it', () => {
    // The arg-alias lesson: a validator that coerces instead of refusing hides
    // the mistake until the rule is live and admitting the wrong mail.
    const result = validateCondition({ fact: 'emailKind', op: 'gt', value: 'bulk' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/meaningless/);
  });

  it('refuses a number where a string belongs', () => {
    expect(validateCondition({ fact: 'senderDomain', op: 'eq', value: 3 }).ok).toBe(false);
  });

  it('refuses a boolean fact compared against a number', () => {
    expect(validateCondition({ fact: 'ownerReplied', op: 'eq', value: 1 }).ok).toBe(false);
  });

  it('bounds how deep a condition may nest', () => {
    let node: unknown = { fact: 'ageDays', op: 'lt', value: 30 };
    for (let i = 0; i < 8; i++) node = { not: node };
    expect(validateCondition(node).ok).toBe(false);
  });

  it('accepts an ordinary well-formed rule', () => {
    const result = validateRule({
      key: 'two-way-human',
      label: 'Threads you replied to',
      action: 'admit',
      origin: 'model',
      condition: { all: [{ fact: 'ownerReplied', op: 'eq', value: true }] },
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

describe('a rule cannot activate itself', () => {
  it('rejects a proposal that asks to be active', () => {
    const result = validateRule({
      key: 'sneaky',
      label: 'Admit everything',
      action: 'admit',
      status: 'active',
      condition: { fact: 'bodyChars', op: 'gte', value: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/activated by the owner/);
  });
});

describe('evaluation', () => {
  it('reads all/any/not the way the words mean', () => {
    expect(evaluateCondition({ all: [{ fact: 'twoWay', op: 'eq', value: true }, { fact: 'ageDays', op: 'lt', value: 30 }] }, FACTS)).toBe(true);
    expect(evaluateCondition({ all: [{ fact: 'twoWay', op: 'eq', value: true }, { fact: 'ageDays', op: 'lt', value: 3 }] }, FACTS)).toBe(false);
    expect(evaluateCondition({ any: [{ fact: 'gmailImportant', op: 'eq', value: true }, { fact: 'twoWay', op: 'eq', value: true }] }, FACTS)).toBe(true);
    expect(evaluateCondition({ not: { fact: 'gmailImportant', op: 'eq', value: true } }, FACTS)).toBe(true);
  });

  it('lets a reject rule beat an admit rule whatever order they are stored in', () => {
    // "Never this sender" has to beat "usually this shape", or the owner's most
    // specific instruction is the one that silently stops working.
    const admit = {
      key: 'a', label: 'a', action: 'admit' as const, status: 'active' as const, origin: 'owner',
      proposedAt: '', condition: { fact: 'twoWay', op: 'eq', value: true } as Condition,
    };
    const reject = {
      key: 'r', label: 'r', action: 'reject' as const, status: 'active' as const, origin: 'owner',
      proposedAt: '', condition: { fact: 'senderDomain', op: 'eq', value: 'example.com' } as Condition,
    };
    expect(decide([admit, reject], FACTS).action).toBe('reject');
    expect(decide([reject, admit], FACTS).action).toBe('reject');
  });

  it('ignores rules that are not active', () => {
    const proposed = {
      key: 'p', label: 'p', action: 'admit' as const, status: 'proposed' as const, origin: 'model',
      proposedAt: '', condition: { fact: 'twoWay', op: 'eq', value: true } as Condition,
    };
    expect(decide([proposed], FACTS).action).toBe(null);
  });
});

// ── Backtest ────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 7, 27);

function corpusNote(id: string, opts: { replied?: boolean; kind?: string; day: number }): CorpusNote {
  const owner = 'me@x.com';
  const body = opts.replied
    ? `Messages: 2\n\n[1] · from jane@y.com · to ${owner}\nhi\n\n[2] · from ${owner} · to jane@y.com\nhello`
    : `Messages: 1\n\n[1] · from noreply@y.com · to ${owner}\nbuy things`;
  const at = new Date(Date.UTC(2026, 7, opts.day)).toISOString();
  return {
    id,
    title: `Thread ${id}`,
    rawContent: body,
    metadata: { gmailAccount: owner, participants: [owner, 'jane@y.com'], emailKind: opts.kind ?? 'correspondence', senderDomain: 'y.com' },
    observedAt: at,
    createdAt: at,
    graphState: 'pending',
  };
}

function decision(noteId: string, kind: 'admit' | 'reject'): MailDecision {
  return {
    noteId,
    decision: kind,
    actor: 'owner',
    subject: noteId,
    facts: FACTS,
    at: new Date(NOW).toISOString(),
  };
}

describe('backtest', () => {
  const corpus = [
    corpusNote('a', { replied: true, day: 1 }),
    corpusNote('b', { replied: true, day: 8 }),
    corpusNote('c', { replied: false, kind: 'bulk', day: 15 }),
    corpusNote('d', { replied: false, kind: 'bulk', day: 22 }),
  ];

  it('counts only the threads a rule actually matches', () => {
    const result = backtestRule(
      { action: 'admit', condition: { fact: 'ownerReplied', op: 'eq', value: true } },
      corpus,
      [],
      { now: NOW },
    );
    expect(result.matched).toBe(2);
    expect(result.scanned).toBe(4);
  });

  it('scores agreement only against decisions the owner actually made', () => {
    const result = backtestRule(
      { action: 'admit', condition: { fact: 'ownerReplied', op: 'eq', value: true } },
      corpus,
      [decision('a', 'admit'), decision('b', 'reject')],
      { now: NOW },
    );
    expect(result.agreed).toBe(1);
    expect(result.disagreed).toBe(1);
    expect(result.falseAdmits).toBe(1);
  });

  it('divides by the real span of the corpus, not a nominal week', () => {
    // Three weeks of mail reported as "per week" without dividing by the real
    // span overstates a rule by 3x, and every threshold downstream then means
    // nothing.
    const result = backtestRule(
      { action: 'admit', condition: { fact: 'bodyChars', op: 'gte', value: 0 } },
      corpus,
      [],
      { now: NOW },
    );
    expect(result.matched).toBe(4);
    expect(result.perWeek).toBeLessThan(2);
  });
});

describe('judgeBacktest — what may be offered for approval', () => {
  const base = { matched: 10, scanned: 100, agreed: 8, disagreed: 1, falseAdmits: 0, perWeek: 4, samples: [] };

  it('offers a narrow, agreeable rule', () => {
    expect(judgeBacktest({ action: 'admit' }, base, 50).offerable).toBe(true);
  });

  it('refuses a rule that would admit most of the mailbox', () => {
    const wide = { ...base, matched: Math.ceil(100 * MAX_ADMIT_SHARE) + 1 };
    const judged = judgeBacktest({ action: 'admit' }, wide, 50);
    expect(judged.offerable).toBe(false);
    expect(judged.refusals.join(' ')).toMatch(/old behaviour under a new name/);
  });

  it('refuses a rule that would re-admit mail the owner rejected', () => {
    const judged = judgeBacktest({ action: 'admit' }, { ...base, falseAdmits: 5 }, 50);
    expect(judged.offerable).toBe(false);
    expect(judged.refusals.join(' ')).toMatch(/already rejected/);
  });

  it('refuses a rule that fires far too often', () => {
    expect(judgeBacktest({ action: 'admit' }, { ...base, perWeek: 500 }, 50).offerable).toBe(false);
  });

  it('refuses a rule that matches nothing', () => {
    expect(judgeBacktest({ action: 'admit' }, { ...base, matched: 0 }, 50).offerable).toBe(false);
  });

  it('warns rather than refuses when there is little to judge against', () => {
    const judged = judgeBacktest({ action: 'admit' }, base, 3);
    expect(judged.offerable).toBe(true);
    expect(judged.warnings.join(' ')).toMatch(/weak evidence/);
  });

  it('holds a reject rule to a looser bar than an admit rule', () => {
    // A reject rule cannot poison the graph — the worst it does is drain the
    // queue, and that is reversible.
    const wide = { ...base, matched: 90, perWeek: 400 };
    expect(judgeBacktest({ action: 'reject' }, wide, 50).offerable).toBe(true);
  });
});

describe('describeCondition', () => {
  it('renders a sentence the owner can check before approving', () => {
    expect(
      describeCondition({
        all: [
          { fact: 'twoWay', op: 'eq', value: true },
          { fact: 'ageDays', op: 'lt', value: 30 },
        ],
      }),
    ).toBe('twoWay is true and ageDays is under 30');
  });
});
