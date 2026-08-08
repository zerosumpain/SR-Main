export interface BudgetConfig {
  activeMinutesPerHour?: number;
  maxTokensPerHour?: number;
  maxIterations?: number;
  maxTotalMinutes?: number;
  /**
   * Hard ceiling on a SINGLE iteration, enforced mid-stream by the runner.
   * The per-hour caps are only checked between iterations, so without this one
   * runaway iteration can spend the whole hourly budget and more before anyone
   * gets a say — two did on 2026-08-07, at 1.55M tokens each.
   */
  maxTokensPerIteration?: number;
}

export interface ServeConfig {
  port: number;
  startCommand: string | null;
  healthCheck: string;
  description: string;
  /** When set to 'static', the build is a self-contained set of files in
   * /home/jkai/workspace/<id>/live/ and the proxy serves them directly
   * (no dev server). register_hermes_build emits this kind for static
   * HTML apps. When omitted or 'dev', the proxy expects a backing dev
   * server listening on `port` and bridges it via proxyToSandbox. */
  kind?: 'static' | 'dev';
}

export interface ActionRecord {
  lang: string;
  code: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface TestResult {
  passed: boolean;
  output: string;
  testCount: number;
  failCount: number;
  duration: number;
}

export interface BudgetCheckResult {
  canProceed: boolean;
  sleepMs?: number;
  reason?: string;
  shouldComplete?: boolean;
}

export type BuildStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type IterationStatus = 'running' | 'completed' | 'failed';
export type LogType = 'thinking' | 'text' | 'code' | 'output' | 'error' | 'system';

export type FailureKind =
  | 'stalled'
  | 'provider_error'
  | 'rate_limited'
  | 'auth_failed'
  /** The jkai tool bridge did not load — the agent ran with no site tools. */
  | 'tooling_unavailable'
  /** One iteration hit `maxTokensPerIteration`; work is preserved, like a wall-clock stop. */
  | 'iteration_token_cap'
  | 'container_missing'
  | 'wall_clock_timeout'
  | 'nonzero_exit'
  | 'empty_output'
  | 'design_lint'
  | 'design_lint_loop';

export interface FailureEnvelope {
  kind: FailureKind;
  message: string;
  httpStatus?: number;
  providerErrorCode?: string;
  lastEventAgeMs?: number;
  tokensBeforeStall?: number;
  stderrTail?: string;
  attempts: number;
}
