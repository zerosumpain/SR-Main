export type MemoryOrigin = 'user' | 'extraction' | 'daydream-note' | 'daydream-ruling' | 'daydream-place' | 'legacy';
export interface MemoryProvenance {
  origin: MemoryOrigin;
  sourceId?: string;
  sourceMemoryIds?: string[];
  subject?: string;
  predicate?: string;
  assertion?: 'stated' | 'observed' | 'inferred';
  validFrom?: string;
  validUntil?: string;
  kind?: 'fact' | 'preference' | 'procedure' | 'episode';
  scope?: 'personal' | 'daydream' | 'agent';
  linkedAt?: string;
  pinned?: boolean;
}

export interface AnswerAssessment { supported: boolean | null; complete: boolean | null; issues: string[]; revisedAnswer?: string }