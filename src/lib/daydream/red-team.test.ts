import { describe, expect, it } from 'vitest';
import { enforceRules, isMoneyClaim, parseRedTeam, redTeamPrompt, reviewSummary, type NoteUnderCheck } from './red-team';

const apple: NoteUnderCheck = {
  kind: 'think_money_analysis',
  title: 'Two £79 Apple charges on consecutive days need checking',
  body: 'Apple took £79 on 14 and 15 September.',
  ownerNote: null,
  tools: ['spend'],
};
const ledgerSeen = '  2026-09-14 APPLE.COM/BILL £79.00 [bank] An email about it.';
const emailOnly = '  2026-09-14 Apple £79.00 [email] — no bank or PayPal line matches.';

describe('parseRedTeam', () => {
  it('reads a wrong verdict with its lesson', () => {
    const r = parseRedTeam(`Here you go: {"claim":"Apple charged twice","challenges":[{"doubt":"Is one an email?","finding":"Yes, the 15th is the receipt.","survives":false}],"verdict":"wrong","reasoning":"One bank line; the other is the receipt.","lesson":"Before calling a duplicate, I check each charge has its own bank line."}`);
    expect(r).toMatchObject({ verdict: 'wrong', lesson: expect.stringContaining('own bank line') });
    expect(r?.challenges[0].survives).toBe(false);
  });

  it('turns an unknown verdict into unclear, never holds', () => {
    expect(parseRedTeam('{"verdict":"probably","reasoning":"hm"}')?.verdict).toBe('unclear');
  });

  it('drops a lesson unless the note was wrong', () => {
    expect(parseRedTeam('{"verdict":"holds","reasoning":"two bank lines","lesson":"x"}')?.lesson).toBeNull();
  });

  it('refuses a reply that is not a review', () => {
    expect(parseRedTeam('no json here')).toBeNull();
    expect(parseRedTeam('{"verdict":"holds"}')).toBeNull();
  });
});

describe('enforceRules', () => {
  const holds = { verdict: 'holds' as const, claim: '', challenges: [], reasoning: 'Two charges.', lesson: null };

  it('a money claim cannot hold without a ledger line in front of the checker', () => {
    const r = enforceRules(holds, { note: apple, seen: [emailOnly] });
    expect(r.verdict).toBe('unclear');
    expect(r.overruled).toMatch(/only the bank/);
  });

  it('a money claim holds when the ledger was read', () => {
    expect(enforceRules(holds, { note: apple, seen: [ledgerSeen] })).toEqual({ verdict: 'holds', overruled: null });
  });

  it('cannot hold while one of its own doubts sank it', () => {
    const r = enforceRules({ ...holds, challenges: [{ doubt: 'd', finding: 'f', survives: false }] }, { note: apple, seen: [ledgerSeen] });
    expect(r.verdict).toBe('unclear');
  });

  it('leaves a non-money claim alone', () => {
    const note = { ...apple, kind: 'think_health_plan', title: 'Sleep dipped', body: 'Less sleep this week.', tools: ['health_hub'] };
    expect(isMoneyClaim(note)).toBe(false);
    expect(enforceRules(holds, { note, seen: [] }).verdict).toBe('holds');
  });
});

describe('redTeamPrompt', () => {
  it('asks it to prove the note wrong, with the money doubts and past lessons', () => {
    const p = redTeamPrompt({
      note: apple,
      sources: [{ label: 'Spend', text: ledgerSeen }],
      lessons: [{ title: 'Canva charged twice', lesson: 'An invoice and a bank line are one payment.', by: 'check' }],
      rounds: 3,
      today: '2026-10-02',
    });
    expect(p).toMatch(/prove the note WRONG/);
    expect(p).toMatch(/bank statement is the hard truth/);
    expect(p).toMatch(/top-up/);
    expect(p).toMatch(/Canva charged twice[\s\S]*one payment/);
  });
});

describe('reviewSummary', () => {
  it('leads with the verdict in words', () => {
    expect(reviewSummary({ verdict: 'wrong', reasoning: 'One bank line.', overruled: null })).toBe('It was wrong. One bank line.');
  });
});
