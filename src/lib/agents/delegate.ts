// Delegate a task to a named specialist agent. SERVER ONLY (runs the generalChat
// agent loop). The agent turns run as a sub-agent (subagentDepth:1 — no plan/ack
// gates, no nested spawning), restricted to the agent's allowedTools, and speak
// through the agent's persona. Shared findings flow through the team-memory
// datastore collection (all agents are the `jkai` actor).
import { generalChat } from '$lib/workflows/chat/general-chat';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { coerceModelContext } from '$lib/constants/default-models';
import type { JobEvent } from '$lib/workflows/chat/job-store';
import { getAgent } from './store';
import { TEAM_MEMORY_COLLECTION } from './types';

// Always allow the meta-tool escape hatch so a restricted agent can still reach
// a needed toolset via jkai_extended, and can activate one on demand.
const META_TOOLS = ['jkai_extended', 'activate_toolset'];

export interface DelegationResult {
  agent: string;
  role: string;
  response: string;
}

export async function delegateToAgent(
  agentName: string,
  task: string,
  onEvent?: (e: JobEvent) => void,
): Promise<DelegationResult> {
  const trimmed = (task ?? '').trim();
  if (!trimmed) throw new Error('task is required');

  const agent = await getAgent(agentName);
  if (!agent) throw new Error(`No agent named "${agentName}". Use agent_list to see the team.`);

  const modelContext = agent.model
    ? coerceModelContext({ provider: 'openrouter', modelId: agent.model })
    : await resolveDefaultModel('chat');

  const whitelist = agent.allowedTools?.length
    ? [...new Set([...agent.allowedTools, ...META_TOOLS])]
    : undefined;

  const persona =
    `${agent.persona}\n\n` +
    `Shared team memory lives in the datastore collection "${TEAM_MEMORY_COLLECTION}": read it for prior team findings ` +
    `(datastore_query) and write durable results back (datastore_save) so other agents can build on your work.`;

  const { response } = await generalChat(
    { text: trimmed },
    [],
    {
      modelContext,
      priceSnapshot: null,
      subagentDepth: 1,
      toolWhitelist: whitelist,
      personaPrompt: persona,
      useIntelContext: false,
      onStreamEvent: onEvent,
    },
  );

  return { agent: agent.name, role: agent.role, response };
}
