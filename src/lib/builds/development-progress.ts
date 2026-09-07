export type IterationProgress = { id: string; number: number; status: string; goals: string | null; evaluation: string | null;
  nextSteps: string | null; tokensUsed: number; outputTokens: number; durationMs: number | null; createdAt: string | Date };
export type DevelopmentProgress = { totalTokens: number; outputTokens: number; iterations: IterationProgress[] };
export function outputBudget(used: number, limit?: number) {
  return limit && limit > 0 ? { used, limit, percent: Math.min(100, Math.max(0, used / limit * 100)) } : null;
}
export function evidencedCriteria(criteria: Array<{ verdict: string; revision: string | null }>, candidate: string | null) {
  return candidate ? criteria.filter(c => c.verdict === 'passed' && c.revision === candidate).length : 0;
}
