import { tierOf, type ToolConfirm, type ToolEffect, type ToolLane, type ToolTier } from './invoke-contract';

/** The tier fields a tool declaration may carry (`ToolDefinition`). */
type TierDeclaration = { effect?: ToolEffect; confirm?: ToolConfirm; lane?: ToolLane; destructive?: boolean };

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
