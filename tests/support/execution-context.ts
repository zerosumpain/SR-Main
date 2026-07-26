// Shared ExecutionContext factory for node/executor tests.
//
// The gap this closes: `ExecutionContext` (src/lib/workflows/types.ts) has 11
// required members, and ~30 test files each re-declared all 11 as an inline
// literal — while another 10 sidestepped the type entirely with
// `{...} as unknown as ExecutionContext`. Two costs followed from that:
//
//   1. Adding a required member to ExecutionContext meant editing ~30 test
//      files, so the pressure was always to add it as optional instead. The
//      engine-injected `_currentNodeId` / `_registry` pair is already documented
//      in types.ts as "optional because not every caller constructs them".
//   2. The `as unknown as ExecutionContext` sites silently stopped type-checking
//      the context altogether, so a renamed member would not fail the gate in
//      exactly the files most likely to depend on it.
//
// One factory fixes both: it is the single place that must change when the
// interface grows, and it returns a genuinely-typed ExecutionContext so no test
// needs a cast.
//
// Imported by relative path (`../../../support/execution-context`), matching how
// tests/__fixtures__ is already consumed. Deliberately NOT given a `$test` alias:
// an alias would have to live in svelte.config.js to satisfy svelte-check, which
// would make test-only helpers importable from production code. Every consumer
// today is under tests/, so a relative path costs nothing.
import { vi } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

/**
 * Build a complete, typed ExecutionContext with inert defaults.
 *
 * Every default is a no-op rather than a throw: the overwhelming majority of
 * executor tests care about one or two members and should not have to stub the
 * rest. Pass `overrides` for the members under test.
 *
 * `emit` defaults to `vi.fn()` rather than `() => {}` so it is assertable
 * without the caller having to override it first:
 *
 *     const ctx = makeExecutionContext();
 *     await someExecutor.execute(input, config, ctx);
 *     expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'log' }));
 *
 * `abortSignal` is a fresh, un-aborted signal per call — sharing one across
 * tests would let an abort in one leak into the next.
 */
export function makeExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    runId: 'test-run',
    workflowId: 'test-workflow',
    workspaceDir: '/tmp/test',
    dryRun: false,
    emit: vi.fn(),
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodeConfig: () => undefined,
    ...overrides,
  };
}

/**
 * A context whose `abortSignal` is already aborted, for the "bails out when
 * cancelled" case. `reason` is surfaced on the signal so an executor that
 * propagates it can be asserted against.
 */
export function makeAbortedExecutionContext(
  overrides: Partial<ExecutionContext> = {},
  reason: unknown = new Error('aborted by test'),
): ExecutionContext {
  const controller = new AbortController();
  controller.abort(reason);
  return makeExecutionContext({ abortSignal: controller.signal, ...overrides });
}
