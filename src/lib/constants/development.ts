export const PRODUCT_AREAS = ['Public site', 'News', 'Health', 'Intelligence', 'Maps', 'Decks', 'Platform', 'JKAI'] as const;
export type DeliveryStage = 'brief' | 'queued' | 'building' | 'needs_input' | 'review' | 'integrating' | 'accepted' | 'pr_open' | 'deployed';
export interface Criterion {
  id: string;
  text: string;
  verdict: 'unverified' | 'passed' | 'failed' | 'blocked';
  evidence: string;
  revision: string | null;
  assessment?: { basis: 'observed' | 'inferred'; verdict: 'passed' | 'failed' | 'blocked'; evidence: string; model: string; revision: string; at: string };
}
export interface DeliveryState {
  version: 1;
  area: string;
  stage: DeliveryStage;
  originalAsk?: string;
  cycle?: { startedAt: string; modelId?: string; startingCandidate?: string | null; preflightAt?: string; firstPreviewAt?: string; candidateAt?: string; failureKind?: 'infrastructure' | 'feature' | 'deadline'; failure?: string; repairAttempts: number; modelMs: number; previewMs: number; verificationMs: number; phaseMs?: Record<string, number>; };
  grooming?: { turns?: Array<{ questions: string; answer: string }>; model: string; at: string; summary: string };
  brief: { scope?: string; dependencies?: string; assumptions?: string; questions?: string; validation?: string; revision: number; outcome: string; constraints: string; routes: string[]; acceptedAt: string | null };
  criteria: Criterion[];
  decisions: Array<{ id: string; question: string; answer: string | null; requestId?: string }>;
  session: { engine: 'pi'; id: string | null; file: string | null; recovery: string | null };
  candidate: string | null;
  changes?: { files: string[]; patch: string };
  gate: { passed: boolean; evidence: string; revision: string } | null;
  preview: { revision?: string; kind?: 'working' | 'inspection' | 'release'; number?: number; evidence?: string[]; lastError?: string; url: string | null; status: 'unavailable' | 'starting' | 'ready' | 'failed'; detail: string };
  batch: string | null;
  acceptedAt: string | null;
  releasePolicy: 'preview_only';
}
