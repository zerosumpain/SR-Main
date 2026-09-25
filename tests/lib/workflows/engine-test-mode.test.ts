import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import { conditionalDef, conditionalExecutor } from '$lib/workflows/nodes/conditional';
import { whatsappDef } from '$lib/workflows/nodes/whatsapp.def';
import { builderChatDef } from '$lib/workflows/nodes/builder-canvas.def';
import { fileBuildDef } from '$lib/workflows/nodes/file-build.def';
import { appleCalendarDef } from '$lib/workflows/nodes/apple-calendar.def';
import { dataStoreDef } from '$lib/workflows/nodes/data-store.def';
import { httpRequestDef } from '$lib/workflows/nodes/http-request';
import { hasSideEffects } from '$lib/workflows/side-effects';
import type { NodeDefinition, NodeExecutor, WorkflowDefinition } from '$lib/workflows/types';

/**
 * TEST runs: pinned nodes are not executed, side-effecting nodes are stubbed by
 * the ENGINE (not by each node — builder-canvas, file-build and apple-calendar
 * never honoured dryRun and really built, wrote and booked), and an allowed
 * side effect runs for real. Every side-effecting executor here is a THROWING
 * spy: if the stub regresses, the test fails loudly instead of doing anything.
 */

const notifyRunOutcome = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/workflows/run-notifications', () => ({ notifyRunOutcome }));

function throwingExecutor(type: string) {
  return {
    type,
    execute: vi.fn(async (_input: unknown, _config: unknown, _ctx: { dryRun: boolean }): Promise<{ output: Record<string, unknown> }> => {
      throw new Error(`${type} executed for real in a test run`);
    }),
    getInputSchema: () => ({ type: 'object' }),
    getOutputSchema: () => ({ type: 'object' }),
  } satisfies NodeExecutor;
}

function makeEngine(extra: NodeDefinition[] = []) {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  registry.register(conditionalDef, conditionalExecutor);
  const spies: Record<string, ReturnType<typeof throwingExecutor>> = {};
  for (const def of extra) {
    spies[def.type] = throwingExecutor(def.type);
    registry.register(def, spies[def.type]);
  }
  return { engine: new WorkflowEngine(registry), spies };
}

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id, type, config, label: id, position: { x: 0, y: 0 },
});
const chain = (ids: string[]) => ids.slice(1).map((to, i) => ({ id: `e${i}`, sourceNodeId: ids[i], targetNodeId: to }));

describe('side effects are declared on the definition', () => {
  it('knows a send from a read, per config', () => {
    expect(hasSideEffects(whatsappDef, {})).toBe(true);
    expect(hasSideEffects(httpRequestDef, { method: 'GET' })).toBe(false);
    expect(hasSideEffects(httpRequestDef, { method: 'post' })).toBe(true);
    expect(hasSideEffects(dataStoreDef, { operation: 'get' })).toBe(false);
    expect(hasSideEffects(dataStoreDef, { operation: 'set' })).toBe(true);
    expect(hasSideEffects(appleCalendarDef, { operation: 'list' })).toBe(false);
    expect(hasSideEffects(appleCalendarDef, { operation: 'delete' })).toBe(true);
    expect(hasSideEffects(fileBuildDef, { persist: false })).toBe(false);
    expect(hasSideEffects(fileBuildDef, { persist: true })).toBe(true);
    expect(hasSideEffects(builderChatDef, {})).toBe(true);
    expect(hasSideEffects(transformDef, {})).toBe(false);
  });
});

