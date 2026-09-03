// src/lib/daydream/ponder/schema.ts
//
// What the ponder model may return, and the audit that decides what survives.
//
// The contract: the model proposes as structured data — musings, lines of
// enquiry, at most one standing rule — and EVERY musing must cite fact cards
// from the pack it was shown. A musing whose citations do not resolve is
// dropped by code, counted, and never seen; that count is the fabrication
// meter, and it is the whole reason the model can be given a wide view at
// all. PURE — no db, no clock, no model.

import { validateAction, toProposedAction } from '../actions';
import type { Candidate } from '../snapshot-types';
import { SWEEP_METRICS } from '../stats/sweep';
import type { FactPack } from './pack';

/** Bounded so kind-level mutes and weights mean something: `never_kind` on
 *  musing_money must silence money musings forever, which requires the theme
 *  set to be closed. */
export const MUSING_THEMES = ['family', 'money', 'health', 'plans', 'patterns', 'general'] as const;
export type MusingTheme = (typeof MUSING_THEMES)[number];

export const MAX_MUSINGS = 4;
export const MAX_LEADS = 2;
export const MAX_ACTION_RULES = 1;

/** Per-run caps. The shipped numbers by default; the effort dial moves the
 *  first two (`effort.ts`), never the rule cap — a rule buzzes a phone. */
export interface PonderCaps {
  maxMusings: number;
  maxLeads: number;
  maxActionRules: number;
}
export const DEFAULT_PONDER_CAPS: PonderCaps = { maxMusings: MAX_MUSINGS, maxLeads: MAX_LEADS, maxActionRules: MAX_ACTION_RULES };
export const MAX_MUSING_CHARS = 300;

export interface ValidMusing {
  candidate: Candidate;
  /** The model's own sentence — becomes the thought's narrative directly,
   *  because it has passed the citation audit that compose's verify pass
   *  exists to approximate. */
  narrative: string;
  citedCardIds: string[];
}

export interface ValidLead {
  leadKey: string;
  title: string;
  rationale: string;
  metrics: string[];
}

export interface PonderValidation {
  musings: ValidMusing[];
  leads: ValidLead[];
  /** Raw rule specs, still to be run through the rules validator + backtest by
   *  the caller — this file cannot import the rules store without dragging in
   *  the db. */
  actionRules: unknown[];
  /** Names the model got nearly right, and what they became. Reported rather
   *  than applied silently — see resolveMetric. */
  coerced: string[];
  /** One line per refusal. This is the fabrication meter — report it, always. */
  rejected: string[];
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,47}$/;

/**
 * Map whatever the model called a metric onto the key the sweep actually has.
 *
 * Every lead ever proposed in production was rejected for `unknown metrics`,
 * and the names it offered say exactly why: `Time out`, `Verified spend`,
 * `Average steps last 7 days`, `sleep_duration`, `Readiness`. Those are the
 * PACK'S PROSE LABELS. The prompt told it to choose "metrics from the feature
 * store only" and never said what they were, so it named them the only way it
 * could — by reading them off the cards in front of it.
 *
 * The real fix is the prompt, which now lists the vocabulary. This is the
 * second line of defence, and it is deliberately narrow: an exact match, or a
 * match once both sides are reduced to lowercase letters and digits. It will
 * rescue `sleep_minutes` and `SleepMinutes`; it will NOT rescue `Readiness`
 * into `recoveryScore`, because that is a guess about meaning rather than a
 * difference of spelling, and a wrong guess here silently files a line of
 * enquiry against the wrong series.
 *
 * Every coercion is REPORTED. An alias quietly accepted is how
 * `entity_id`/`entityId` cost 44% of one toolset's calls while looking like
 * facts about the estate.
 */
const METRIC_BY_NORMALISED = new Map<string, string>(
  (SWEEP_METRICS as readonly string[]).map((m) => [m.toLowerCase().replace(/[^a-z0-9]/g, ''), m]),
);

