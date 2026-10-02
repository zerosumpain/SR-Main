import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./rulings.server', () => ({ recordRuling: vi.fn() }));
import { parseOwnerVerdict } from './owner-verdict';

describe('parseOwnerVerdict', () => {
  it('a wrong needs a reason — the reason is the lesson', () => {
    expect(parseOwnerVerdict({ thoughtId: 't1', verdict: 'wrong', why: '' })).toMatchObject({ ok: false });
    expect(parseOwnerVerdict({ thoughtId: 't1', verdict: 'wrong', why: ' one is  the receipt ' })).toEqual({
      ok: true, thoughtId: 't1', verdict: 'wrong', why: 'one is the receipt',
    });
  });

  it('a right may come without one, and the phone may send id', () => {
    expect(parseOwnerVerdict({ id: 't2', verdict: 'right' })).toEqual({ ok: true, thoughtId: 't2', verdict: 'right', why: '' });
  });

  it('refuses anything else', () => {
    expect(parseOwnerVerdict({ thoughtId: 't1', verdict: 'useful' })).toMatchObject({ ok: false });
    expect(parseOwnerVerdict(null)).toMatchObject({ ok: false });
  });
});
