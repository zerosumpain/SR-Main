import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ execute: vi.fn(async () => {}), load: vi.fn(), decide: vi.fn(), override: vi.fn() }));
vi.mock('$lib/db', () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: h.execute }) } }));
vi.mock('$lib/selfimprove/epic-backlog.server', () => ({ loadBacklogRoom: h.load, decideBacklogGrooming: h.decide, overrideBacklogGrooming: h.override }));
import { autoGroomBacklog, decideBacklogGroomingMany, groomAfterIntake, setGroomingOverride } from './backlog-grooming.server';
/** The room the loader hands back: the epics, plus the board they were folded out of. */
const room = (epics: unknown[]) => ({ epics, board: { items: [] } });
beforeEach(() => vi.resetAllMocks());
it('applies automatic matches under the shared lock and retains uncertain suggestions', async () => {
  const epics = [{ suggestions: [{ id: 'merge', automatic: true }, { id: 'uncertain', automatic: false }] }];
  h.load.mockResolvedValue(room(epics));
  await autoGroomBacklog();
  expect(h.execute).toHaveBeenCalledOnce();
  expect(h.decide).toHaveBeenCalledExactlyOnceWith('merge', 'apply', 'engine', epics);
  expect(h.load).toHaveBeenCalledTimes(2);
});
it('returns the board alongside the epics, so the room needs one read', async () => {
  h.load.mockResolvedValue(room([]));
  await expect(autoGroomBacklog()).resolves.toMatchObject({ epics: [], board: { items: [] } });
});
it('uses the same lock for user overrides', async () => {
  await setGroomingOverride('backlog:a', true);
  expect(h.execute).toHaveBeenCalledOnce();
  expect(h.override).toHaveBeenCalledWith('backlog:a', true);
});
it('keeps intake durable when grooming is temporarily unavailable', async () => {
  h.load.mockRejectedValue(new Error('database unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(groomAfterIntake()).resolves.toBeUndefined();
  expect(h.decide).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});
it('rules on a batch under one lock and one read', async () => {
  const epics = [{ suggestions: [{ id: 'a' }, { id: 'b' }] }];
  h.load.mockResolvedValue(room(epics));
  await expect(decideBacklogGroomingMany(['a', 'b'], 'keep')).resolves.toEqual({ decided: 2, failed: [] });
  expect(h.execute).toHaveBeenCalledOnce();
  expect(h.load).toHaveBeenCalledOnce();
  expect(h.decide).toHaveBeenNthCalledWith(1, 'a', 'keep', 'owner', epics);
});
it('reports the ones that had moved rather than forcing them', async () => {
  h.load.mockResolvedValue(room([]));
  h.decide.mockImplementation(async (id: string) => {
    if (id === 'stale') throw new Error('Suggestion changed or was already handled; reload the backlog');
  });
  const res = await decideBacklogGroomingMany(['ok', 'stale'], 'apply');
  expect(res.decided).toBe(1);
  expect(res.failed).toEqual([{ id: 'stale', error: 'Suggestion changed or was already handled; reload the backlog' }]);
});
