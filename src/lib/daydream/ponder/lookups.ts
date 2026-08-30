// src/lib/daydream/ponder/lookups.ts
//
// The pack's reach into the rest of the site.
//
// ── What this is, and what it deliberately is not ───────────────────────────
//
// The brief was "full access to all of the site functions". This is the read
// half of that, and it is CODE-DRIVEN: a probe declares a predicate over what
// has already been assembled, code decides which probes have something to ask,
// code calls the tool, and code turns the answer into fact cards. The model
// never chooses a tool and never sees a raw tool result.
//
// That is not timidity, it is what keeps the existing guarantee true.
// `compose.ts` states it plainly — the model "has no tools and no database
// access of its own, so it cannot widen its own context, and a claim about
// anything absent from this block is by construction invented". Cite-or-die in
// `schema.ts` is enforceable precisely because every card was built by code
// from a known row. Hand the model a tool loop and that becomes a runtime
// audit over text of unknown provenance instead of a structural property.
//
// ── Two rules about which tools may appear here ─────────────────────────────
//
// 1. **A POSITIVE ALLOW-LIST, never "anything not flagged destructive".** The
//    `destructive` flag marks 21 of 188 tools and it is not a read/write
//    split: `ha_call_service`, `workflow_run`, `build_create`, `blog_create`,
//    `datastore_save`, `save_memory` and `schedule_*` all write and none of
//    them are flagged. `executeTool` applies no gate of its own on headless
//    paths either — the destructive confirmer lives in `mcp/jsonrpc.ts` and
//    nothing here goes through it. So the list below is the gate.
//
// 2. **NOTHING THAT RETURNS TEXT SOMEBODY ELSE WROTE.** No `fetch_url`, no
//    `research_web_search`, no `mail_read`. A lookup result becomes prompt
//    context, so a probe that reads an attacker-controlled page is a prompt
//    injection with a card id attached. Every probe here reads first-party
//    derived state: the knowledge graph the ingest built, and the owner's own
//    memories. Adding a probe over external content is a security decision,
//    not a new row in the table.

import { executeTool } from '$lib/workflows/site-tools/registry';
import type { DaydreamSnapshot } from '../snapshot-types';
import { errMsg } from '../types';

/** Tool calls one ponder cycle may make. The pack is ~90 cards and a lookup
 *  costs a round trip; this is context budget, not a safety limit. */
export const MAX_LOOKUPS_PER_CYCLE = 6;

/** Per-probe ceiling, so one noisy gap cannot spend the whole budget. */
const MAX_GAPS_PER_PROBE = 3;

/** Cards one probe result may contribute. */
const MAX_CARDS_PER_GAP = 3;

export interface LookupContext {
  snapshot: DaydreamSnapshot;
  weekAhead: Array<{ title: string; whenText: string; location: string | null }>;
}

/** One thing code noticed was missing, and the question that would fill it. */
export interface LookupGap {
  /** Stable within a cycle; used for logging, not for citation. */
  id: string;
  args: Record<string, unknown>;
  /** Why this was asked — reported on the pulse so a wasted probe is visible. */
  reason: string;
}

/** A card a lookup produced. `ref` uses an EXISTING evidence kind so the
 *  ledger's drill-through resolves it with no new resolver. */
export interface LookupCard {
  ref: { kind: string; id: string };
  text: string;
}

interface Probe {
  key: string;
  /** Must be a read-only, first-party tool. See rule 2 above. */
  tool: string;
  find(ctx: LookupContext): LookupGap[];
  render(gap: LookupGap, data: unknown): LookupCard[];
}

// ── Term extraction ─────────────────────────────────────────────────────────

/** Words too common to be worth a graph lookup. Deliberately short: this is a
 *  stop-list for diary titles, not a language model. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'his', 'her',
  'appointment', 'meeting', 'call', 'reminder', 'birthday', 'renewal', 'delivery',
  'payment', 'invoice', 'booking', 'order', 'due', 'day', 'week', 'month',
  'morning', 'afternoon', 'evening', 'today', 'tomorrow', 'am', 'pm',
]);

/**
 * Proper-noun-ish terms from a title.
 *
 * Capitalised runs, because a diary title is written by a person and the names
 * in it are capitalised. Lowercased for comparison but returned in their
 * original case — the graph matches case-insensitively and the card reads
 * better with the name as written.
 */
