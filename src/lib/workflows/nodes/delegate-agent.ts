import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';

export { delegateAgentDef } from './delegate-agent.def';

/**
 * `delegate-agent` — run a persistent-team specialist (see /jkai/agents) as a
 * workflow step. Delegates through the same `delegateToAgent` primitive chat
 * uses: persona prepended, tool whitelist enforced, `subagentDepth:1` (so the
 * agent cannot spawn further sub-agents), shared team-memory datastore access.
 * The lazy import keeps the chat stack out of module-init (circular-init
 * hazard — same pattern as api-call's `callCatalogApi` import).
 */
export const delegateAgentExecutor: NodeExecutor = {
  type: 'delegate-agent',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const agent = interpolateTemplate(String(config.agent ?? ''), input).trim();
    const task = interpolateTemplate(String(config.task ?? ''), input).trim();
    if (!agent) throw new Error('delegate-agent: no agent selected — set the team agent name (e.g. "researcher").');
    if (!task) throw new Error('delegate-agent: task is empty — describe what the agent should do.');

    // DRY RUN: never run the agent. Describe what WOULD run.
    if (context.dryRun) {
      return {
        output: { success: true, dryRun: true, agent, task },
        rowCount: 1,
        metadata: { dryRun: true },
      };
    }

    const { delegateToAgent } = await import('$lib/agents/delegate');
    const result = await delegateToAgent(agent, task);

    return {
      output: {
        success: true,
        agent: result.agent,
        role: result.role,
        response: result.response,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for {{input.*}} interpolation in agent / task' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        agent: { type: 'string', description: 'Name of the agent that ran' },
        role: { type: 'string', description: "The agent's role title" },
        response: { type: 'string', description: "The agent's final response text" },
        dryRun: { type: 'boolean', description: 'true only on a dry run (agent not invoked)' },
      },
    };
  },
};
