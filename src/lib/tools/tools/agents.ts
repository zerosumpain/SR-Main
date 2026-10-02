// `agents` toolset — the persistent agent team. List/define named specialists
// and delegate a task to one. Definitions + shared memory live in the datastore
// (see $lib/agents). delegate_to_agent runs a full sub-agent turn, so it can
// take a while.
import { register } from '../registry-internal';
import { listAgents, upsertAgent } from '$lib/agents/store';
import { delegateToAgent } from '$lib/agents/delegate';

register({
  name: 'agent_list',
  description:
    'List the persistent specialist agents on the team (name, role, persona, allowed tools). Call this before delegate_to_agent so you pick a real agent.',
  parameters: { type: 'object', properties: {} },
  category: 'Agents',
  toolset: 'agents',
  handler: async () => {
    try {
      const agents = await listAgents();
      return {
        success: true,
        data: {
          count: agents.length,
          agents: agents.map((a) => ({ name: a.name, role: a.role, persona: a.persona, allowedTools: a.allowedTools, model: a.model })),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'agent_list failed' };
    }
  },
});

register({
  name: 'agent_upsert',
  description:
    'Create or update a specialist agent: its name, role, persona (system prompt), the tool names it may use, and an optional model override. Use to add a new specialist to the team or refine an existing one.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Unique agent name (kebab-cased into a slug).' },
      role: { type: 'string', description: 'Short role title, e.g. "Researcher".' },
      persona: { type: 'string', description: 'System-prompt persona for the agent.' },
      allowedTools: { type: 'array', items: { type: 'string' }, description: 'Tool names the agent may use. Omit/empty = full toolset.' },
      model: { type: 'string', description: 'Optional OpenRouter model slug override.' },
    },
    required: ['name'],
  },
  category: 'Agents',
  toolset: 'agents',
  handler: async (args) => {
    try {
      const agent = await upsertAgent({
        name: String(args.name ?? ''),
        role: typeof args.role === 'string' ? args.role : undefined,
        persona: typeof args.persona === 'string' ? args.persona : undefined,
        allowedTools: Array.isArray(args.allowedTools)
          ? (args.allowedTools as unknown[]).filter((t): t is string => typeof t === 'string')
          : undefined,
        model: typeof args.model === 'string' ? args.model : undefined,
      });
      return { success: true, data: { agent } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'agent_upsert failed' };
    }
  },
});

register({
  name: 'delegate_to_agent',
  description:
    'Hand a task to a named specialist agent (see agent_list). The agent runs its own focused turn with its persona and its allowed tools, sharing findings via team memory, and returns its result. Use for research/analysis/writing/review sub-tasks you want a specialist to own. May take a while.',
  parameters: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Name of the agent to delegate to (from agent_list).' },
      task: { type: 'string', description: 'The task/instruction for the agent.' },
    },
    required: ['agent', 'task'],
  },
  category: 'Agents',
  toolset: 'agents',
  handler: async (args) => {
    const agent = typeof args.agent === 'string' ? args.agent : '';
    const task = typeof args.task === 'string' ? args.task : '';
    if (!agent || !task) return { success: false, error: 'agent and task are required' };
    try {
      const result = await delegateToAgent(agent, task);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'delegation failed' };
    }
  },
});
