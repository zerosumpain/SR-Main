/** Fixed checkpoints for small, review-driven developments. */
export const DEVELOPMENT_LIMITS = { preflightMs: 120_000, turnMs: 300_000, firstPreviewMs: 600_000, candidateMs: 1_200_000, repairAttempts: 1 };
export type DevelopmentFailureKind = 'infrastructure' | 'feature' | 'deadline';
export class DevelopmentFailure extends Error {
  constructor(message: string, public kind: DevelopmentFailureKind = 'infrastructure') { super(message); }
}
export function developmentFailureKind(error: unknown): DevelopmentFailureKind {
  return error instanceof DevelopmentFailure ? error.kind : 'infrastructure';
}
/**
 * How far past its limit a cycle may run on broker time before it stops anyway.
 * A hung or crawling broker must still end the cycle; 3× leaves room for
 * several previews and a release verification on top of the model's own
 * minutes, and still ends a stuck first-preview cycle half an hour in.
 */
export const DEVELOPMENT_CEILING_FACTOR = 3;
type CycleClock = { startedAt: string; previewMs?: number; verificationMs?: number };
const limitFor = (hasPreview: boolean) => hasPreview ? DEVELOPMENT_LIMITS.candidateMs : DEVELOPMENT_LIMITS.firstPreviewMs;
/** The wall-clock end no amount of broker time extends. */
export function developmentCeiling(startedAt: string, hasPreview: boolean) {
  return Date.parse(startedAt) + DEVELOPMENT_CEILING_FACTOR * limitFor(hasPreview);
}
/**
 * When the model's checkpoint expires: the limit counts MODEL time.
 *
 * Measured from the cycle start alone, a working preview — fresh container,
 * database, schema push and a full production build, 300–350s — and a release
 * verification (~770s) spent the limit on the broker, leaving the model about
 * four of its ten minutes. So broker time already recorded on the cycle
 * (previewMs, verificationMs, failed attempts included) extends the deadline,
 * up to developmentCeiling. A broker call still in flight is not yet recorded;
 * it is bounded by its own operation deadline, which is the ceiling.
 */
export function developmentDeadline(cycle: CycleClock, hasPreview: boolean) {
  const broker = Math.max(0, (cycle.previewMs ?? 0) + (cycle.verificationMs ?? 0));
  return Math.min(Date.parse(cycle.startedAt) + limitFor(hasPreview) + broker, developmentCeiling(cycle.startedAt, hasPreview));
}
/** The session retains detailed history; follow-up prompts need only new findings. */
export function developmentFeedback(evaluation: string | null | undefined) {
  return (evaluation ?? '').split('Workspace state after this iteration:')[0].slice(-2400);
}
export function developmentTools(names: string[]) {
  const relevant = new Set(['ask_owner', 'tool_search', 'tool_describe', 'api_search', 'api_integration_list', 'capabilities_snapshot', 'codegraph_query', 'build_inspect', 'workflow_inspect']);
  return names.filter(name => relevant.has(name));
}
