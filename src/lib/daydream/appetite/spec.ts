// src/lib/daydream/appetite/spec.ts
//
// What a capability lead IS, and what code will accept as one. PURE — no
// database, no clock — because this file is the whole of the audit standing
// between a model's enthusiasm and a row on the ledger.
//
// ── Why an appetite at all ──────────────────────────────────────────────────
//
// Everything the engine builds today is REACTIVE. `daydream_faults` records
// what daydreaming could not do and `collectFaultIdeas` turns each gap into a
// tool; `optimise.ts` lowers the number of tool calls an answer costs. Both are
// improvements to a machine that already exists, and neither can ever ask
// whether the machine should be able to do something it has never attempted.
//
// A fault says "I tried and failed". A capability lead says "nothing here has
// ever tried". They need different vocabularies for the same reason they need
// different writers: the fix for a fault is named by the fault (`wants`),
// whereas a capability lead has to argue for itself — who consumes it, what it
// unlocks, and what evidence says it is wanted.
//
// ── The bias, as a number ───────────────────────────────────────────────────
//
// The owner's instruction (2026-09-04) is a bias toward bringing NEW DATA in,
// over tweaking what is already there. That is expressed here as `DATA_GAIN`
// and nowhere else, so it is one table to read and one table to change — not a
// sentiment distributed across four prompts.

