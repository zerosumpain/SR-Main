import type { NodeDefinition } from '../types';

/**
 * `delegate-agent` — hand a task to a named specialist from the persistent
 * agent team (/jkai/agents, `jkai-agents` datastore collection). The agent runs
 * a full tool-using turn through the existing `delegateToAgent` primitive
 * (persona + allowedTools + shared team-memory), and the node outputs its final
 * response text. Makes the agent team reachable from workflows, not just chat.
 */
export const delegateAgentDef: NodeDefinition = {
  type: 'delegate-agent',
  label: 'Delegate to agent',
  category: 'agentic',
  description:
    'Delegate a task to a named specialist agent from the persistent team (researcher, analyst, writer, reviewer, or any custom agent). The agent runs a full tool-using turn with its persona and tool whitelist; the node returns its response.',
  configSchema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description:
          'Name (slug) of the team agent to delegate to — e.g. "researcher", "analyst", "writer", "reviewer". Supports {{input.field}} templates.',
      },
      task: {
        type: 'string',
        description:
          'The task to hand the agent. Supports {{input.field}} templates — pipe upstream data in here.',
      },
    },
    required: ['agent', 'task'],
  },
  defaultConfig: { agent: 'researcher', task: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Agent response' }],
  summarize: (config) => {
    const agent = String(config.agent ?? '').trim() || '—';
    const task = String(config.task ?? '').trim();
    const short = task.length > 60 ? `${task.slice(0, 57)}…` : task;
    return {
      line: task ? `Delegate to ${agent}: "${short}"` : `Delegate to ${agent} (set a task first)`,
      preview: { kind: 'other', details: { Agent: agent, Task: short || '—' } },
    };
  },
  basicConfig: [
    {
      key: 'agent',
      label: 'Agent',
      type: 'text',
      placeholder: 'researcher',
      description: 'Team agent name/slug (see /jkai/agents). Supports {{input.field}} templates.',
    },
    {
      key: 'task',
      label: 'Task',
      type: 'template-textarea',
      placeholder: 'Summarise the key findings in {{input.text}} and note anything surprising.',
      description: 'What the agent should do. Supports {{input.field}} templates.',
    },
  ],
  llmDescription:
    'Delegates a task to a named specialist agent from the persistent team (default team: researcher, analyst, writer, reviewer — more may exist). The agent runs a complete tool-using turn with its own persona and tool whitelist, reading/writing the shared team-memory datastore collection. Returns { agent, role, response } where response is the agent\'s final text. Use when a step benefits from a focused specialist (e.g. delegate analysis of scraped data to "analyst", drafting to "writer", critique to "reviewer"). Slower and costlier than llm-call — reserve for steps that need tools or a persona, not simple transforms.',
  llmExamples: [
    { agent: 'researcher', task: 'Find the latest developments on {{input.topic}} and list the 5 most important with sources.' },
    { agent: 'writer', task: 'Turn these findings into a short briefing note: {{input.findings}}' },
    { agent: 'reviewer', task: 'Critically review this draft and list concrete problems: {{input.draft}}' },
  ],
};
