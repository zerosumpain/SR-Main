import { tierOf, type ToolConfirm, type ToolEffect, type ToolLane, type ToolTier } from './invoke-contract';

/** The tier fields a tool declaration may carry (`ToolDefinition`). */
type TierDeclaration = { effect?: ToolEffect; confirm?: ToolConfirm; lane?: ToolLane; destructive?: boolean };
type CallTierDeclaration = TierDeclaration & {
  tierForCall?: (args: Record<string, unknown>) => Partial<Pick<ToolTier, 'effect' | 'confirm'>> | null;
};

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
 * tool's `tierForCall` for these arguments. A refinement that throws or
 * answers with an unknown word fails closed to 'always'. What `executeTool`,
 * the scheduler and the reply-code eligibility check hold a call to.
 */
export function callTier(tool: CallTierDeclaration, args: Record<string, unknown> | undefined): ToolTier {
  const base = declaredTier(tool);
  if (!tool.tierForCall) return base;
  let refined: Partial<Pick<ToolTier, 'effect' | 'confirm'>> | null;
  try {
    refined = tool.tierForCall(args ?? {});
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
