/** Fixed checkpoints for small, review-driven developments. */
export const DEVELOPMENT_LIMITS = { preflightMs: 120_000, turnMs: 300_000, firstPreviewMs: 600_000, candidateMs: 1_200_000, repairAttempts: 1 };
export type DevelopmentFailureKind = 'infrastructure' | 'feature' | 'deadline';
export class DevelopmentFailure extends Error {
  constructor(message: string, public kind: DevelopmentFailureKind = 'infrastructure') { super(message); }
}
export function developmentFailureKind(error: unknown): DevelopmentFailureKind {
  return error instanceof DevelopmentFailure ? error.kind : 'infrastructure';
}
export function developmentDeadline(startedAt: string, hasPreview: boolean) {
  return Date.parse(startedAt) + (hasPreview ? DEVELOPMENT_LIMITS.candidateMs : DEVELOPMENT_LIMITS.firstPreviewMs);
}
/** The session retains detailed history; follow-up prompts need only new findings. */
export function developmentFeedback(evaluation: string | null | undefined) {
  return (evaluation ?? '').split('Workspace state after this iteration:')[0].slice(-2400);
}
export function developmentTools(names: string[]) {
  const relevant = new Set(['ask_owner', 'tool_search', 'tool_describe', 'api_search', 'api_integration_list', 'capabilities_snapshot', 'codegraph_query', 'build_inspect', 'workflow_inspect']);
  return names.filter(name => relevant.has(name));
}
