// src/lib/daydream/appetite/intake.ts
//
// The appetite ledger, into self-improvement.
//
// Read by `selfimprove/analyze.ts` — that direction only. `$lib/jkai` already
// imports `$lib/selfimprove`, so an import back the other way would put a new
// `selfimprove <-> daydream` cycle in front of `check-module-boundaries`. The
// wire runs one way: self-improve reads daydream.
//
// The same shape `collectFaultIdeas` has, and read AHEAD of it. A fault is a
// repair; a capability lead is a faculty the site has never had, and the
// owner's standing instruction is that the second outranks the first.

import { bringsNewData, laneFor, type CapabilityKind } from './spec';
import { listCapabilities, setCapabilityStatus } from './store';
import { errMsg } from '../types';
import { investigationRequirements } from '../hypotheses/gaps';

/** The idea shape self-improve's backlog takes. Declared structurally rather
 *  than imported, for the boundary reason above. */
export interface CapabilityIdea {
  title: string;
  detail: string;
  /** Which lane will attempt it. `source` and `watch` are new backlog kinds. */
  kind: 'tool' | 'feature' | 'source' | 'watch';
  priority: number;
  evidence: string;
  /** The ledger row, so the lane can report back what it became. */
  capabilitySlug: string;
  /** True when the lane brings new data in — what reserves the build slots. */
  newData: boolean;
}

/**
 * What each lane needs told to it, in plain words.
 *
 * The author prompt downstream sees only `title` and `detail`, and the shape
 * gates after it are silent (`sampleableTools` wants no required arguments and
 * numeric top-level fields, and says nothing when a tool misses). The same
 * lesson `faults.ts` learned: say the shape in the detail or it is not said.
 */
function shapeSentence(kind: CapabilityKind): string {
  switch (kind) {
    case 'data_source':
      return 'Find and register a real public API or open dataset that serves this, then build a runtime tool with NO required arguments returning a plain object of numbers, so it is sampled daily and becomes a daydream signal.';
    case 'news_source':
      return 'This is a code change: the news source list is a union in $lib/news/types.ts and a feed needs a reader beside the two already there. Open it as a change request against the repo, not as a runtime tool.';
    case 'watch':
      return 'Build this as a recurring monitor: a scheduled workflow that checks the source, keeps only genuinely new items, and notifies when there is something new.';
    case 'tool':
      return 'Build a runtime custom tool for this over data the site already holds.';
    case 'feature':
    default:
      return 'This needs repo code — routes, schema or UI. Open it as a change request so the autonomous builder implements it on a branch, runs the gate, and opens a PR.';
  }
}

const KIND_TO_BACKLOG: Readonly<Record<CapabilityKind, CapabilityIdea['kind']>> = {
  data_source: 'source',
  news_source: 'feature',
  watch: 'watch',
  tool: 'tool',
  feature: 'feature',
};

/**
 * Leads ready for a lane, strongest first.
 *
 * `queued` before `proposed`: an idea the owner has explicitly accepted
 * outranks one the engine merely likes, whatever the scores say. Within each
 * group the ledger's own order (score, then recency) stands.
 */
export async function collectCapabilityIdeas(limit = 6): Promise<CapabilityIdea[]> {
  const rows = await listCapabilities({ statuses: ['queued', 'proposed'], limit: 40 });
  const ordered = [
    ...rows.filter((r) => r.status === 'queued'),
    ...rows.filter((r) => r.status === 'proposed'),
  ];
  const out: CapabilityIdea[] = [];
  for (const r of ordered) {
    if (out.length >= limit) break;
    const requirements = await investigationRequirements(r.cites);
    out.push({
      title: r.title.slice(0, 200),
      detail: `${requirements ? requirements + "\n" : ""}${r.need} ${r.value} ${r.integrationHint ?? ""} ${shapeSentence(r.kind)}`.slice(0, 2000),
      kind: KIND_TO_BACKLOG[r.kind] ?? 'feature',
      // New data leads at 1; everything else at 2, which still puts a
      // capability lead ahead of the question-mined ideas at 2-3 only by
      // arriving first. The ordering in `analyze.ts` is the other half.
      priority: bringsNewData(r.kind) ? 1 : 2,
      evidence: `appetite lead ${r.slug} — scored ${r.score.toFixed(2)} on ${r.cites.length} citation(s)${r.recurrence > 1 ? ` across ${r.recurrence} nights` : ''}${r.status === 'queued' ? ', accepted by the owner' : ''}`,
      capabilitySlug: r.slug,
      newData: bringsNewData(r.kind),
    });
  }
  return out;
}

/**
 * The needs `discoverApis` should search the web for.
 *
 * Only `data_source` leads: a watch needs a workflow and a feature needs code,
 * and asking the catalogue for either wastes the search. Prepended ahead of
 * the fault needs, because a fault's connector is a source that BROKE and a
 * lead's is a source that never existed.
 */
export async function capabilityNeeds(limit = 2): Promise<string[]> {
  try {
    const rows = await listCapabilities({ statuses: ['queued', 'proposed'], kinds: ['data_source'], limit: 8 });
    return rows.slice(0, limit).map((r) => `${r.title} — ${r.need}`);
  } catch (err) {
    console.error('[daydream] capability needs unread:', errMsg(err));
    return [];
  }
}

/**
 * The leads the OWNER accepted, by slug.
 *
 * `queued` alone is not enough — the engine will queue its own leads in a
 * later pass, and "the owner said yes" has to stay distinguishable from "the
 * engine liked it". `decidedBy` carries that, and it is what the costly lanes
 * check before spending anything unattended.
 */
export async function ownerAcceptedCapabilities(): Promise<Set<string>> {
  const rows = await listCapabilities({ statuses: ['queued'], limit: 100 });
  return new Set(rows.filter((r) => r.decidedBy === 'owner').map((r) => r.slug));
}

/** Record what a lane did with a lead. Soft — a lane that shipped something
 *  must not fail because the ledger could not be updated. */
export async function markCapability(
  slug: string,
  status: 'building' | 'shipped' | 'declined',
  outcome: string,
  outcomeRef?: string,
): Promise<void> {
  try {
    await setCapabilityStatus(slug, status, { by: 'engine', outcome, outcomeRef });
  } catch (err) {
    console.error(`[daydream] capability ${slug} not marked ${status}:`, errMsg(err));
  }
}

/** Which lane a capability kind belongs to — re-exported so a caller reading
 *  the ledger does not have to import the vocabulary module as well. */
export { laneFor };
