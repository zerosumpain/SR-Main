import { emitLog } from './log-emitter';

export type Stage =
  | 'planning'
  | 'awaiting_plan_approval'
  | 'iterating'
  | 'running_tests'
  | 'promoting'
  | 'awaiting_iter_approval'
  | 'paused'
  | 'completed'
  | 'failed';

export interface StagePayload {
  stage: Stage;
  iteration?: number;
  totalEstimate?: number;
  previewUrl?: string | null;
  failureKind?: string;
  message?: string;
  durationMs?: number;
}

export async function emitStage(buildId: string, payload: StagePayload, iterationId: string | null = null): Promise<void> {
  await emitLog(buildId, 'stage', JSON.stringify(payload), iterationId);
}

export function parseStage(content: string): StagePayload | null {
  try {
    const v = JSON.parse(content);
    if (v && typeof v === 'object' && typeof v.stage === 'string') return v as StagePayload;
  } catch {
    // not a stage event
  }
  return null;
}
