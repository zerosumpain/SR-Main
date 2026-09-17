// src/lib/daydream/ponder/adversary.ts
//
// The second pass: make it argue with itself before it is allowed to speak.
//
// ── Why this, and not simply "more musings" ────────────────────────────────
//
// Measured on production 2026-09-17: a ponder cycle marked `deep` returned 636
// completion tokens against a Codex quota meter reading 0% of both the weekly
// and the five-hour window. The engine has headroom and spends none of it.
//
// The standing rule for that headroom is already written into this codebase —
// spare budget buys THINKING, never talking. Raising the musing cap would buy
// talking: 74% of what the first pass proposes is already an echo of something
// live, so a bigger cap mostly produces more echoes. What headroom should buy
// is a second, adversarial reading of the same cards.
//
// ── What the adversary may do ──────────────────────────────────────────────
//
// Three verdicts, and only three:
//
//   stands  — nothing to add. The default, and the cheapest answer.
//   drop    — this does not survive contact with the pack. It must name the
//             card that trivialises or contradicts the claim, so a drop is
//             itself evidence rather than a second opinion.
//   sharpen — the same cited cards support a more interesting or more precise
//             reading. The replacement text goes through the SAME citation
//             audit as the original, against the SAME pack.
//
// It cannot add musings, invent cards, raise salience, propose actions or
// touch leads. It is a filter and a rewrite over what already passed the first
// audit, which is what keeps one extra model call from becoming a second,
// unaudited proposer.
//
// PURE — no db, no clock, no model. The call lives in run.ts.

import { resolveCites } from '../cites';
import type { FactPack } from './pack';

export const ADVERSARY_VERDICTS = ['stands', 'drop', 'sharpen'] as const;
export type AdversaryVerdict = (typeof ADVERSARY_VERDICTS)[number];

export interface AdversaryRuling {
  slug: string;
  verdict: AdversaryVerdict;
  reason: string;
  /** Present only for `sharpen`, already audited against the pack. */
  text?: string;
  cites?: string[];
}

export interface AdversaryValidation {
  rulings: AdversaryRuling[];
  /** Refusals, by name. The fabrication meter for this pass. */
  rejected: string[];
}

/** Matches the musing text cap, so a sharpened line cannot outgrow the thing
 *  it replaces. */
export const MAX_SHARPENED_CHARS = 300;

export function adversaryPrompt(): string {
  return [
    "You are the sceptical half of John's second brain. Another pass has just written the musings below from the fact pack you have been given. Your job is to attack them, and to improve the ones worth keeping.",
    '',
    'For each musing, return exactly one verdict:',
    '- "stands" — it is supported and worth his attention as written. Use this freely; most things should stand.',
    '- "drop" — it does not survive the pack. Name the card id that trivialises or contradicts it in "reason". Use this when the claim is a restatement of one card, a coincidence dressed as a pattern, something the cards show is already handled, or a crossing that is true but of no consequence.',
    '- "sharpen" — the SAME cited cards support a more precise or more interesting reading. Put the replacement in "text" and the cards it rests on in "cites".',
    '',
    'HARD RULES:',
    '1. Reply with ONE JSON object: {"verdicts":[{"slug","verdict","reason","text","cites"}]}. No prose outside it.',
    '2. One entry per musing, using its slug exactly. Do not invent musings.',
    `3. A "sharpen" text is ≤ ${MAX_SHARPENED_CHARS} characters, plain, no greeting, no emoji, and every number, date, name or amount in it must appear in a card you cite. An uncited or wrongly-cited sharpen is discarded and the original is kept.`,
    '4. Sharpening means a better reading of the same evidence — a sharper "so what", a consequence the first pass left implicit, a more exact figure that is actually in a card. It does not mean a new subject.',
    '5. You may not add musings, change the theme, or propose actions.',
    '6. A claim you cannot check against a card is not thereby false. "drop" is for claims the pack contradicts or trivialises, not for claims the pack is silent about.',
  ].join('\n');
}

/**
 * Render the musings for the adversary. The pack itself is sent separately and
 * unchanged, so both passes reason over identical evidence.
 */
