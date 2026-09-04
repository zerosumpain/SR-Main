// The durable brief shared by the backlog UI and every automated build lane.
// Pure on purpose: the modal imports the readiness rule and line helpers, so
// this module must never reach the datastore, database or private env.

import type {
  BacklogEffort,
  BacklogGroomingData,
  BacklogGroomingTurn,
  BacklogItemData,
  BacklogNote,
  BacklogReadinessStatus,
  BacklogRelation,
  BacklogRelationKind,
  BacklogRisk,
} from './types';

export const BACKLOG_EFFORTS = ['small', 'medium', 'large'] as const;
export const BACKLOG_RISKS = ['low', 'medium', 'high'] as const;
export const BACKLOG_RELATIONS = ['duplicate', 'related', 'blocks', 'blocked_by'] as const;

/**
 * Turns kept on a record, and notes kept on one.
 *
 * These live HERE and not in `./types` for the reason `IDEA_SOURCES` lives in
 * `./board`: the editor needs them as VALUES, and `types.ts` value-imports
 * `$lib/toolpolicy/policy`, which reaches `$lib/db` and `$env/dynamic/private`.
 * A `.svelte` that imports it for real fails the BUILD while `svelte-check`
 * passes clean.
 */
export const MAX_GROOMING_CONVERSATION = 24;
export const MAX_BACKLOG_NOTES = 100;
/** One note. Long enough for a paragraph of reasoning, not an essay. */
export const MAX_NOTE_LENGTH = 2_000;

const MAX_TEXT = 2_000;
const MAX_LIST_ITEM = 500;
const MAX_LIST = 20;

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function stringList(value: unknown, limit = MAX_LIST): string[] {
  const input = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/)
      : [];
  return [...new Set(input.map((v) => text(v, MAX_LIST_ITEM)).filter(Boolean))].slice(0, limit);
}

export function lines(value: string): string[] {
  return stringList(value);
}

export function calculateReadiness(input: {
  problem?: unknown;
  outcome?: unknown;
  acceptanceCriteria?: unknown;
  validation?: unknown;
  implementationNotes?: unknown;
  openQuestions?: unknown;
}): BacklogGroomingData['readiness'] {
  const problem = text(input.problem);
  const outcome = text(input.outcome);
  const criteria = stringList(input.acceptanceCriteria);
  const validation = stringList(input.validation);
  const notes = stringList(input.implementationNotes);
  const questions = stringList(input.openQuestions);

  let score = 0;
  if (problem) score += 20;
  if (outcome) score += 20;
  score += Math.min(30, criteria.length * 10);
  score += Math.min(15, validation.length * 8);
  score += Math.min(10, notes.length * 5);
  if (questions.length === 0) score += 5;
  score -= Math.min(28, questions.length * 7);
  score = Math.max(0, Math.min(100, score));

  let status: BacklogReadinessStatus = 'draft';
  if (questions.length > 0) status = 'needs_input';
  else if (score >= 80) status = 'ready';

  const missing: string[] = [];
  if (!problem) missing.push('problem');
  if (!outcome) missing.push('outcome');
  if (criteria.length < 3) missing.push('acceptance criteria');
  if (validation.length < 1) missing.push('validation');
  const reason = questions.length
    ? `${questions.length} open question${questions.length === 1 ? '' : 's'} still need a decision.`
    : missing.length
      ? `Strengthen ${missing.join(', ')} before an automated build.`
      : 'The problem, outcome, acceptance criteria and validation are explicit.';

  return { score, status, reason };
}

export interface GroomingCandidate {
  slug: string;
  title: string;
  kind: BacklogItemData['kind'];
}

