import { invokeWorkflowRuntime, decodeEngineResult, type EngineResult, type RemoteStartedRun } from './runtime-client';
import type { PinnedOutput, WorkflowDefinition } from './types';

export type RunMode = 'live' | 'test';

/**
 * Main's door to workflow runs. SR-Workflows loads, executes, pins and settles
 * every run; Main's callers (the event bus, WhatsApp dispatch, monitors and
 * commissions) start them through `startRun` / `startTriggeredRun` here.
 */

export interface ExecuteRunOptions {
  runId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  input: Record<string, unknown>;
  trigger?: string;
  label?: string;
  breakpoints?: Set<string>;
  selfHealing?: boolean;
  dryRun?: boolean;
  chainDepth?: number;
  /** A sub-workflow child: never takes a top-level concurrency slot. */
  parentRunId?: string | null;
  /** Idle + hard watchdogs (interactive starts: chat, re-run, the run tool). */
  watchdog?: boolean;
  /** Resume/recovery: outputs and branch choices already recorded. */
  seed?: { outputs: Record<string, Record<string, unknown>>; handles: Record<string, string> };
  /** Wall-clock the run began (resume keeps the original). */
  runStartedAt?: number;
  /**
   * 'test': pins stand in for their nodes, side effects are stubbed (bar
   * `allowSideEffects`), self-heal is off and nothing is announced. Recorded on
   * the run row, so a resume keeps it. Default 'live'.
   */
  mode?: RunMode;
  pins?: Record<string, PinnedOutput>;
  allowSideEffects?: string[];
}

export interface StartRunOptions extends Omit<ExecuteRunOptions, 'runId' | 'definition' | 'input' | 'seed' | 'runStartedAt'> {
  input?: Record<string, unknown>;
  trigger: string;
  /** A pre-shaped definition (single-node re-run); otherwise the stored graph. */
  definition?: WorkflowDefinition;
}

export interface StartedRun {
  runId: string;
  status: 'running' | 'pending';
  /** Settles when the run does. Resolves null in worker mode (another process runs it). */
  done: Promise<EngineResult | null>;
}

/**
 * Start through SR-Workflows. Live queued runs acknowledge their durable ID;
 * test/child/draft operations await the owner result before returning a settled
 * `done` promise. A missing workflow returns null; transport errors never fall back.
 */
export async function startRun(opts: StartRunOptions): Promise<StartedRun | null> {
  const started = await invokeWorkflowRuntime<RemoteStartedRun | null>({
    action: 'start', options: { ...opts, breakpoints: opts.breakpoints ? [...opts.breakpoints] : undefined },
  });
  return started ? { runId: started.runId, status: started.status, done: Promise.resolve(decodeEngineResult(started.result)) } : null;
}

/** An event, WhatsApp keyword or email started it: a trigger='event' run. */
export async function startTriggeredRun(
  workflowId: string,
  input: Record<string, unknown>,
  opts: { label: string; chainDepth?: number },
): Promise<string | null> {
  return (await startRun({ workflowId, trigger: 'event', input, ...opts }))?.runId ?? null;
}
