import { tierOf, type ToolConfirm, type ToolEffect, type ToolLane, type ToolTier } from './invoke-contract';

/** The tier fields a tool declaration may carry (`ToolDefinition`). */
type TierDeclaration = { effect?: ToolEffect; confirm?: ToolConfirm; lane?: ToolLane; destructive?: boolean };
type CallTierDeclaration = TierDeclaration & { name?: string };
export type CallTierRefiner = (args: Record<string, unknown>) => Partial<Pick<ToolTier, 'effect' | 'confirm'>> | null;

/**
 * Per-call tier refiners, by tool name. Kept here, in Main, rather than as a
 * field on `ToolDefinition`: `registry-internal.ts` is byte-shared with
 * SR-Jkai-Core and SR-Workflows, and only Main's `executeTool` enforces it.
 */
const refiners = new Map<string, CallTierRefiner>();

/**
 * Raise a tool's tier for some of its calls (e.g. `ha_call_service` on a
 * lock confirms 'always'). It can only RAISE the declared tier (`callTier`
 * ratchets), and `executeTool` holds each call to the refined tier, so an
 * unattended or reply-code caller that lists the tool still cannot reach the
 * dangerous arguments. The refiner must be PURE.
 */
export function registerCallTier(name: string, refine: CallTierRefiner): void {
  refiners.set(name, refine);
}

const EFFECT_RANK: Record<ToolEffect, number> = { read: 0, mutate: 1, destructive: 2 };
const CONFIRM_RANK: Record<ToolConfirm, number> = { never: 0, light: 1, always: 2 };

const UNDECLARED_TIER: ToolTier = { effect: 'destructive', confirm: 'always', lane: 'destructive' };

/**
 * A registered tool's tier, failing closed: a declaration with no `effect` is
 * destructive (it has not said it is safe), and otherwise it is the shared
 * contract's `tierOf`. The contract's own `tierOf` still derives an absent
 * effect from `destructive`, because receivers must read an older Main's
 * catalogue; Main itself never serves an underived row (every row carries
 * this tier). Used by `executeTool`, both catalogue readers and the invoke
 * route.
 */
export function declaredTier(tool: TierDeclaration): ToolTier {
  if (tool.effect === undefined) return { ...UNDECLARED_TIER };
  return tierOf(tool);
}

/**
 * The tier of ONE call: the declared tier, raised (never lowered) by the
 * tool's registered refiner (`registerCallTier`) for these arguments. A refinement that throws or
 * answers with an unknown word fails closed to 'always'. What `executeTool`,
 * the scheduler and the reply-code eligibility check hold a call to.
 */
export function callTier(tool: CallTierDeclaration, args: Record<string, unknown> | undefined): ToolTier {
  const base = declaredTier(tool);
  const refine = tool.name ? refiners.get(tool.name) : undefined;
  if (!refine) return base;
  let refined: Partial<Pick<ToolTier, 'effect' | 'confirm'>> | null;
  try {
    refined = refine(args ?? {});
  } catch {
    return { ...base, confirm: 'always' };
  }
  if (!refined) return base;
  const out = { ...base };
  if (refined.effect !== undefined) {
    if (!(refined.effect in EFFECT_RANK)) return { ...base, confirm: 'always' };
    if (EFFECT_RANK[refined.effect] > EFFECT_RANK[out.effect]) out.effect = refined.effect;
  }
  if (refined.confirm !== undefined) {
    if (!(refined.confirm in CONFIRM_RANK)) return { ...base, confirm: 'always' };
    if (CONFIRM_RANK[refined.confirm] > CONFIRM_RANK[out.confirm]) out.confirm = refined.confirm;
  }
  return out;
}
