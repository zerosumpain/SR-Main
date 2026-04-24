import { createJob, publishJobEvent, subscribeJob } from './job-store';
import type { JobEvent } from './job-store';
import type { ModelContext } from '$lib/server/models/types';

export interface AgentSpawnArgs {
  task: string;
  tools?: string[];
}

/**
 * OpenAI-function schema for the agent_spawn tool. Registered as a
 * standard site-tool-adjacent tool via the general-chat dispatch chain.
 */
export const AGENT_SPAWN_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'agent_spawn',
    description:
      'Dispatch an independent sub-agent for isolated research or parallel work. The sub-agent runs with its own conversation context and returns a summary + final text. Use for well-scoped read-only tasks (fact-finding, multi-source research, drafting) that do not need the full parent context. Cannot currently be nested (sub-agents cannot spawn further sub-agents).',
    parameters: {
      type: 'object',
      required: ['task'],
      properties: {
        task: {
          type: 'string',
          description: 'Self-contained task description. Write as if briefing a fresh colleague — include everything needed to complete the task.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional whitelist of tool names the sub-agent may call. Defaults to a safe read-only subset.',
        },
      },
      additionalProperties: false,
    },
  },
};

/** Fallback whitelist when the caller does not specify tools. */
export const DEFAULT_SUBAGENT_TOOLS = ['web_search', 'webpage_fetch', 'intel_search', 'gmail_search'];

/**
 * Run a sub-agent. Creates a child job, forwards its events to the parent
 * as `subagent_event` envelopes, emits `subagent_start` / `subagent_done`
 * on the parent, and returns the sub-agent's textual response.
 *
 * Depth is capped at 1 — sub-agents dispatching further sub-agents is
 * rejected to prevent runaway fan-out.
 */
export async function runSubAgent(
  parentJobId: string,
  args: AgentSpawnArgs,
  modelContext: ModelContext,
): Promise<{ agentId: string; summary: string; result: { text: string } }> {
  const agentId = crypto.randomUUID();
  const task = (args.task ?? '').trim();
  if (!task) {
    throw new Error('agent_spawn requires a non-empty task');
  }

  const { jobId: childJobId } = createJob(task, {});

  publishJobEvent(parentJobId, {
    type: 'subagent_start',
    agentId,
    parentStepId: null,
    task,
  });

  // Forward every child event upward, wrapped in subagent_event, EXCEPT
  // the terminal ones — we surface those as subagent_done via the caller.
  const unsubscribe = subscribeJob(childJobId, (event) => {
    if (event.type === 'done' || event.type === 'error') return;
    publishJobEvent(parentJobId, { type: 'subagent_event', agentId, event });
  });

  try {
    // Dynamic import breaks a circular dependency: general-chat imports
    // sub-agent via the tool dispatch, and sub-agent calls back into
    // generalChat here.
    const { generalChat } = await import('./general-chat');

    const { response } = await generalChat(
      { text: task, attachments: [] },
      [],                         // fresh history
      {
        workflowId: null,
        conversationId: null,
        jobId: childJobId,        // give the child its own scope for events
        onStreamEvent: (e: JobEvent) => publishJobEvent(childJobId, e),
        modelContext,
        priceSnapshot: null,
        useIntelContext: false,
        subagentDepth: 1,         // mark this call as a sub-agent
        toolWhitelist: args.tools ?? DEFAULT_SUBAGENT_TOOLS,
      } as any,                   // cast — ChatOptions extension is internal
    );

    const summary = response.slice(0, 200);
    publishJobEvent(parentJobId, {
      type: 'subagent_done',
      agentId,
      summary,
      result: { text: response },
    });
    // Child's own terminal — keeps its buffered replay clean for any late subscriber.
    publishJobEvent(childJobId, { type: 'done', result: { text: response } });
    return { agentId, summary, result: { text: response } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    publishJobEvent(parentJobId, {
      type: 'subagent_done',
      agentId,
      summary: `Failed: ${message}`,
      result: { error: message },
    });
    publishJobEvent(childJobId, { type: 'error', message });
    throw err;
  } finally {
    unsubscribe();
  }
}
