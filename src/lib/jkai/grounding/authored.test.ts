import { it, expect, vi } from 'vitest';
import { runAuthored } from './authored.server';
it('runs composition in isolation', async () => {
  const call = vi.fn(async () => ({ success: true, data: 42 }));
  expect(await runAuthored('return await platform.call("lookup", args)', {}, call)).toEqual({ success: true, data: 42 });
  expect(call).toHaveBeenCalledWith('lookup', {});
});
it('terminates non-returning code', async () => {
  const result = await runAuthored('while (true) {}', {}, async () => ({ success: true }), 300);
  expect(result.success).toBe(false); expect(result.error).toContain('deadline');
});
it('refuses ambient environment access before launching', () => {
  expect(() => runAuthored('return process.env', {}, async () => ({ success: true }))).toThrow();
});
