import { describe, expect, it } from 'vitest';
import { AUTO_DAILY_CAP, EMPTY_AUTONOMY, autoKindOf, cleanState, ladderView, levelOf, mayAuto, withAuto, withLevel, withRestore, withTap, withUndo, type AutoKind, type AutonomyState } from './autonomy';
import { storeAction } from './plan';
import { storeSolve } from './solution';

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const at = (iso: string) => new Date(iso);
const entry = (id: string, kind: AutoKind, iso: string) => ({ at: iso, kind, thoughtId: id, title: `note ${id}` });

describe('autoKindOf', () => {
  const reminder = { kind: 'reminder' as const, text: 'Chase the bike dispatch', date: '2026-11-12', time: null };
  const diary = { kind: 'calendar_event' as const, title: 'Chase the bike dispatch', date: '2026-11-12', time: null };

  it('a reminder acts by itself; a diary entry never does', () => {
    expect(autoKindOf([storeAction(reminder, null)])).toEqual({ kind: 'reminder', via: 'do' });
    expect(autoKindOf([storeAction(diary, null)])).toBeNull();
  });

  it('a diary step is not skipped in favour of the solution beside it', () => {
    expect(autoKindOf([storeAction(diary, null), storeSolve({ kind: 'watch', description: 'Tell me when the thermostat stops reporting.' })])).toBeNull();
  });

  it('lights only: one switch among them keeps the whole press a tap', () => {
    expect(autoKindOf([storeSolve({ kind: 'home', entities: ['light.study', 'light.hall'] })])).toEqual({ kind: 'solve:home', via: 'solve' });
    expect(autoKindOf([storeSolve({ kind: 'home', entities: ['light.study', 'switch.hall_lamp'] })])).toBeNull();
  });

  it('a build, a page and a watch stay a tap, and a step already done is not done twice', () => {
    expect(autoKindOf([storeSolve({ kind: 'build', title: 'Away-mode lights check', what: 'Each evening the house is empty, list lights left on.' })])).toBeNull();
    expect(autoKindOf([storeSolve({ kind: 'open', url: '/trips', label: 'Open your trips' })])).toBeNull();
    expect(autoKindOf([storeSolve({ kind: 'watch', description: 'Tell me when the thermostat stops reporting.' })])).toBeNull();
    expect(autoKindOf([storeSolve({ kind: 'home', entities: ['light.study'] }, { at: 'x' } as never)])).toBeNull();
    expect(autoKindOf(null)).toBeNull();
  });
});

describe('the ladder', () => {
  const now = at('2026-11-10T12:00:00Z');

  it('every kind starts on do, and the daily cap holds across kinds', () => {
    expect(levelOf(EMPTY_AUTONOMY, 'solve:home')).toBe('do');
    let s: AutonomyState = EMPTY_AUTONOMY;
    for (let i = 0; i < AUTO_DAILY_CAP; i++) s = withAuto(s, entry(`t${i}`, i % 2 ? 'reminder' : 'solve:track', '2026-11-10T09:00:00Z'));
    expect(mayAuto(s, 'email_draft', '2026-11-10', dayOf)).toMatchObject({ ok: false });
    expect(mayAuto(s, 'email_draft', '2026-11-11', dayOf)).toEqual({ ok: true });
  });

  it('two undone inside thirty days put a kind back to ask; one does not', () => {
    let s = withAuto(withAuto(EMPTY_AUTONOMY, entry('a', 'reminder', '2026-11-01T09:00:00Z')), entry('b', 'reminder', '2026-11-05T09:00:00Z'));
    const first = withUndo(s, 'a', at('2026-11-02T09:00:00Z'));
    expect(first.demoted).toBeNull();
    const second = withUndo(first.state, 'b', now);
    expect(second.demoted).toBe('reminder');
    expect(levelOf(second.state, 'reminder')).toBe('ask');
    expect(levelOf(second.state, 'solve:track')).toBe('do');
    expect(mayAuto(second.state, 'reminder', '2026-11-10', dayOf)).toMatchObject({ ok: false });
    // The same note undone twice counts once.
    s = withUndo(first.state, 'a', now).state;
    expect(levelOf(s, 'reminder')).toBe('do');
  });

  it('an undo older than the window is not held against the kind', () => {
    const s = withAuto(withAuto(EMPTY_AUTONOMY, entry('a', 'reminder', '2026-09-01T09:00:00Z')), entry('b', 'reminder', '2026-11-05T09:00:00Z'));
    const old = withUndo(s, 'a', at('2026-09-02T09:00:00Z')).state;
    expect(withUndo(old, 'b', now).demoted).toBeNull();
  });

  it('lights back on when someone comes home is not an undo', () => {
    let s = withAuto(withAuto(EMPTY_AUTONOMY, entry('a', 'solve:home', '2026-11-08T09:00:00Z')), entry('b', 'solve:home', '2026-11-09T09:00:00Z'));
    s = withRestore(withRestore(s, 'a', now), 'b', now);
    expect(levelOf(s, 'solve:home')).toBe('do');
    // And a restored act cannot then be undone into a demotion.
    expect(withUndo(s, 'a', now).demoted).toBeNull();
    expect(ladderView(s, now).find((r) => r.kind === 'solve:home')).toMatchObject({ acted: 2, undone: 0 });
  });

  it('three taps move a kind the ladder put back forward again', () => {
    let s = withAuto(withAuto(EMPTY_AUTONOMY, entry('a', 'reminder', '2026-11-01T09:00:00Z')), entry('b', 'reminder', '2026-11-05T09:00:00Z'));
    s = withUndo(withUndo(s, 'a', now).state, 'b', now).state;
    expect(withTap(s, 'reminder', now).promoted).toBe(false);
    s = withTap(withTap(s, 'reminder', now).state, 'reminder', now).state;
    const third = withTap(s, 'reminder', now);
    expect(third.promoted).toBe(true);
    expect(levelOf(third.state, 'reminder')).toBe('do');
    // Undos from before it moved forward do not put it straight back.
    const again = withAuto(third.state, entry('c', 'reminder', '2026-11-10T12:30:00Z'));
    expect(withUndo(again, 'c', at('2026-11-10T13:00:00Z')).demoted).toBeNull();
  });

  it('a kind HE set to ask is never moved forward by taps', () => {
    let s = withLevel(EMPTY_AUTONOMY, 'email_draft', 'ask', now);
    for (let i = 0; i < 5; i++) s = withTap(s, 'email_draft', now).state;
    expect(levelOf(s, 'email_draft')).toBe('ask');
    expect(ladderView(s, now).find((r) => r.kind === 'email_draft')?.note).toBe('You set this to ask.');
  });

  it('reads whatever the setting holds', () => {
    expect(cleanState(null)).toEqual(EMPTY_AUTONOMY);
    const s = cleanState({ levels: { reminder: { level: 'ask', by: 'ladder', at: 'x' }, pay: { level: 'do' } }, taps: { reminder: 2.7, bogus: 4 }, log: [{ kind: 'pay', at: 'x', thoughtId: 't' }, entry('a', 'reminder', 'x')] });
    expect(Object.keys(s.levels)).toEqual(['reminder']);
    expect(s.taps).toEqual({ reminder: 2 });
    expect(s.log).toHaveLength(1);
  });
});