export interface NormaliseGroomingOptions {
  modelId: string;
  groomedAt?: string;
  revision?: number;
  allowedRelations?: ReadonlyMap<string, GroomingCandidate>;
  assistantSummary?: string;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

/** Turn model JSON or a browser round-trip into the one safe stored shape. */
export function normaliseGrooming(
  raw: unknown,
  options: NormaliseGroomingOptions,
): BacklogGroomingData {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const relatedItems: BacklogRelation[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(obj.relatedItems) ? obj.relatedItems : []) {
    if (!value || typeof value !== 'object') continue;
    const rel = value as Record<string, unknown>;
    const slug = text(rel.slug, 200);
    const candidate = options.allowedRelations?.get(slug);
    // Model-created relations are only accepted when the server supplied that
    // exact durable id. Persisted round-trips have no map and retain their ids.
    if (!slug || seen.has(slug) || (options.allowedRelations && !candidate)) continue;
    const relation = enumValue<BacklogRelationKind>(rel.relation, BACKLOG_RELATIONS, 'related');
    relatedItems.push({
      slug,
      title: candidate?.title || text(rel.title, 200) || slug,
      kind: candidate?.kind ?? enumValue(rel.kind, ['tool', 'feature', 'source', 'watch', 'engine'] as const, 'feature'),
      relation,
      reason: text(rel.reason, 500),
    });
    seen.add(slug);
    if (relatedItems.length >= 10) break;
  }

  const core = {
    problem: text(obj.problem),
    outcome: text(obj.outcome),
    acceptanceCriteria: stringList(obj.acceptanceCriteria),
    constraints: stringList(obj.constraints),
    nonGoals: stringList(obj.nonGoals),
    dependencies: stringList(obj.dependencies),
    implementationNotes: stringList(obj.implementationNotes),
    validation: stringList(obj.validation),
    assumptions: stringList(obj.assumptions),
    openQuestions: stringList(obj.openQuestions),
    decisions: stringList(obj.decisions),
  };

  return {
    ...core,
    relatedItems,
    effort: enumValue<BacklogEffort>(obj.effort, BACKLOG_EFFORTS, 'medium'),
    risk: enumValue<BacklogRisk>(obj.risk, BACKLOG_RISKS, 'medium'),
    // Deterministic, not model-authored. The UI and builder therefore agree
    // on what "ready" means and a persuasive sentence cannot inflate it.
    readiness: calculateReadiness(core),
    assistantSummary: text(options.assistantSummary ?? obj.assistantSummary, 1_000),
    modelId: text(options.modelId || obj.modelId, 200),
    groomedAt: options.groomedAt ?? (text(obj.groomedAt, 100) || new Date().toISOString()),
    revision: Math.max(1, Math.round(options.revision ?? (Number(obj.revision) || 1))),
    // Kept, but never fed to a build lane — `renderBacklogBrief` below reads
    // the structured fields and nothing else. A lane must not reconstruct a
    // decision out of chat; a person resuming the grooming needs to see it.
    conversation: normaliseConversation(obj.conversation),
  };
}

/** Sanitize and mark the structured draft a person chose to save. */
export function acceptGrooming(raw: unknown, now = new Date().toISOString()): BacklogGroomingData {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    ...normaliseGrooming(raw, {
      modelId: text(obj.modelId, 200),
      groomedAt: text(obj.groomedAt, 100) || now,
      revision: Number(obj.revision) || 1,
    }),
    acceptedAt: now,
  };
}

/**
 * The stored shape of a grooming thread.
 *
 * Trimmed from the END, keeping the most recent turns: an argument that has run
 * long is resumed from where it got to, not from where it started. A turn whose
 * role is neither `user` nor `assistant` is dropped rather than coerced — a
 * mislabelled turn read back as the other party is worse than a missing one.
 */
export function normaliseConversation(raw: unknown): BacklogGroomingTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: BacklogGroomingTurn[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const turn = value as Record<string, unknown>;
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    const content = text(turn.content, MAX_NOTE_LENGTH);
    if (!content) continue;
    turns.push({ role: turn.role, content });
  }
  return turns.slice(-MAX_GROOMING_CONVERSATION);
}

/**
 * One note, sanitised.
 *
 * `author` is NOT read from the input: the caller states it, and the route
 * states `owner` for anything a person typed. The same rule `coerceSource`
 * follows — a request must not be able to sign its content as something it is
 * not.
 */
export function normaliseNote(
  raw: unknown,
  author: BacklogNote['author'],
  now = new Date().toISOString(),
): BacklogNote | null {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const body = text(typeof raw === 'string' ? raw : obj.text, MAX_NOTE_LENGTH);
  if (!body) return null;
  return {
    id: text(obj.id, 60) || `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: text(obj.at, 100) || now,
    author,
    text: body,
  };
}

function section(label: string, values: string[]): string {
  return values.length ? `\n${label}:\n${values.map((v) => `- ${v}`).join('\n')}` : '';
}

/**
 * The canonical brief handed to toolsmith, repo builder and monitor author.
 * Older rows keep their original detail until they are groomed.
 */
export function renderBacklogBrief(item: Pick<BacklogItemData, 'title' | 'detail' | 'grooming'>): string {
  const g = item.grooming;
  if (!g) return `${item.title}\n\n${item.detail}`.trim();
  return [
    `Feature: ${item.title}`,
    `Problem: ${g.problem || item.detail || 'Not recorded'}`,
    `Desired outcome: ${g.outcome || item.detail || 'Not recorded'}`,
    `Delivery profile: ${g.effort} effort · ${g.risk} risk · ${g.readiness.status} (${g.readiness.score}/100)`,
    section('Acceptance criteria', g.acceptanceCriteria),
    section('Validation', g.validation),
    section('Constraints', g.constraints),
    section('Non-goals', g.nonGoals),
    section('Dependencies', g.dependencies),
    section('Implementation notes', g.implementationNotes),
    section('Decisions already made', g.decisions),
    section('Assumptions to verify', g.assumptions),
    section('Remaining open questions', g.openQuestions),
  ].filter(Boolean).join('\n');
}

export interface GroomingModelResult {
  assistantMessage: string;
  suggestions: {
    title: string;
    detail: string;
    kind: BacklogItemData['kind'];
    priority: number;
  };
  grooming: BacklogGroomingData;
  model: string;
}
