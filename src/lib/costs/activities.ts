/**
 * The list of things that spend money, as one flat vocabulary.
 *
 * Spend arrives in the ledger tagged two different ways and the page has to
 * show them side by side:
 *
 *  - calls made inside a named LLM ROLE carry a workload id
 *    (`$lib/models/workloads`) — extraction, vision, embeddings and the rest.
 *    These are switchable: the same id addresses the model picker's API.
 *  - everything else carries only a `source` — a chat turn, a canvas node, a
 *    deep-research run. These are real spenders with no single model to switch,
 *    because the model is chosen per conversation or per node.
 *
 * Both kinds get a row. Hiding the second kind would leave the biggest line on
 * the bill unexplained; pretending it is switchable from here would be a button
 * that lies.
 *
 * Client-importable (plain data, no `$lib/server`), same rule as the workload
 * registry it reads.
 */
import { WORKLOADS } from '$lib/models/workloads';

export interface ActivityDef {
  /** Ledger key: a workload id, or `source:<name>` for untagged spend. */
  key: string;
  label: string;
  blurb: string;
  /** The workload id to POST when switching, or null when there is nothing on
   *  this row to switch. */
  workloadId: string | null;
}

/**
 * Spend that is not inside a named role. The model for these is chosen
 * elsewhere — per conversation in chat, per node on a canvas — so the row
 * reports and does not offer a switch.
 */
export const SOURCE_ACTIVITIES: ActivityDef[] = [
  {
    key: 'source:jkai-chat',
    label: 'jkai chat turns',
    blurb: 'Hermes chat replies on /jkai, billed per conversation. The model is the one the conversation is pinned to.',
    workloadId: null,
  },
  {
    key: 'source:workflow',
    label: 'Canvas workflow nodes',
    blurb: 'LLM nodes inside canvas workflows. Each node carries its own model in its config.',
    workloadId: null,
  },
  {
    key: 'source:research',
    label: 'Deep research runs',
    blurb: 'Investigation phases and synthesis. Model follows the research depth tier.',
    workloadId: null,
  },
  {
    key: 'source:gateway',
    label: 'Untagged site calls',
    blurb:
      'LLM calls through the site gateway that are not inside a named role. Anything left here after the roles above is worth naming — a role nobody has registered yet.',
    workloadId: null,
  },
];

/** Every activity the page knows how to name, workloads first. */
export function allActivities(): ActivityDef[] {
  return [
    ...WORKLOADS.map((w) => ({
      key: w.id,
      label: w.label,
      blurb: w.blurb,
      workloadId: w.id,
    })),
    ...SOURCE_ACTIVITIES,
  ];
}

/**
 * The ledger key for one row: its workload tag if it has one, else its source.
 *
 * Rows written before activity tagging shipped have neither, and land under
 * `source:unknown` rather than being folded into a role they may not belong to.
 * A cost page that back-dates an attribution is inventing history.
 */
export function activityKey(activity: string | null, source: string | null): string {
  if (activity) return activity;
  return `source:${source ?? 'unknown'}`;
}

export function activityLabel(key: string, index = new Map(allActivities().map((a) => [a.key, a]))): string {
  const hit = index.get(key);
  if (hit) return hit.label;
  if (key === 'source:unknown') return 'Unattributed (pre-tagging)';
  return key.startsWith('source:') ? key.slice('source:'.length) : key;
}