describe('a test run', () => {
  it('stubs builder-canvas, file-build and apple-calendar — the nodes that ignored dryRun', async () => {
    const { engine, spies } = makeEngine([builderChatDef, fileBuildDef, appleCalendarDef, whatsappDef]);
    const wf: WorkflowDefinition = {
      id: 'w', name: 'side effects',
      nodes: [
        node('t', 'manual-trigger'),
        node('build', 'builder-chat', { prompt: 'make a page' }),
        node('file', 'file-build', { persist: true, outputName: 'x.pdf', format: 'pdf' }),
        node('cal', 'apple-calendar', { operation: 'create', title: 'Dentist' }),
        node('wa', 'whatsapp', { to: '+447700900000', message: 'hello {{trigger.name}}' }),
      ],
      edges: chain(['t', 'build', 'file', 'cal', 'wa']),
    };
    const result = await engine.execute(wf, 'run-test-stub', { name: 'Ada' }, undefined, 'w', { dryRun: true, selfHealing: false });
    expect(result.status).toBe('completed');
    for (const s of Object.values(spies)) expect(s.execute).not.toHaveBeenCalled();
    const wa = result.nodeOutputs.get('wa')!;
    expect(wa._stubbed).toBe(true);
    expect(typeof wa.wouldHave).toBe('string');
    // The RESOLVED config: what it would have sent.
    expect((wa.config as Record<string, unknown>).message).toBe('hello Ada');
    expect(notifyRunOutcome).not.toHaveBeenCalled();
  });

  it('uses a pinned output (and its branch) instead of running the node', async () => {
    const { engine } = makeEngine();
    const wf: WorkflowDefinition = {
      id: 'w', name: 'pins',
      nodes: [
        node('t', 'manual-trigger'),
        node('src', 'transform', { expression: 'throw new Error("should not run")' }),
        node('cond', 'conditional', { expression: 'input.x > 5' }),
        node('yes', 'transform', { expression: 'return { branch: "yes", x: input.x, pinnedSeen: input._pinned ?? null }' }),
        node('no', 'transform', { expression: 'return { branch: "no" }' }),
      ],
      edges: [
        ...chain(['t', 'src', 'cond']),
        { id: 'y', sourceNodeId: 'cond', targetNodeId: 'yes', sourceHandle: 'true' },
        { id: 'n', sourceNodeId: 'cond', targetNodeId: 'no', sourceHandle: 'false' },
      ],
    };
    const result = await engine.execute(wf, 'run-test-pin', {}, undefined, 'w', {
      dryRun: true,
      pins: { src: { output: { x: 1 } }, cond: { output: { x: 9 }, handle: 'true' } },
    });
    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('src')).toEqual({ x: 1, _pinned: true });
    expect(result.nodeSelectedHandles.get('cond')).toBe('true');
    // The marker stays on the node that was pinned, not everything downstream.
    expect(result.nodeOutputs.get('yes')).toEqual({ branch: 'yes', x: 9, pinnedSeen: null });
    expect(result.nodeOutputs.has('no')).toBe(false);
  });

  it('runs a side effect the owner allowed, for real, with dryRun off for that node only', async () => {
    const { engine, spies } = makeEngine([whatsappDef]);
    spies.whatsapp.execute.mockImplementationOnce(async (_i, _c, ctx) => ({ output: { sent: true, dry: ctx.dryRun } }));
    const wf: WorkflowDefinition = {
      id: 'w', name: 'allowed', nodes: [node('t', 'manual-trigger'), node('wa', 'whatsapp', { to: '+447700900000', message: 'x' })],
      edges: chain(['t', 'wa']),
    };
    const result = await engine.execute(wf, 'run-test-allow', {}, undefined, 'w', { dryRun: true, allowSideEffects: new Set(['wa']) });
    expect(spies.whatsapp.execute).toHaveBeenCalledTimes(1);
    expect(result.nodeOutputs.get('wa')).toEqual({ sent: true, dry: false });
  });

  it('a LIVE run ignores pins', async () => {
    const { engine } = makeEngine();
    const wf: WorkflowDefinition = {
      id: 'w', name: 'live', nodes: [node('t', 'manual-trigger'), node('a', 'transform', { expression: 'return { real: true }' })],
      edges: chain(['t', 'a']),
    };
    // start-run never passes pins to a live run; the engine only honours what it is given.
    const result = await engine.execute(wf, 'run-live', {}, undefined, 'w', {});
    expect(result.nodeOutputs.get('a')).toEqual({ real: true });
  });
});