export function namedTerms(title: string): string[] {
  const all: string[] = [];
  for (const m of title.matchAll(/\b([A-Z][A-Za-z'&-]{2,})(?:\s+([A-Z][A-Za-z'&-]{2,}))?/g)) {
    const term = [m[1], m[2]].filter(Boolean).join(' ');
    if (term.split(/\s+/).every((w) => STOP.has(w.toLowerCase()))) continue;
    all.push(term);
  }
  const unique = [...new Set(all)];

  // Prefer multi-word terms, and fall back to single words only when a title
  // has none. Any capitalised word matches the pattern, so "Checkup at
  // Riverside Dental" yields both, and "Checkup" is not a thing to look up —
  // whereas "Vodafone bill" has no two-word candidate and "Vodafone" is
  // exactly the thing to look up. Growing STOP instead would be whack-a-mole
  // against every noun a diary entry can start with.
  //
  // The cost of being wrong is one lookup that returns nothing, which
  // `LookupRun.empty` counts — so a probe that keeps missing is visible rather
  // than silently expensive.
  const multi = unique.filter((t) => t.includes(' '));
  return multi.length > 0 ? multi : unique;
}

// ── The probes ──────────────────────────────────────────────────────────────

/**
 * Who or what is this?
 *
 * The pack lists diary titles and dated email facts as bare strings. The intel
 * graph holds ~13.9k entities built from the same mailbox, and nothing in the
 * ponder path had ever asked it about a name the week ahead contains — the
 * bridge runs the other way, turning graph insights into thoughts.
 */