export function resolveMetric(raw: string): string | null {
  const trimmed = raw.trim();
  if ((SWEEP_METRICS as readonly string[]).includes(trimmed)) return trimmed;
  return METRIC_BY_NORMALISED.get(trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')) ?? null;
}

export function validatePonderOutput(parsed: unknown, pack: FactPack, caps: PonderCaps = DEFAULT_PONDER_CAPS): PonderValidation {
  const out: PonderValidation = { musings: [], leads: [], actionRules: [], rejected: [], coerced: [] };
  if (parsed == null || typeof parsed !== 'object') {
    out.rejected.push('output is not an object');
    return out;
  }
  const o = parsed as Record<string, unknown>;

  // ── Musings ──
  const musings = Array.isArray(o.musings) ? o.musings : [];
  for (const raw of musings) {
    if (out.musings.length >= caps.maxMusings) {
      out.rejected.push('musing over the per-run cap');
      continue;
    }
    const m = raw as Record<string, unknown>;
    const slug = typeof m.slug === 'string' ? m.slug.trim() : '';
    const theme = typeof m.theme === 'string' ? m.theme.trim() : '';
    const title = typeof m.title === 'string' ? m.title.trim() : '';
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    const salience = typeof m.salience === 'number' ? m.salience : NaN;
    const cites = Array.isArray(m.cites) ? m.cites.filter((c): c is string => typeof c === 'string') : [];

    if (!SLUG_RE.test(slug)) { out.rejected.push(`musing: bad slug "${slug.slice(0, 30)}"`); continue; }
    if (!(MUSING_THEMES as readonly string[]).includes(theme)) {
      out.rejected.push(`musing ${slug}: theme "${theme}" not in the allow-list`); continue;
    }
    if (title.length < 3 || title.length > 90) { out.rejected.push(`musing ${slug}: bad title`); continue; }
    if (text.length < 10 || text.length > MAX_MUSING_CHARS) {
      out.rejected.push(`musing ${slug}: text length ${text.length}`); continue;
    }
    if (!Number.isFinite(salience) || salience < 0 || salience > 1) {
      out.rejected.push(`musing ${slug}: salience out of range`); continue;
    }
    if (cites.length === 0) { out.rejected.push(`musing ${slug}: no citations — dropped`); continue; }
    const missing = cites.filter((c) => !pack.byId.has(c));
    if (missing.length) {
      // The audit. A citation of a card that does not exist is the model
      // telling us it made something up; the musing dies whole.
      out.rejected.push(`musing ${slug}: cites unknown cards ${missing.join(',')} — dropped`);
      continue;
    }

    const cards = cites.map((c) => pack.byId.get(c)!);
    const actions: Candidate['proposedActions'] = [];
    for (const rawAction of Array.isArray(m.actions) ? m.actions.slice(0, 2) : []) {
      const v = validateAction(rawAction);
      if ('error' in v) out.rejected.push(`musing ${slug}: action refused — ${v.error}`);
      else actions.push(toProposedAction(v.action));
    }

    out.musings.push({
      narrative: text,
      citedCardIds: cites,
      candidate: {
        kind: `musing_${theme}`,
        title,
        // Deterministic and code-built: the audit trail, not the model's prose.
        explanation:
          `Drawn from ${cites.length} cited fact${cites.length === 1 ? '' : 's'}: ` +
          cards.map((c) => c.text).join(' · ').slice(0, 600),
        rawScore: Math.round(salience * 100) / 100,
        components: { salience: Math.round(salience * 100) / 100 },
        evidence: cards.map((c) => ({ kind: c.ref.kind, id: c.ref.id, note: c.text })),
        dedupeKey: `musing:${slug}`,
        proposedActions: actions,
      },
    });
  }

  // ── Lines of enquiry ──
  const leads = Array.isArray(o.leads) ? o.leads : [];
  for (const raw of leads) {
    if (out.leads.length >= caps.maxLeads) { out.rejected.push('lead over the per-run cap'); continue; }
    const l = raw as Record<string, unknown>;
    const leadKey = typeof l.leadKey === 'string' ? l.leadKey.trim() : '';
    const title = typeof l.title === 'string' ? l.title.trim() : '';
    const rationale = typeof l.rationale === 'string' ? l.rationale.trim() : '';
    const metrics = Array.isArray(l.metrics)
      ? l.metrics.filter((x): x is string => typeof x === 'string')
      : [];
    if (!SLUG_RE.test(leadKey)) { out.rejected.push(`lead: bad key "${leadKey.slice(0, 30)}"`); continue; }
    if (title.length < 3 || title.length > 120) { out.rejected.push(`lead ${leadKey}: bad title`); continue; }
    if (rationale.length < 10 || rationale.length > 400) { out.rejected.push(`lead ${leadKey}: bad rationale`); continue; }
    const resolved: string[] = [];
    const unknown: string[] = [];
    for (const mtr of metrics) {
      const hit = resolveMetric(mtr);
      if (!hit) { unknown.push(mtr); continue; }
      if (hit !== mtr) out.coerced.push(`lead ${leadKey}: "${mtr}" → ${hit}`);
      resolved.push(hit);
    }
    if (unknown.length) {
      // Name what WAS available. The old message said only what was wrong, and
      // nothing downstream ever read it back to the model — so the same guess
      // came round every two hours, fourteen times, for nothing.
      out.rejected.push(
        `lead ${leadKey}: unknown metrics ${unknown.join(',')} — the vocabulary is ${SWEEP_METRICS.join(', ')}`,
      );
      continue;
    }
    // Deduplicate BEFORE counting. Two spellings of one metric resolve to one
    // metric, and a lead owning one metric owns nothing — counting first let
    // ["sleepMinutes","sleep_minutes"] through as a two-metric lead.
    const distinct = [...new Set(resolved)];
    if (distinct.length < 2 || distinct.length > 6) {
      // A lead owns the hypotheses inside its metric set; fewer than two
      // metrics owns nothing, and a huge set owns everything, which is the
      // same as owning nothing.
      out.rejected.push(`lead ${leadKey}: needs 2..6 metrics`);
      continue;
    }
    out.leads.push({ leadKey, title, rationale, metrics: distinct });
  }

  // ── Standing action rules — validated downstream by the rules machinery ──
  const rules = Array.isArray(o.actionRules) ? o.actionRules : [];
  for (const raw of rules.slice(0, caps.maxActionRules)) out.actionRules.push(raw);
  if (rules.length > caps.maxActionRules) out.rejected.push('action rule over the per-run cap');

  return out;
}
