import { describe, it, expect, afterEach, vi } from 'vitest';

// `./registry` reaches `$lib/workflows`, whose module body boots WhatsApp and
// Home Assistant unless this is set — see reference_test_imports_boot_platform_services.
vi.hoisted(() => {
  process.env.JKAI_BUILDER_PROCESS = '1';
});
import { executeTool, register } from './registry';
import { unregister, type ToolExecContext } from './registry-internal';
import { withExecution, currentExecution } from '$lib/jkai/grounding/execution';
import { contextForWire } from './remote';
import { coerceInvokeRequest } from './invoke-contract';

/**
 * A member's tool call is refused at the EXECUTOR unless it carries its closed
 * list — not only in what chat offers the model. These run the real
 * `executeTool` (the same import `toolchain-fixes.test.ts` makes) against
 * `render_table`, which is pure, and `memory_search`, which is refused before
 * it could reach the database.
 */

const TABLE = { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] };
const SCOPE_ERROR = /outside this caller's capability scope/;

const member = (extra: Partial<ToolExecContext> = {}): ToolExecContext => ({ emit: () => {}, principalId: 'u_x', ...extra });

afterEach(() => {
  unregister('principal_scope_nested_probe');
});

describe('executeTool — principal scope', () => {
  it('refuses a member call that carries no allowedTools, even for a harmless tool', async () => {
    const res = await executeTool('render_table', TABLE, member());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(SCOPE_ERROR);
  });

  it('runs only what the member scope lists', async () => {
    const scoped = member({ allowedTools: ['render_table'] });
    const refused = await executeTool('memory_search', { query: 'anything' }, scoped);
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(SCOPE_ERROR);

    const allowed = await executeTool('render_table', TABLE, scoped);
    expect(allowed.success).toBe(true);
  });

  it("leaves the owner's calls exactly as they were", async () => {
    // No principal, and an explicit 'owner', both run unscoped.
    expect((await executeTool('render_table', TABLE, { emit: () => {} })).success).toBe(true);
    expect((await executeTool('render_table', TABLE, { emit: () => {}, principalId: 'owner' })).success).toBe(true);
    expect((await executeTool('render_table', TABLE)).success).toBe(true);
  });

  it('refuses through the ambient context when no ctx is passed', async () => {
    const res = await withExecution(member(), () => executeTool('render_table', TABLE));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(SCOPE_ERROR);
  });

  it('carries the refusal into a nested call, as an ephemeral tool makes one', async () => {
    // Shaped like `tools/ephemeral-tools.ts` and `custom-tool-loader.ts`: the
    // nested call spreads `currentExecution()`, so principal and scope ride along.
    const nested: Array<{ bare: unknown; spread: unknown; seen: ToolExecContext | undefined }> = [];
    register({
      name: 'principal_scope_nested_probe',
      description: 'test probe',
      parameters: { type: 'object', properties: {} },
      category: 'Test',
      toolset: 'test',
      handler: async () => {
        const bare = await executeTool('memory_search', { query: 'x' });
        const spread = await executeTool('memory_search', { query: 'x' }, {
          emit: () => {},
          ...currentExecution(),
          depth: (currentExecution()?.depth ?? 0) + 1,
        });
        nested.push({ bare, spread, seen: currentExecution() });
        return { success: true };
      },
    });

    const res = await executeTool('principal_scope_nested_probe', {}, member({ allowedTools: ['principal_scope_nested_probe'] }));
    expect(res.success).toBe(true);
    expect(nested).toHaveLength(1);
    expect(nested[0].seen?.principalId).toBe('u_x');
    for (const r of [nested[0].bare, nested[0].spread] as Array<{ success: boolean; error?: string }>) {
      expect(r.success).toBe(false);
      expect(r.error).toMatch(SCOPE_ERROR);
    }
  });
});

describe('principalId on the wire', () => {
  it('crosses and is read back unchanged', () => {
    const wire = contextForWire(member({ allowedTools: ['render_table'] }));
    expect(wire).toEqual({ principalId: 'u_x', allowedTools: ['render_table'] });
    expect(coerceInvokeRequest({ name: 't', context: wire }).context).toEqual(wire);
  });

  it('is absent for an older caller, which reads as the owner', () => {
    expect(coerceInvokeRequest({ name: 't', context: {} }).context.principalId).toBeUndefined();
    expect(coerceInvokeRequest({ name: 't', context: { principalId: '' } }).context.principalId).toBeUndefined();
    expect(coerceInvokeRequest({ name: 't', context: { principalId: 7 } }).context.principalId).toBeUndefined();
  });
});