const whoIsThis: Probe = {
  key: 'intel-who',
  tool: 'intel_find',
  find(ctx) {
    const titles = [
      ...ctx.weekAhead.map((e) => e.title),
      ...ctx.snapshot.emailFacts.upcoming.map((f) => f.title),
    ];
    // Anything the pack already names is not a gap.
    const known = new Set(
      [
        ...ctx.snapshot.places.map((p) => p.label ?? ''),
        ...ctx.snapshot.memories.map((m) => m.content),
      ]
        .join(' ')
        .toLowerCase()
        .split(/[^a-z']+/)
        .filter(Boolean),
    );
    const terms: string[] = [];
    for (const t of titles) {
      for (const term of namedTerms(t)) {
        const head = term.split(/\s+/)[0].toLowerCase();
        if (known.has(head)) continue;
        if (!terms.includes(term)) terms.push(term);
      }
    }
    return terms.slice(0, MAX_GAPS_PER_PROBE).map((term) => ({
      id: `intel:${term.toLowerCase()}`,
      args: { query: term, limit: 3 },
      reason: `"${term}" appears in the week ahead and nothing in the pack says who or what it is`,
    }));
  },
  render(gap, data) {
    const entities = (data as { entities?: unknown } | null)?.entities;
    if (!Array.isArray(entities)) return [];
    const out: LookupCard[] = [];
    for (const e of entities.slice(0, MAX_CARDS_PER_GAP)) {
      const r = e as { id?: unknown; name?: unknown; type?: unknown; degree?: unknown };
      if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
      const type = typeof r.type === 'string' && r.type ? r.type : 'entity';
      const seen = typeof r.degree === 'number' ? `, ${r.degree} connection(s)` : '';
      out.push({
        ref: { kind: 'intel-entity', id: r.id },
        text: `Known ${type}: ${r.name}${seen} — matched from the week ahead.`,
      });
    }
    return out;
  },
};

/**
 * The memories that bear on TODAY, rather than the sixteen most recent.
 *
 * `assemblePack` takes `s.memories.slice(0, PACK_LIMITS.memories)` and the
 * snapshot orders them by recency, so a memory written months ago about the
 * merchant on this week's invoice can never reach the pack while sixteen newer
 * and unrelated ones can. This asks for the ones that match what is actually
 * happening.
 */
const memoriesThatBearOnToday: Probe = {
  key: 'memory-relevance',
  tool: 'memory_search',
  find(ctx) {
    const terms: string[] = [];
    for (const t of [
      ...ctx.weekAhead.map((e) => e.title),
      ...ctx.snapshot.emailFacts.upcoming.map((f) => f.title),
    ]) {
      for (const term of namedTerms(t)) if (!terms.includes(term)) terms.push(term);
    }
    // Merchants are already proper nouns and need no extraction.
    for (const s of ctx.snapshot.spend.recent) {
      const m = s.merchant?.trim();
      if (m && !terms.includes(m)) terms.push(m);
    }
    return terms.slice(0, MAX_GAPS_PER_PROBE).map((term) => ({
      id: `memory:${term.toLowerCase()}`,
      args: { query: term, limit: 3 },
      reason: `"${term}" is in play this week; the pack's memories are the newest sixteen, not the relevant ones`,
    }));
  },
  render(gap, data) {
    const memories = (data as { memories?: unknown } | null)?.memories;
    if (!Array.isArray(memories)) return [];
    const out: LookupCard[] = [];
    for (const m of memories.slice(0, MAX_CARDS_PER_GAP)) {
      const r = m as { id?: unknown; category?: unknown; content?: unknown };
      if (typeof r.id !== 'string' || typeof r.content !== 'string') continue;
      const cat = typeof r.category === 'string' && r.category ? r.category : 'note';
      out.push({
        ref: { kind: 'memory', id: r.id },
        text: `Known (${cat}): ${r.content}`,
      });
    }
    return out;
  },
};

/** The allow-list. Adding a row is a decision about what may enter the prompt
 *  — read rule 2 at the top of this file before adding one. */
export const READ_PROBES: readonly Probe[] = [whoIsThis, memoriesThatBearOnToday];

export interface LookupRun {
  cards: LookupCard[];
  /** One line per probe actually made, for the pulse. */
  asked: string[];
  /** Gaps that produced nothing — a probe that never pays is worth deleting. */
  empty: number;
  failed: number;
}

/**
 * Fill what code can see is missing.
 *
 * Never throws and never lets one failing tool cost the cycle: a ponder run
 * without lookups is the run we already had, and a run that dies because the
 * intel graph was rebuilding is a regression.
 */
export async function runLookups(
  ctx: LookupContext,
  opts: { budget?: number } = {},
): Promise<LookupRun> {
  const budget = Math.max(0, opts.budget ?? MAX_LOOKUPS_PER_CYCLE);
  const run: LookupRun = { cards: [], asked: [], empty: 0, failed: 0 };
  if (budget === 0) return run;

  // Interleave probes rather than draining the first one's gaps: two probes
  // with three gaps each and a budget of four should not mean the second probe
  // never runs.
  const queued = READ_PROBES.map((probe) => ({ probe, gaps: safeFind(probe, ctx) }));
  const seenRefs = new Set<string>();

  for (let round = 0; run.asked.length < budget; round++) {
    const thisRound = queued.filter((q) => q.gaps.length > round);
    if (thisRound.length === 0) break;
    for (const { probe, gaps } of thisRound) {
      if (run.asked.length >= budget) break;
      const gap = gaps[round];
      let cards: LookupCard[] = [];
      try {
        const res = await executeTool(probe.tool, gap.args);
        if (!res?.success) {
          run.failed++;
          console.warn(`[daydream] lookup ${probe.key} failed: ${res?.error ?? 'no result'}`);
          continue;
        }
        cards = probe.render(gap, res.data);
      } catch (err) {
        run.failed++;
        console.warn(`[daydream] lookup ${probe.key} threw: ${errMsg(err)}`);
        continue;
      } finally {
        run.asked.push(`${probe.key}: ${gap.reason}`);
      }
      const fresh = cards.filter((c) => {
        const key = `${c.ref.kind}:${c.ref.id}`;
        if (seenRefs.has(key)) return false;
        seenRefs.add(key);
        return true;
      });
      if (fresh.length === 0) run.empty++;
      run.cards.push(...fresh);
    }
  }
  return run;
}

function safeFind(probe: Probe, ctx: LookupContext): LookupGap[] {
  try {
    return probe.find(ctx).slice(0, MAX_GAPS_PER_PROBE);
  } catch (err) {
    console.warn(`[daydream] lookup ${probe.key} could not plan: ${errMsg(err)}`);
    return [];
  }
}
