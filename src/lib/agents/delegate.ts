// Delegate a task to a named specialist agent. SERVER ONLY (runs the generalChat
// agent loop). The agent turns run as a sub-agent (subagentDepth:1 — no plan/ack
// gates, no nested spawning), restricted to the agent's allowedTools, and speak
// through the agent's persona. Shared findings flow through the team-memory
// datastore collection (all agents are the `jkai` actor).
import { generalChat } from '$lib/workflows/chat/general-chat';
import { resolveDelegationModel } from '$lib/server/models/workload-settings';
import { coerceModelContext } from '$lib/constants/default-models';
import type { JobEvent } from '$lib/workflows/chat/job-store';
import { currentSessionModel, currentSessionThinkingLevel } from '$lib/context/chat';
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

  // Precedence: the agent's OWN pinned model, then the chat session's pin, then
  // the site default.
  //
  // The agent wins because pinning a specialist to a model is a statement about
  // that specialist — a code reviewer put on a coding model should stay there
  // whichever thread calls it. The session comes next, so an unpinned agent
  // dispatched from a pinned thread runs on the thread's model instead of
  // quietly dropping to the site default, which is what it used to do.
  const sessionModel = currentSessionModel();
  const modelContext = agent.model
    ? coerceModelContext({ provider: 'openrouter', modelId: agent.model })
    // Agent's own model, then the session's pin, then the `delegation` workload
    // (which follows the site default until pinned).
    : (sessionModel ?? (await resolveDelegationModel()));

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
      // Only forwarded as a session pin when the agent did not bring its own
      // model — otherwise the agent's tools would resolve to the session's model
      // while the agent itself ran on its own, which is worse than either.
      sessionModel: agent.model ? null : sessionModel,
      thinkingLevel: agent.model ? null : currentSessionThinkingLevel(),
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
