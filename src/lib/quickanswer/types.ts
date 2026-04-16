import type { QuickAnswerSource } from '$lib/db/schema';

export type QuickAnswerStatus = 'pending' | 'searching' | 'synthesising' | 'complete' | 'failed';

export type QuickAnswerSSEEvent =
  | { type: 'log'; message: string }
  | { type: 'status'; data: { status: QuickAnswerStatus } }
  | { type: 'sources'; data: { sources: QuickAnswerSource[] } }
  | { type: 'token'; data: { token: string } }
  | { type: 'complete'; data: { durationMs: number } }
  | { type: 'error'; message: string };