export const CAPABILITY_KINDS = ['data_source', 'news_source', 'watch', 'tool', 'feature'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const CAPABILITY_CONSUMERS = ['jkai', 'daydream', 'site', 'shared'] as const;
export type CapabilityConsumer = (typeof CAPABILITY_CONSUMERS)[number];

/**
 * `proposed` — on the ledger, nothing has acted on it.
 * `queued`   — accepted, and an idea exists in the self-improve backlog.
 * `building` — a lane is working on it (a tool authored, a build dispatched).
 * `shipped`  — it exists: a registered API, a live tool, a monitor, a PR.
 * `declined` — the owner said no, or the engine gave up. Kept, never deleted:
 *              a declined idea re-proposed every night is the failure mode
 *              `improvement_backlog` was written to stop.
 */
export const CAPABILITY_STATUSES = ['proposed', 'queued', 'building', 'shipped', 'declined'] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/**
 * How much NEW DATA each lane brings into the building, 0..1.
 *
 * Not a guess at value — a statement about direction. A data source or a feed
 * puts a series in front of the sweep that did not exist yesterday. A watch
 * brings observations in on a schedule. A site feature usually surfaces or
 * connects something. A tool over data the site already holds brings in the
 * least, which is exactly the class the engine over-produced: 33 tools shipped
 * in the fortnight to 2026-08-30 and not one was ever called.
 */
export const DATA_GAIN: Readonly<Record<CapabilityKind, number>> = {
  data_source: 1,
  news_source: 1,
  watch: 0.9,
  feature: 0.75,
  tool: 0.6,
};

/** The lanes that count as "bringing new data in" for slot reservation. */
export function bringsNewData(kind: CapabilityKind): boolean {
  return DATA_GAIN[kind] >= 0.9;
}

/**
 * Which builder takes this kind.
 *
 * `news_source` maps to the repo lane deliberately: the news source list is a
 * hardcoded union in `$lib/news/types.ts`, so adding a feed is a code change,
 * not a registration. Pretending otherwise would queue work no lane can do.
 */
export function laneFor(kind: CapabilityKind): 'source' | 'watch' | 'tool' | 'feature' {
  switch (kind) {
    case 'data_source':
      return 'source';
    case 'watch':
      return 'watch';
    case 'tool':
      return 'tool';
    case 'news_source':
    case 'feature':
    default:
      return 'feature';
  }
}

/** One line in the evidence pack. `key` is what a proposal may cite. */
export interface PackFact {
  key: string;
  text: string;
}

/** What the model is allowed to return, after coercion. */
export interface CapabilityProposal {
  kind: CapabilityKind;
  title: string;
  need: string;
  value: string;
  consumer: CapabilityConsumer;
  /** Pack keys. Every one is checked; a proposal with none is dropped. */
  cites: string[];
  integrationHint?: string;
}

/** Stable identity for a lead, so the same idea on five nights is one row. */
export function slugForCapability(kind: string, title: string): string {
  const body = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${kind}:${body || 'untitled'}`;
}

export interface ValidationResult {
  admitted: CapabilityProposal[];
  /** Human-readable reasons, one per drop. Reported on the pulse — a quiet
   *  audit is a claim. */
  dropped: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Audit the model's answer.
 *
 * The contract is ponder's: the model may phrase, and code decides whether
 * anything it said is admissible. A proposal must name a kind and a consumer
 * from the closed sets, say what is missing and what it unlocks, and cite at
 * least one fact that was actually in the pack. Everything else is dropped by
 * name.
 */
export function validateProposals(
  raw: unknown,
  packKeys: ReadonlySet<string>,
  opts: { max: number },
): ValidationResult {
  const dropped: string[] = [];
  const admitted: CapabilityProposal[] = [];
  const seen = new Set<string>();

  const list = Array.isArray((raw as { capabilities?: unknown } | null)?.capabilities)
    ? ((raw as { capabilities: unknown[] }).capabilities)
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  if (list.length === 0) return { admitted, dropped: ['no capabilities array in the answer'] };

  for (const item of list) {
    if (admitted.length >= opts.max) break;
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const title = str(o.title).slice(0, 200);
    const kind = str(o.kind) as CapabilityKind;
    const consumer = str(o.consumer) as CapabilityConsumer;
    const need = str(o.need).slice(0, 800);
    const value = str(o.value).slice(0, 800);

    if (!title) {
      dropped.push('a proposal with no title');
      continue;
    }
    if (!(CAPABILITY_KINDS as readonly string[]).includes(kind)) {
      dropped.push(`${title}: unknown kind "${str(o.kind) || '(missing)'}"`);
      continue;
    }
    if (!(CAPABILITY_CONSUMERS as readonly string[]).includes(consumer)) {
      dropped.push(`${title}: unknown consumer "${str(o.consumer) || '(missing)'}"`);
      continue;
    }
    if (!need || !value) {
      dropped.push(`${title}: no ${!need ? 'need' : 'value'} stated`);
      continue;
    }

    const citesRaw = Array.isArray(o.cites) ? o.cites.map((c) => str(c)) : [];
    const cites = [...new Set(citesRaw.filter((c) => packKeys.has(c)))].slice(0, 6);
    if (cites.length === 0) {
      // The fabrication meter. A capability nothing in the pack supports is an
      // idea the model had about the world, not about this site.
      dropped.push(`${title}: cites nothing in the pack (${citesRaw.slice(0, 3).join(', ') || 'no citations'})`);
      continue;
    }

    const slug = slugForCapability(kind, title);
    if (seen.has(slug)) {
      dropped.push(`${title}: duplicate of an earlier proposal in the same answer`);
      continue;
    }
    seen.add(slug);

    admitted.push({
      kind,
      title,
      need,
      value,
      consumer,
      cites,
      integrationHint: str(o.integrationHint).slice(0, 600) || undefined,
    });
  }

  return { admitted, dropped };
}

export interface CapabilityScore {
  score: number;
  /** Every input, named. Never show an unexplained number. */
  components: Record<string, number>;
}

/**
 * Score a lead 0..1.
 *
 * Deliberately shallow arithmetic over named inputs rather than a model's own
 * confidence: a proposer asked to rate its own idea rates all of them highly,
 * and the ledger then cannot rank. The three things that are actually known
 * are how much of the pack supports it, which lane it is in, and whether the
 * engine has arrived at it before.
 *
 * The floor is 0.25 rather than something comfortable so the range actually
 * discriminates: with a base of 0.4 every admissible proposal cleared the
 * bridge bar and the bar meant nothing. As set, a tool with a single citation
 * scores 0.478 and stays on the ledger; a data source with the same single
 * citation scores 0.55 and reaches the briefing. That asymmetry IS the bias.
 */
const BASE = 0.25;

export function scoreCapability(input: {
  kind: CapabilityKind;
  cites: number;
  /** How many nights this lead has been proposed, including tonight. */
  recurrence: number;
}): CapabilityScore {
  const evidence = 0.12 * Math.min(3, Math.max(0, input.cites));
  const dataGain = 0.18 * (DATA_GAIN[input.kind] ?? 0.5);
  const persistence = 0.06 * Math.min(3, Math.max(0, input.recurrence - 1));
  const score = Math.max(0, Math.min(1, BASE + evidence + dataGain + persistence));
  return {
    score: Math.round(score * 1000) / 1000,
    components: {
      base: BASE,
      evidence: Math.round(evidence * 1000) / 1000,
      dataGain: Math.round(dataGain * 1000) / 1000,
      persistence: Math.round(persistence * 1000) / 1000,
    },
  };
}

/**
 * Below this a lead stays on the ledger and never becomes a thought.
 *
 * The bridge is a filter, not a pump — the same bar `intel-bridge.ts` sets for
 * graph findings, and for the same reason: the ledger is where ideas live, the
 * briefing is where attention is spent.
 */
export const MIN_BRIDGE_SCORE = 0.55;
