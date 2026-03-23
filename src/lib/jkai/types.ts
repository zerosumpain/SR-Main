export interface BudgetConfig {
  activeMinutesPerHour?: number;
  maxTokensPerHour?: number;
  maxIterations?: number;
  maxTotalMinutes?: number;
}

export interface ServeConfig {
  port: number;
  startCommand: string;
  healthCheck: string;
  description: string;
}

export interface ActionRecord {
  lang: string;
  code: string;
  stdout: string;
  stderr: string;
  exitCode: number;
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
