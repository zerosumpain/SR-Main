/**
 * The list of things that spend money, as one flat vocabulary.
 *
 * Spend arrives in the ledger tagged two different ways and the page has to
 * show them side by side:
 *
 *  - calls made inside a named LLM ROLE carry a workload id
 *    (`$lib/models/workloads`) — extraction, vision, embeddings and the rest.
 *    These are switchable: the same id addresses the model picker's API.
 *  - everything else carries only a `source`, written by
 *    `$lib/llm/usage-capture`: `jkai-chat`, `workflow`, `research`, `gateway`.
 *
 * Two of those four sources NAME a role even though the call carried no tag,
 * and since 2026-09-03 they are mapped onto it (`SOURCE_ROLE` below). A call
 * recorded inside a chat turn IS the chat role; one recorded inside a workflow
 * run IS the canvas-node role. Both of those roles now have a settings key and
 * a switch, so folding the spend onto them makes the row that reports the money
 * the same row that changes it.
 *
 * What is left is genuinely not a role — `research`, which cannot say WHICH
 * tier spent it, and `gateway`, which is the untagged remainder. Those keep a
 * `source:` row of their own, reported and unswitchable, because the honest
 * thing to say about them is that nobody named them yet.
 *
 * Both kinds get a row. Hiding the second kind would leave a line on the bill
 * unexplained; pretending it is switchable would be a button that lies.
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
 * Ledger `source` values that name a role the registry already owns.
 *
 * Not a guess. `usage-capture` writes `jkai-chat` when the call was made inside
 * a chat turn and `workflow` when it was made inside a workflow run, so these
 * two are definitional rather than inferred — the same reason `activityKey`
 * refuses to fold `source:unknown` anywhere, where nothing is known at all.
 *
 * Folding them fixes both halves of the same complaint. The spend joins the row
 * that can switch it, and — because this is applied at read time — every row
 * already in the ledger joins it too, including the months recorded before
 * either role had a name.
 */
const SOURCE_ROLE: Record<string, string> = {
  'jkai-chat': 'chat',
  workflow: 'workflow-node',
};

/**
 * Spend that is not inside a named role, and cannot be moved into one.
 *
 * Two are left. `source:research` knows a research run spent the money but not
 * WHICH tier, and the two tiers have different models and different budgets, so
 * picking one would be inventing the half that matters; current runs carry a
 * real tag (`research-fast` / `research-deep`) and land on their own switchable
 * rows. `source:gateway` is the untagged remainder — by definition a call
 * nobody has named, which is a gap in `withActivity` coverage rather than a
 * role with a model to pick.
 *
 * Neither gets a switch, and both should shrink toward nothing: the fix for a
 * row here is a tag at the call site, not a control on this page.
 */
export const SOURCE_ACTIVITIES: ActivityDef[] = [
  {
    key: 'source:research',
    label: 'Deep research (pre-tagging)',
    blurb:
      'Research spend recorded before the tiers had roles of their own. It cannot say which tier spent it, which is why there is no switch here. Current runs land on "Research — fast tiers" or "Research — Investigation", both switchable.',
    workloadId: null,
  },
  {
    key: 'source:gateway',
    label: 'Untagged site calls',
    blurb:
      'LLM calls through the site gateway that are not inside a named role. There is nothing to switch because nothing has claimed them: they run on whatever their caller resolved, usually the Site default. Anything landing here needs a withActivity() tag at the call site — that is the fix, not a control on this page.',
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
 *
 * The two `SOURCE_ROLE` sources are the exception and not a contradiction of
 * that rule: they are not a guess about which role spent the money, they are
 * the recorded fact of it. See the map's own note.
 */
export function activityKey(activity: string | null, source: string | null): string {
  if (activity) return activity;
  if (source && SOURCE_ROLE[source]) return SOURCE_ROLE[source];
  return `source:${source ?? 'unknown'}`;
}

export function activityLabel(key: string, index = new Map(allActivities().map((a) => [a.key, a]))): string {
  const hit = index.get(key);
  if (hit) return hit.label;
  if (key === 'source:unknown') return 'Unattributed (pre-tagging)';
  return key.startsWith('source:') ? key.slice('source:'.length) : key;
}
