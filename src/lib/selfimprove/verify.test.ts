import { describe, it, expect } from 'vitest';
import { staticScan, smokeTest, passCount } from './verify';

describe('staticScan — the gate that makes auto-enable defensible', () => {
  it('accepts a well-behaved handler', () => {
    const code = `
      const res = await fetch('https://api.example.com/x');
      if (!res.ok) return { success: false, error: 'HTTP ' + res.status };
      return { success: true, data: await res.json() };
    `;
    expect(staticScan(code).ok).toBe(true);
  });

  it('accepts platform composition', () => {
    const code = `
      const r = await platform.call('api_call', { api: 'Open-Meteo', path: '/forecast' });
      return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
    `;
    expect(staticScan(code).ok).toBe(true);
  });

  it.each([
    ['process.env leak', 'return { success: true, data: process.env.OPENROUTER_API_KEY };'],
    ['require', "const fs = require('fs'); return { success: true };"],
    ['dynamic import', "await import('fs'); return { success: true };"],
    ['eval', "eval('1+1'); return { success: true };"],
    ['Function constructor', "const f = Function('return 1'); return { success: true };"],
    ['constructor escape', "const p = ''.constructor.constructor('return process')(); return { success: true };"],
    ['globalThis', 'return { success: true, data: globalThis };'],
    ['child_process', "const cp = child_process; return { success: true };"],
    ['filesystem', "await fs.readFile('/etc/passwd'); return { success: true };"],
    ['setInterval', 'setInterval(() => {}, 1000); return { success: true };'],
  ])('rejects %s', (_label, code) => {
    const result = staticScan(code);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('rejects empty code', () => {
    expect(staticScan('').ok).toBe(false);
    expect(staticScan('   ').ok).toBe(false);
  });

  it('reports every violation at once so one repair round can fix them all', () => {
    const code = "const fs = require('fs'); return { success: true, data: process.env.X };";
    const result = staticScan(code);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe('smokeTest — every case must pass', () => {
  it('passes when all cases succeed', async () => {
    const result = await smokeTest(
      [{ args: { a: 1 } }, { args: { a: 2 } }],
      async () => ({ success: true, data: 'ok' }),
    );
    expect(result.ok).toBe(true);
    expect(passCount(result)).toBe(2);
  });

  it('fails the whole tool when only one case fails', async () => {
    let n = 0;
    const result = await smokeTest([{ args: { a: 1 } }, { args: { a: 2 } }], async () => {
      n++;
      return n === 1 ? { success: true } : { success: false, error: 'HTTP 405' };
    });
    expect(result.ok).toBe(false);
    expect(passCount(result)).toBe(1);
    expect(result.failureSummary).toContain('HTTP 405');
  });

  it('treats an undefined return as a failure (the calculate_route_eta bug)', async () => {
    const result = await smokeTest([{ args: {} }], async () => undefined as never);
    expect(result.ok).toBe(false);
    expect(result.outcomes[0].error).toMatch(/did not return/);
  });

  it('treats a thrown handler as a failure rather than propagating', async () => {
    const result = await smokeTest([{ args: {} }], async () => {
      throw new Error('boom');
    });
    expect(result.ok).toBe(false);
    expect(result.outcomes[0].error).toBe('boom');
  });

  it('times a slow handler out instead of hanging the run', async () => {
    const result = await smokeTest(
      [{ args: {} }],
      () => new Promise(() => {}),
      50,
    );
    expect(result.ok).toBe(false);
    expect(result.outcomes[0].error).toMatch(/timed out/);
  });

  it('refuses to pass a tool with no cases — unverifiable must not ship', async () => {
    const result = await smokeTest([], async () => ({ success: true }));
    expect(result.ok).toBe(false);
  });
});
