import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plan P2-0a: the re-enabled custom tools. A reviewed allow-list, the reserved
// `custom:` toolset, a collision skip, read-only platform.call, and attended
// owner turns only. Synthetic rows; nothing reads production.

const h = vi.hoisted(() => ({
  rows: [] as Array<{ name: string; description: string; toolset: string; parameters: unknown; handlerCode: string; enabled: boolean }>,
  calls: [] as string[],
}));

vi.mock('$lib/db', () => {
  const chain = { from: () => chain, where: async () => h.rows, set: () => chain, catch: () => undefined };
  return { db: { select: () => chain, update: () => ({ set: () => ({ where: () => ({ catch: () => undefined }) }) }) } };
});
vi.mock('$lib/jkai/grounding/authored.server', () => ({
  validateHandler: () => {},
  // The sandbox stand-in: the handler body names the tool it reaches for.
  runAuthored: async (code: string, _args: unknown, call: (n: string, a: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>) => {
    const target = code.trim();
    if (!target) return { success: true, data: 'no call' };
    return call(target, {});
  },
}));

import { REENABLED_CUSTOM_TOOLS, customToolsetFor } from './custom-tools-enabled';
import { loadCustomTools } from './custom-tool-loader';
import { executeTool, getTool } from './registry';
import type { ToolPrincipal } from './invoke-contract';

const row = (name: string, toolset: string, handlerCode = '') => ({ name, description: `synthetic ${name}`, toolset, parameters: { type: 'object', properties: {} }, handlerCode, enabled: true });
const owner: ToolPrincipal = { principalId: 'owner', via: 'session', attended: true, jobId: 'job-1' };

beforeEach(() => {
  h.calls = [];
});

describe('the re-enabled custom tools allow-list', () => {
  it('names at most five tools, each with a reason', () => {
    expect(REENABLED_CUSTOM_TOOLS.length).toBeGreaterThan(0);
    expect(REENABLED_CUSTOM_TOOLS.length).toBeLessThanOrEqual(5);
    for (const t of REENABLED_CUSTOM_TOOLS) expect(t.why.length).toBeGreaterThan(20);
  });

  it('re-homes under the reserved prefix, never onto a built-in toolset', () => {
    expect(customToolsetFor('sports')).toBe('custom:sports');
    expect(customToolsetFor('custom-tools')).toBe('custom:tools');
    expect(customToolsetFor('')).toBe('custom:tools');
  });
});

describe('loadCustomTools', () => {
  it('loads only allow-listed rows, under custom:, read, and skips a collision', async () => {
    h.rows = [
      row('f1_driver_standings', 'sports', ''),
      row('wikipedia_live_summary', 'custom-tools', 'ha_call_service'),
      row('sausage_generator', 'fun', ''),
      row('tool_search', 'discovery', ''),
    ];
    const out = await loadCustomTools(new Set(['f1_driver_standings', 'wikipedia_live_summary', 'tool_search']));
    expect(out.loaded).toEqual(['f1_driver_standings', 'wikipedia_live_summary']);
    expect(out.skipped).toEqual([{ name: 'tool_search', reason: 'collides with a registered tool' }]);
    expect(getTool('f1_driver_standings')).toMatchObject({ toolset: 'custom:sports', effect: 'read' });
    expect(getTool('sausage_generator')).toBeUndefined();
    // The built-in was not replaced.
    expect(getTool('tool_search')?.toolset).toBe('discovery');
  }, 120_000);

  it('runs for John in an attended chat, and for nobody unattended', async () => {
    const ok = await executeTool('f1_driver_standings', {}, { emit: () => {}, principal: owner });
    expect(ok.success).toBe(true);
    for (const via of ['heartbeat', 'whatsapp', 'bridge', 'service'] as const) {
      const r = await executeTool('f1_driver_standings', {}, { emit: () => {}, principal: { principalId: 'owner', via, attended: false, allowedTools: ['f1_driver_standings'] } });
      expect(r.success, via).toBe(false);
      expect(r.error).toContain('saved custom tool');
    }
    const siri = await executeTool('f1_driver_standings', {}, { emit: () => {}, principal: { ...owner, via: 'device', surface: 'siri' } });
    expect(siri.success).toBe(false);
  });

  it('may only read through platform.call, with the caller principal', async () => {
    const r = await executeTool('wikipedia_live_summary', {}, { emit: () => {}, principal: owner });
    expect(r.success).toBe(false);
    expect(r.error).toContain('may only read');
  });
});
