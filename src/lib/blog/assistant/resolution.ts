// Durable record of what the author did with each assistant proposal.
//
// Why this exists: the assistant's accept/reject decisions were the single
// richest signal about John's prose taste, and until now every one of them was
// discarded. `apply-proposal` wrote `{id, status:'accepted'}` for meta fields
// and nothing at all for rejections, so prod ended up with 37 proposals and 0
// resolutions — and `buildStyleCues` has only ever returned its "no prior
// decisions yet" fallback.
//
// What a rejection tells you is stronger than what an acceptance does: the
// model proposed X, and the author refused it. Stronger still is an *edited*
// acceptance — the model proposed X, and the author shipped Y instead. That
// pair is a direct statement of preference, and it is what the Voice Card's
// `preferences.json` is built from.
//
// Shape note: `status` stays exactly `'accepted' | 'rejected'` so the existing
// `buildStyleCues` parse keeps working unchanged; the edit signal rides along
// as a separate `edited` flag rather than a third status value.

import { appendMessage } from './messages';

/** Longest excerpt stored per field. Sentence-level rewrites sit far below
 *  this; the cap exists so a runaway proposal can't bloat the messages table. */
export const MAX_EXCERPT_CHARS = 2000;

export type ProposalResolution = {
  /** The proposal's client-side id. */
  id: string;
  status: 'accepted' | 'rejected';
  /** Accepted, but the author rewrote the suggestion before applying it.
   *  `final` then differs from `suggested` and is the thing he actually wanted. */
  edited?: boolean;
  kind: 'prose' | 'meta';
  /** Meta proposals only — which field was targeted. */
  field?: string;
  /** The text as it stood before the proposal. */
  original?: string;
  /** What the model proposed. */
  suggested?: string;
  /** What actually landed. Absent on rejection — nothing landed. */
  final?: string;
  /** The model's stated justification, if it gave one. */
  reason?: string;
  /** ISO-8601. Stamped at record time. */
  at: string;
};

export type ResolutionInput = Omit<ProposalResolution, 'at' | 'edited'> & {
  at?: string;
};

function clamp(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > MAX_EXCERPT_CHARS ? t.slice(0, MAX_EXCERPT_CHARS) : t;
}

/**
 * Normalise a raw resolution into the stored shape, deriving `edited` by
 * comparing what was proposed with what landed.
 */
export function buildResolution(input: ResolutionInput): ProposalResolution {
  const suggested = clamp(input.suggested);
  const final = input.status === 'rejected' ? undefined : clamp(input.final);

  const out: ProposalResolution = {
    id: input.id,
    status: input.status,
    kind: input.kind,
    at: input.at ?? new Date().toISOString(),
  };

  const field = clamp(input.field);
  const original = clamp(input.original);
  const reason = clamp(input.reason);
  if (field) out.field = field;
  if (original) out.original = original;
  if (suggested) out.suggested = suggested;
  if (final) out.final = final;
  if (reason) out.reason = reason;

  // Only meaningful when both sides are known and something actually landed.
  if (out.status === 'accepted' && suggested && final && suggested !== final) {
    out.edited = true;
  }

  return out;
}

/** Persist a resolution. Never throws — a failed record must not break an
 *  otherwise-successful edit the author just made. */
export async function recordResolution(postId: number, input: ResolutionInput): Promise<void> {
  const resolution = buildResolution(input);
  await appendMessage(postId, 'proposal_resolved', JSON.stringify(resolution)).catch(() => undefined);
}

/** Tolerant read side. Returns null for anything that isn't a resolution,
 *  including the legacy `{id, status}` rows written before this module —
 *  those still parse, they just carry no prose. */
export function parseResolution(content: string): ProposalResolution | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (r.status !== 'accepted' && r.status !== 'rejected') return null;

  const out: ProposalResolution = {
    id: r.id,
    status: r.status,
    kind: r.kind === 'meta' ? 'meta' : 'prose',
    at: typeof r.at === 'string' ? r.at : '',
  };
  if (r.edited === true) out.edited = true;
  for (const k of ['field', 'original', 'suggested', 'final', 'reason'] as const) {
    const v = r[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/**
 * The pairs worth learning from: a rejection (what he refused) or an edited
 * acceptance (what he replaced it with). Plain acceptances are the weakest
 * signal — tolerating a suggestion is not the same as wanting it — so they are
 * excluded here rather than diluting the set.
 */
export function preferencePairs(resolutions: ProposalResolution[]): ProposalResolution[] {
  return resolutions.filter((r) => r.status === 'rejected' || r.edited === true);
}
