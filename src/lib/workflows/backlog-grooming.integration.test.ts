import { expect, it, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
const enabled = process.env.DAYDREAM_LOCAL_TESTS === '1';
it.skipIf(!enabled)('grooms capability intake and restores a lead in isolated Postgres', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/jkai_local') throw new Error('Requires isolated preview database');
  const { upsertCapability, getCapability } = await import('$lib/daydream/appetite/store');
  const { setGroomingOverride } = await import('./backlog-grooming.server');
  const stamp = Date.now();
  const create = (suffix: string) => upsertCapability({ kind: 'feature',
    title: `Sample ${stamp} comet telescope calibration ${suffix}`, need: `Retain ${suffix} calibration requirement`,
    consumer: 'jkai', value: 'Synthetic test only', cites: ['synthetic:test'] });
  const first = await create('one');
  const second = await create('two');
  expect(first).not.toBeNull(); expect(second).not.toBeNull();
  expect((await getCapability(second!.slug))!.status).toBe('declined');
  expect((await getCapability(first!.slug))!.need).toContain('Retain two calibration requirement');
  await setGroomingOverride(`capability:${second!.slug}`, true);
  expect((await getCapability(second!.slug))!.status).toBe('proposed');
  expect((await getCapability(first!.slug))!.need).not.toContain('Retain two calibration requirement');
  const third = await create('three');
  expect((await getCapability(third!.slug))!.status).toBe('declined');
  expect((await getCapability(second!.slug))!.status).toBe('proposed');
}, 120000);
