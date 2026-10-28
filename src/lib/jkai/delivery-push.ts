/**
 * The push budget for commissioned-build stage pushes (overhaul plan
 * decision 16). PURE.
 *
 * Every new jkai push category gets a cap the owner can see and per-thread
 * coalescing. Development deliveries are the first: the autopilot's "needs
 * you", "pull request needs you", "ready for you" and "shipped" pushes. The
 * cap is stated on the Builds category's description, which is what the
 * phone's notification settings show, so it is never a hidden rule.
 *
 * Over the cap, or inside the coalescing window for the same build, a push is
 * still WRITTEN to the ledger but routed to no channel: the history keeps it,
 * the thread's watcher note still says it, and the phone stays quiet.
 */

/** Delivery pushes that may ring the phone in any 24 hours, across all builds. */
export const JKAI_PUSH_DAILY_CAP = 5;
/** One push per build within this window; later ones in it are coalesced. */
export const DELIVERY_COALESCE_MINUTES = 15;

export type DeliveryPushBudget = 'sent' | 'daily_cap' | 'coalesced';

/** The sentence the Builds category carries, so the cap is visible. */
export const DELIVERY_PUSH_BUDGET_LINE = `Commissioned-build stage pushes: at most ${JKAI_PUSH_DAILY_CAP} a day, one per build per ${DELIVERY_COALESCE_MINUTES} minutes; the rest are noted in the thread.`;

export function deliveryPushDecision(input: {
  /** Delivery pushes that rang the phone in the last 24 hours. */
  sentToday: number;
  /** When this build last rang the phone, or null. */
  lastForBuildAt: Date | null;
  now: Date;
}): DeliveryPushBudget {
  if (input.lastForBuildAt && input.now.getTime() - input.lastForBuildAt.getTime() < DELIVERY_COALESCE_MINUTES * 60_000) return 'coalesced';
  if (input.sentToday >= JKAI_PUSH_DAILY_CAP) return 'daily_cap';
  return 'sent';
}
