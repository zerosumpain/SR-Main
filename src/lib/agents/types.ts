// Persistent Agent Team — named specialist sub-agents JKai can delegate to.
// Definitions live as datastore records (collection `jkai-agents`); a shared
// `team-memory` datastore collection is their common scratchpad (all agents run
// as the `jkai` actor, so they already share its grants — no new actor needed).

export const AGENTS_COLLECTION = 'jkai-agents';
export const TEAM_MEMORY_COLLECTION = 'team-memory';

export interface AgentDef {
  /** Unique slug (kebab-case). Also the datastore record key. */
  name: string;
  /** Short role title, e.g. "Researcher". */
  role: string;
  /** System-prompt persona prepended to the agent's turn. */
  persona: string;
  /** Tool-name whitelist. Empty/omitted = the agent gets the normal full toolset. */
  allowedTools: string[];
  /** Optional model override (OpenRouter slug). Omit = site default chat model. */
  model?: string;
  createdAt: string;
  updatedAt: string;
}

/** Turn a display name into a stable agent slug/key. */
export function agentSlug(name: string): string {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Seeded on first access — a sensible starting team. allowedTools use ESSENTIAL
// tool names (always reachable) so the whitelist works without the meta-tool.
export const DEFAULT_AGENTS: Array<Omit<AgentDef, 'createdAt' | 'updatedAt'>> = [
  {
    name: 'researcher',
    role: 'Researcher',
    persona:
      'You are a meticulous research specialist. Gather evidence before concluding: search across the knowledge stores and catalogued APIs, prefer primary sources, cite what you used, and clearly separate established fact from inference. Record durable findings to the team-memory datastore collection.',
    allowedTools: ['knowledge_search', 'api_search', 'api_call', 'datastore_query', 'datastore_save'],
  },
  {
    name: 'analyst',
    role: 'Analyst',
    persona:
      'You are a data analyst. Turn raw data into clear, quantified conclusions. Pull from the datastore and catalogued APIs, compute concrete numbers, state assumptions, and flag uncertainty. Write structured results back to the team-memory collection for others to use.',
    allowedTools: ['knowledge_search', 'datastore_query', 'datastore_save', 'api_search', 'api_call'],
  },
  {
    name: 'writer',
    role: 'Writer',
    persona:
      'You are a concise writer. Produce clear, well-structured prose grounded in the provided material and the knowledge stores. No filler, no invented facts — if something is unknown, say so. Match the requested tone and length.',
    allowedTools: ['knowledge_search', 'datastore_query'],
  },
  {
    name: 'reviewer',
    role: 'Reviewer',
    persona:
      'You are a critical reviewer. Find what is wrong, missing, or overstated. Check claims against the knowledge stores, list concrete issues ranked by severity, and give a clear verdict. Be specific — quote the exact problem.',
    allowedTools: ['knowledge_search', 'datastore_query'],
  },
];