export function renderForAdversary(musings: Array<{ slug: string; title: string; text: string; cites: string[] }>): string {
  return musings
    .map((m) => `SLUG ${m.slug}\n  title: ${m.title}\n  text: ${m.text}\n  cites: ${m.cites.join(', ')}`)
    .join('\n\n');
}

/**
 * Audit the adversary's answer.
 *
 * `knownSlugs` is the set it is allowed to rule on. A ruling for anything else
 * is dropped rather than applied to a neighbour — the same reason
 * `resolveMetric` will not guess a metric from a label.
 */
export function validateAdversary(
  parsed: unknown,
  pack: FactPack,
  knownSlugs: ReadonlySet<string>,
): AdversaryValidation {
  const out: AdversaryValidation = { rulings: [], rejected: [] };
  if (parsed == null || typeof parsed !== 'object') {
    out.rejected.push('adversary output is not an object');
    return out;
  }
  const list = Array.isArray((parsed as { verdicts?: unknown }).verdicts)
    ? (parsed as { verdicts: unknown[] }).verdicts
    : [];
  const seen = new Set<string>();

  for (const raw of list) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const slug = typeof o.slug === 'string' ? o.slug.trim() : '';
    const verdict = typeof o.verdict === 'string' ? o.verdict.trim() : '';
    const reason = typeof o.reason === 'string' ? o.reason.trim().slice(0, 300) : '';

    if (!knownSlugs.has(slug)) {
      out.rejected.push(`adversary: ruling for unknown musing "${slug.slice(0, 30)}"`);
      continue;
    }
    if (seen.has(slug)) {
      out.rejected.push(`adversary: second ruling for ${slug}`);
      continue;
    }
    if (!(ADVERSARY_VERDICTS as readonly string[]).includes(verdict)) {
      out.rejected.push(`adversary ${slug}: unknown verdict "${verdict.slice(0, 20)}"`);
      continue;
    }
    seen.add(slug);

    if (verdict === 'sharpen') {
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      const { hits, misses } = resolveCites(o.cites, pack.byId);
      if (text.length < 10 || text.length > MAX_SHARPENED_CHARS) {
        // Keep the original rather than losing the musing to a bad rewrite.
        out.rejected.push(`adversary ${slug}: sharpen text length ${text.length} — original kept`);
        out.rulings.push({ slug, verdict: 'stands', reason });
        continue;
      }
      if (misses.length || hits.length === 0) {
        out.rejected.push(
          `adversary ${slug}: sharpen cites ${misses.length ? `unknown cards ${misses.join(',')}` : 'nothing'} — original kept`,
        );
        out.rulings.push({ slug, verdict: 'stands', reason });
        continue;
      }
      out.rulings.push({ slug, verdict: 'sharpen', reason, text, cites: hits });
      continue;
    }

    if (verdict === 'drop' && !reason) {
      // A drop with no reason is an opinion. The first pass already passed an
      // audit; overturning it has to cost a sentence.
      out.rejected.push(`adversary ${slug}: drop with no reason — original kept`);
      out.rulings.push({ slug, verdict: 'stands', reason: '' });
      continue;
    }

    out.rulings.push({ slug, verdict: verdict as AdversaryVerdict, reason });
  }

  return out;
}

/** Apply the rulings to a list of musings keyed by slug. Returns what survived
 *  and the counts, so the caller reports rather than infers. */
export function applyAdversary<T extends { slug: string }>(
  musings: T[],
  rulings: AdversaryRuling[],
): { kept: Array<T & { sharpenedText?: string; sharpenedCites?: string[] }>; dropped: string[]; sharpened: string[] } {
  const byslug = new Map(rulings.map((r) => [r.slug, r]));
  const kept: Array<T & { sharpenedText?: string; sharpenedCites?: string[] }> = [];
  const dropped: string[] = [];
  const sharpened: string[] = [];
  for (const m of musings) {
    const r = byslug.get(m.slug);
    // No ruling means it stands: silence from the adversary must never delete
    // something the first audit admitted.
    if (!r || r.verdict === 'stands') {
      kept.push(m);
      continue;
    }
    if (r.verdict === 'drop') {
      dropped.push(`${m.slug}: ${r.reason}`);
      continue;
    }
    sharpened.push(m.slug);
    kept.push({ ...m, sharpenedText: r.text, sharpenedCites: r.cites });
  }
  return { kept, dropped, sharpened };
}
