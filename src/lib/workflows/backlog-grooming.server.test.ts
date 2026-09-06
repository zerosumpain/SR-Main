import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ execute: vi.fn(async () => {}), load: vi.fn(), decide: vi.fn(), override: vi.fn() }));
vi.mock('$lib/db', () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: h.execute }) } }));
vi.mock('$lib/selfimprove/epic-backlog.server', () => ({ loadEpicBacklog: h.load, decideBacklogGrooming: h.decide, overrideBacklogGrooming: h.override }));
import { autoGroomBacklog, groomAfterIntake, setGroomingOverride } from './backlog-grooming.server';
beforeEach(() => vi.resetAllMocks());
it('applies automatic matches under the shared lock and retains uncertain suggestions', async () => {
  const epics = [{ suggestions: [{ id: 'merge', automatic: true }, { id: 'uncertain', automatic: false }] }];
  h.load.mockResolvedValue(epics);
  await autoGroomBacklog();
  expect(h.execute).toHaveBeenCalledOnce();
  expect(h.decide).toHaveBeenCalledExactlyOnceWith('merge', 'apply', 'engine', epics);
  expect(h.load).toHaveBeenCalledTimes(2);
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
