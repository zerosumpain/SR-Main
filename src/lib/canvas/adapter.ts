import type { NodeHandles } from './handles';
import { nodeDefinitions } from '$lib/workflows/registry-client';
import { isDisplayOnlyType, type NodeDefinition } from '$lib/workflows/types';
import type { WorkflowNotifications } from '$lib/db/schema';

export type NodeKind =
  | 'input'
  | 'llm'
  | 'parse'
  | 'output'
  | 'intel'
  | 'agent'
  | 'chat'
  | 'trigger'
  | 'inspector'
  | 'stats'
  | 'intelligence'
  | 'webpage'
  | 'builder'
  | 'research-chat'
  | 'research-report'
  | 'postit'
  | 'annotation';
export type NodeStatus = 'idle' | 'running' | 'ok' | 'failed';

export type CanvasNode = {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  type: string; // workflow node type (e.g., "llm-call")
  config: Record<string, unknown>;
  status?: NodeStatus;
  inputData?: unknown;
  outputData?: unknown;
  error?: string | null;
  durationMs?: number | null;
  /** Optimistic-concurrency version (from workflow_nodes.version). */
  version?: number;
};

export type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  active?: boolean;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  runId?: string | null;
  nodeId?: string | null;
};

export type Canvas = {
  slug: string;
  title: string;
  workflowId: string;
  latestRunId: string | null;
  runStatus: string | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  messagesByChat: Record<string, ChatMessage[]>;
  /** D1 — per-workflow run-outcome notification prefs; null when never set. */
  notifications: WorkflowNotifications | null;
};

export type NodeTypeOption = {
  type: string;
  label: string;
  kind: NodeKind;
  group: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  handles: NodeHandles;
  defaultWeight?: number;
  /**
   * Desk-only node types: live interactive nodes the Research Desk renders, but
   * which have NO workflow executor and no live renderer on the workflow canvas.
   * They are kept in the shared registry (the desk looks them up via byType +
   * scopes its own palette to them via restrictTypes), but are excluded from the
   * workflow-canvas "+ node" picker so the builder doesn't offer research nodes
   * that can't actually run in a workflow.
   */
  deskOnly?: boolean;
};

export const CANVAS_NODE_GROUPS = [
  'Trigger & Flow',
  'LLM & AI',
  'Parse & Transform',
  'Intelligence',
  'Intel & Web',
  'Integrations',
  'Builder',
  'Observability',
  'Annotations',
] as const;

/** Curated set of workflow node types offered in the canvas "+ node" picker. */
export const CANVAS_NODE_TYPES: readonly NodeTypeOption[] = Object.freeze([
  // ————————————————————————— Trigger & Flow
  {
    type: 'trigger',
    label: 'Trigger',
    kind: 'trigger',
    group: 'Trigger & Flow',
    description: 'Entry point — manual, cron, webhook, or event. One per canvas.',
    defaultConfig: { kind: 'manual' },
    handles: {
      inputs: [],
      outputs: [{ id: 'signal', kinds: ['trigger-signal'] }],
    },
  },
  {
    type: 'chat',
    label: 'Chat',
    kind: 'chat',
    group: 'Trigger & Flow',
    description: 'Chat panel. Standalone = full jkai; wired = workflow trigger.',
    defaultConfig: { model: '', useIntelContext: true },
    handles: {
      inputs: [{ id: 'trigger', kinds: ['trigger-signal', 'text'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'conditional',
    label: 'Conditional',
    kind: 'parse',
    group: 'Trigger & Flow',
    description: 'Route to one of two downstream handles based on a JS expression.',
    defaultConfig: { condition: 'input.ok' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json', 'any'] }],
    },
  },
  {
    type: 'loop',
    label: 'Map array',
    kind: 'output',
    group: 'Trigger & Flow',
    description:
      'Transform each item of an array and collect the results ({ results, count }). Runs as ONE step — this is not a control-flow loop, so downstream nodes run once with the results, not per item.',
    defaultConfig: { arrayPath: 'items', expression: 'return item', concurrency: 1 },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'delay',
    label: 'Delay',
    kind: 'output',
    group: 'Trigger & Flow',
    description: 'Pause N milliseconds before continuing.',
    defaultConfig: { ms: 1000 },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'error-handler',
    label: 'Error handler',
    kind: 'output',
    group: 'Trigger & Flow',
    description: 'Catch downstream failures and route to a recovery branch.',
    defaultConfig: {},
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'interactive-step',
    label: 'Interactive Step',
    kind: 'agent',
    group: 'Trigger & Flow',
    description: 'Pauses the workflow for a human to solve a CAPTCHA, log in, or confirm data. Resumes after the human completes it from the canvas.',
    defaultConfig: {
      mode: 'vnc',
      profile: '',
      url: '',
      prompt: 'Please complete the required action',
      fields: [],
      timeoutMinutes: 60,
    },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'sub-workflow',
    label: 'Sub-workflow',
    kind: 'output',
    group: 'Trigger & Flow',
    description: 'Call another canvas as a reusable block.',
    defaultConfig: { workflowId: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },

  // ————————————————————————— LLM & AI
  {
    type: 'llm-call',
    label: 'LLM call',
    kind: 'llm',
    group: 'LLM & AI',
    description: 'Single LLM call with a prompt template.',
    defaultConfig: {
      model: '',
      userPrompt: '{{input.message}}',
      temperature: 0.7,
      maxTokens: 1024,
    },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'llm-agent',
    label: 'LLM agent (tool-calling)',
    kind: 'agent',
    group: 'LLM & AI',
    description: 'Agent loop. Downstream nodes are discovered as tools the model can call.',
    defaultConfig: {
      model: '',
      systemPrompt: '',
      userPrompt: '{{input.message}}',
      maxIterations: 10,
    },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'delegate-agent',
    label: 'Delegate to agent',
    kind: 'agent',
    group: 'LLM & AI',
    description:
      'Hand a task to a named specialist from the persistent agent team (researcher, analyst, writer, reviewer, …). The agent runs a full tool-using turn with its persona and tool whitelist.',
    defaultConfig: { agent: 'researcher', task: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json', 'text'] }],
    },
  },
  {
    type: 'llm-router',
    label: 'LLM router',
    kind: 'llm',
    group: 'LLM & AI',
    description: 'LLM classifies input and routes to a named downstream handle.',
    defaultConfig: { model: '', prompt: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'think',
    label: 'Think',
    kind: 'llm',
    group: 'LLM & AI',
    description: 'Hidden reasoning step — LLM plans but does not emit the reasoning.',
    defaultConfig: { model: '', prompt: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'openrouter',
    label: 'OpenRouter',
    kind: 'llm',
    group: 'LLM & AI',
    description: 'Direct OpenRouter completion (explicit model id).',
    defaultConfig: { model: 'openai/gpt-4o-mini' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },

  // ————————————————————————— Parse & Transform
  {
    type: 'text-parser',
    label: 'Text parser (JSON / regex)',
    kind: 'parse',
    group: 'Parse & Transform',
    description: 'Extract JSON or regex matches from an upstream string.',
    defaultConfig: { mode: 'json', inputField: 'response' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },
  {
    type: 'validator',
    label: 'Validator (schema)',
    kind: 'parse',
    group: 'Parse & Transform',
    description: 'Check input against a JSON schema. Pass or fail downstream.',
    defaultConfig: { schema: {} },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },
  {
    type: 'transform',
    label: 'Transform (JS)',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Identity pass-through, or apply a JS expression to reshape data.',
    defaultConfig: {},
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },
  {
    type: 'code-execute',
    label: 'Code execute',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Run arbitrary JS in a sandbox; input/output passed through `input`/`return`.',
    defaultConfig: { code: 'return { ...input };' },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'merge',
    label: 'Merge',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Combine multiple upstream outputs into one object.',
    defaultConfig: {},
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'accumulator',
    label: 'Accumulator',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Append each run\'s data into a persistent list across runs.',
    defaultConfig: { key: 'items' },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'dedupe',
    label: 'Dedupe',
    kind: 'parse',
    group: 'Parse & Transform',
    description:
      'Filter a list against a persistent seen-set so only genuinely new items continue. Put between a fetch/search node and the summarise/send nodes so recurring workflows never re-send the same item.',
    defaultConfig: {
      itemsPath: '',
      idPath: '',
      storeKey: 'seen_ids',
      maxRemembered: 500,
      recordMode: 'immediate',
    },
    handles: {
      inputs: [{ id: 'in', kinds: ['json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json', 'any'] }],
    },
  },

  // ————————————————————————— Intelligence
  {
    type: 'intelligence',
    label: 'Intelligence',
    kind: 'intelligence',
    group: 'Intelligence',
    description: 'Filtered view onto the knowledge graph. Queryable. Spawns deep/quick research.',
    defaultConfig: {
      size: { w: 360, h: 440 },
      query: '',
      facets: { entityTypes: [], tags: [], timeRange: null, limit: 20, ordering: 'relevant' },
    },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['intel-session', 'text'] }],
    },
  },
  {
    type: 'research-result',
    label: 'Research Result',
    kind: 'intelligence',
    group: 'Intelligence',
    description:
      'Deep or quick research output. Slowly pulses while running; populates when complete.',
    defaultConfig: { size: { w: 460, h: 520 }, engine: 'deep', sessionId: '', topic: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'intel-session'] }],
      outputs: [{ id: 'result', kinds: ['research-result', 'text'] }],
    },
    defaultWeight: 0.2,
  },
  {
    type: 'quick-answer',
    label: 'Quick Answer',
    kind: 'intel',
    group: 'Intelligence',
    description: 'DAG-driven quick answer (Tavily + synthesis). Useful for per-item fan-out.',
    defaultConfig: { topic: '{{item.title}}', goals: [], pollIntervalMs: 1500, maxWaitMs: 180000 },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'deep-research',
    label: 'Deep Research',
    kind: 'intel',
    group: 'Intelligence',
    description: 'DAG-driven deep research (commission via pipeline). Emits researchReport + sources.',
    defaultConfig: { topic: '{{item.title}}', goals: '', depth: 'medium', pollIntervalMs: 5000, maxWaitMs: 900000 },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['research-result', 'text'] }],
    },
    defaultWeight: 0.2,
  },
  {
    type: 'research-chat',
    label: 'Research Chat',
    kind: 'research-chat',
    group: 'Intelligence',
    description: 'Chat grounded in this research session — answers cite the session\'s facts and sources.',
    defaultConfig: { size: { w: 380, h: 460 } },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'intel-session'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
    deskOnly: true, // live node on the Research Desk; no workflow executor
  },
  {
    type: 'research-report',
    label: 'Research Report',
    kind: 'research-report',
    group: 'Intelligence',
    description: 'Expandable report preview for this session, with regenerate + docx/markdown export.',
    defaultConfig: { size: { w: 420, h: 520 } },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'research-result', 'intel-session'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
    deskOnly: true, // live node on the Research Desk; no workflow executor
  },
  {
    type: 'file-search',
    label: 'File search (RAG)',
    kind: 'intel',
    group: 'Intelligence',
    description: 'Semantic search over the content of /drive files (text, images, audio). Returns ranked passages.',
    defaultConfig: { query: '{{input.query}}', topK: 5, fileTypes: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json', 'text'] }],
    },
    defaultWeight: 0.2,
  },
  {
    type: 'research-search',
    label: 'Research search (RAG)',
    kind: 'intel',
    group: 'Intelligence',
    description: 'Cross-session semantic search over all deep-dive research materials. Returns ranked passages.',
    defaultConfig: { query: '{{input.query}}', topK: 8 },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json', 'text'] }],
    },
    defaultWeight: 0.2,
  },

  // ————————————————————————— Intel & Web
  {
    type: 'intel-query',
    label: 'Intel · query',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Search the knowledge graph; appends matching context to downstream input.',
    defaultConfig: { query: '{{input.message}}' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },
  {
    type: 'intel-write',
    label: 'Intel · write',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Write findings into the knowledge graph.',
    defaultConfig: {},
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'tavily-search',
    label: 'Tavily search',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Web search via Tavily. Returns an array of results.',
    defaultConfig: { query: '{{input.query}}', maxResults: 5 },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },
  {
    type: 'web-scrape',
    label: 'Web scrape',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Fetch a URL and extract its readable text content.',
    defaultConfig: { url: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['url', 'text'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },
  {
    type: 'deep-dive',
    label: 'Deep-dive research',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Multi-hop research session; kicks off, run id returned for polling.',
    defaultConfig: { topic: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['research-result', 'text'] }],
    },
  },
  {
    type: 'webpage',
    label: 'Webpage',
    kind: 'webpage',
    group: 'Intel & Web',
    description: 'Render a live webpage inside the canvas (falls back to a proxy for sites that block framing).',
    defaultConfig: { url: '', mode: null, size: { w: 720, h: 480 } },
    handles: {
      inputs: [{ id: 'src', kinds: ['url', 'research-result', 'text'] }],
      outputs: [
        { id: 'currentUrl', kinds: ['url'] },
        { id: 'selectedText', kinds: ['text'] },
        { id: 'extractedText', kinds: ['text'] },
      ],
    },
    defaultWeight: 0.3,
  },
  {
    type: 'http-request',
    label: 'HTTP request',
    kind: 'input',
    group: 'Intel & Web',
    description: 'Fetch data from an external URL (GET / POST / PUT / DELETE).',
    defaultConfig: { method: 'GET', url: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'url'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },

  // ————————————————————————— Integrations
  {
    type: 'stealth-scrape',
    label: 'Stealth Scrape',
    kind: 'output',
    group: 'Integrations',
    description: 'Scrape a web page (or paginated set) using a stealth headless browser with a persistent profile. Residential IP via homeserv.',
    defaultConfig: { url: '', profile: '', waitFor: { type: 'networkidle' }, extract: [] },
    handles: {
      inputs: [{ id: 'in', kinds: ['url', 'text', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'stealth-scrape-llm',
    label: 'Stealth Scrape (LLM Extract)',
    kind: 'output',
    group: 'Integrations',
    description: 'Extracts structured fields from scraped HTML/text via an LLM. Use when CSS selectors are too brittle.',
    defaultConfig: { sourcePath: '', schema: { type: 'object', properties: {} }, model: '', itemTextPath: '', instructions: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'site-mapper',
    label: 'Site Mapper (LLM)',
    kind: 'output',
    group: 'Integrations',
    description: 'One-shot LLM that generates a reusable scraper playbook (url template + selectors + wait condition) for a new target domain. stealth-scrape then dispatches through the saved playbook automatically on every subsequent run — zero LLM cost on scheduled scrapes.',
    defaultConfig: { seedUrl: '', goal: '', searchQuery: '', profile: 'default', model: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'gmail-trigger',
    label: 'Gmail Trigger',
    kind: 'trigger',
    group: 'Integrations',
    description: 'Fires when a new Gmail message matches a watched query.',
    defaultConfig: { accountId: 0, watchId: null },
    handles: {
      inputs: [],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'whatsapp-trigger',
    label: 'WhatsApp Trigger',
    kind: 'trigger',
    group: 'Integrations',
    description: 'Fires when an inbound WhatsApp message from the owner matches a keyword.',
    defaultConfig: { keyword: '', matchMode: 'prefix', stripKeyword: true },
    handles: {
      inputs: [],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'gmail-fetch',
    label: 'Gmail · Fetch Message',
    kind: 'output',
    group: 'Integrations',
    description: 'Fetch a Gmail message by id, returning full headers + text/html bodies + attachment refs.',
    defaultConfig: { messageId: '{{input.messageId}}', accountId: 0 },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'gmail-send',
    label: 'Gmail · Send Message',
    kind: 'output',
    group: 'Integrations',
    description: 'Compose and send a new Gmail message. Supports template interpolation for recipient, subject, and body.',
    defaultConfig: { accountId: 0, to: '', subject: '', bodyText: '', bodyHtml: '', cc: '', bcc: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'gmail-reply',
    label: 'Gmail · Reply',
    kind: 'output',
    group: 'Integrations',
    description: 'Send a reply to an existing Gmail thread, preserving In-Reply-To and References headers for proper threading.',
    defaultConfig: { accountId: 0, to: '{{input.from}}', threadId: '{{input.threadId}}', inReplyTo: '{{input.rfc822MessageId}}', references: '', subject: '{{input.subject}}', bodyText: '', bodyHtml: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'gmail-label',
    label: 'Gmail · Modify Labels',
    kind: 'output',
    group: 'Integrations',
    description: 'Add or remove Gmail labels on a message. Common uses: archive (remove INBOX), mark read (remove UNREAD), star (add STARRED).',
    defaultConfig: { accountId: 0, messageId: '{{input.messageId}}', add: [], remove: [] },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'gmail-search',
    label: 'Gmail · Search Messages',
    kind: 'output',
    group: 'Integrations',
    description: 'Search Gmail using a query string. Returns matching message ids, and optionally fetches full message content.',
    defaultConfig: { accountId: 0, query: '', maxResults: 50, fetchFullMessages: false },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'whatsapp',
    label: 'WhatsApp · send',
    kind: 'output',
    group: 'Integrations',
    description: 'Send a message, attachment, or voice note to a WhatsApp number.',
    defaultConfig: { to: '', message: '{{input.message}}' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'email',
    label: 'Email · send',
    kind: 'output',
    group: 'Integrations',
    description: 'Send an email via the configured SMTP provider.',
    defaultConfig: { to: '', subject: '', body: '{{input.body}}' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'blog',
    label: 'Blog · publish',
    kind: 'output',
    group: 'Integrations',
    description: 'Publish a post to the strangeramblings blog.',
    defaultConfig: { title: '', body: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'jkai',
    label: 'jkai · message',
    kind: 'output',
    group: 'Integrations',
    description: 'Send into a jkai conversation or notification channel.',
    defaultConfig: {},
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'deck-build',
    label: 'Deck build (presentation)',
    kind: 'output',
    group: 'Integrations',
    description: 'Publish workflow results as an sr. decks presentation; returns the deck url + share link.',
    defaultConfig: { title: '', description: '', spec: '[]', share: true, isPublic: false },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json', 'text'] }],
    },
  },
  {
    type: 'api-call',
    label: 'API call (catalogue)',
    kind: 'output',
    group: 'Integrations',
    description:
      'Read / write / update / push / pull from a registered API in the catalogue. Pick an API by name, choose an operation, give a path — auth injected, SSRF-guarded, kept within the API\'s baseUrl.',
    defaultConfig: { api: '', method: 'GET', path: '', query: '', body: '', headers: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json', 'text'] }],
    },
  },
  {
    type: 'api-integration',
    label: 'API integration',
    kind: 'output',
    group: 'Integrations',
    description:
      'Pick a registered API integration by name — parameters become labelled fields and the response arrives as named values (output.values.*), so nothing downstream needs the API\'s JSON shape.',
    defaultConfig: { integration: '', params: {}, confirmWrite: false },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json', 'any'] }],
      outputs: [{ id: 'out', kinds: ['json', 'text'] }],
    },
  },
  {
    type: 'home-assistant',
    label: 'Home Assistant',
    kind: 'output',
    group: 'Integrations',
    description: 'Query or control Home Assistant entities.',
    defaultConfig: { operation: 'get_state', entityId: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'json'] }],
      outputs: [{ id: 'out', kinds: ['text', 'json'] }],
    },
  },
  {
    type: 'whoop',
    label: 'Whoop',
    kind: 'output',
    group: 'Integrations',
    description: 'Pull Whoop recovery / sleep / workout data.',
    defaultConfig: { kind: 'recovery' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'strava',
    label: 'Strava',
    kind: 'output',
    group: 'Integrations',
    description: 'Fetch Strava activities / stats / athlete profile.',
    defaultConfig: { kind: 'activities', limit: 10 },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },
  {
    type: 'health-query',
    label: 'Health query',
    kind: 'output',
    group: 'Integrations',
    description: 'Natural-language query across Apple Health / Whoop / Strava.',
    defaultConfig: { query: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['text'] }],
      outputs: [{ id: 'out', kinds: ['json', 'text'] }],
    },
  },
  {
    type: 'data-store',
    label: 'Data store (KV)',
    kind: 'output',
    group: 'Integrations',
    description: 'Per-workflow key-value store. Read, write, or increment.',
    defaultConfig: { operation: 'get', key: '' },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'database',
    label: 'Database',
    kind: 'output',
    group: 'Integrations',
    description:
      'Permanent, sitewide datastore. Full CRUD over jsonb records in named collections (insert/upsert/get/query/update/patch/delete/count/aggregate). Shared across workflows.',
    defaultConfig: { operation: 'query', collection: '', autoCreate: true },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'file-store',
    label: 'File store',
    kind: 'output',
    group: 'Integrations',
    description: 'Read, write, append, delete, or list files managed at /drive. Permissions are enforced per file.',
    defaultConfig: { operation: 'read', fileName: '', encoding: 'utf8' },
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [{ id: 'out', kinds: ['any'] }],
    },
  },
  {
    type: 'inspector',
    label: 'Inspector · debug',
    kind: 'inspector',
    group: 'Integrations',
    description: 'Debug panel. Renders JSON, tables, CSV, HTML, media.',
    defaultConfig: {},
    handles: {
      inputs: [{ id: 'in', kinds: ['any'] }],
      outputs: [],
    },
  },

  // ————————————————————————— Observability
  {
    type: 'stats-summary',
    label: 'Stats · summary',
    kind: 'stats',
    group: 'Observability',
    description: 'Headline counters, sparkline, recent runs, recent edits. Uses shared time filter.',
    defaultConfig: { size: { w: 300, h: 280 } },
    handles: {
      inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
      outputs: [],
    },
  },
  {
    type: 'stats-trends',
    label: 'Stats · trends',
    kind: 'stats',
    group: 'Observability',
    description: 'Runs over time (stacked) and run duration (p50 / p95) over time.',
    defaultConfig: { size: { w: 520, h: 360 } },
    handles: {
      inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
      outputs: [],
    },
  },
  {
    type: 'stats-per-node',
    label: 'Stats · per-node',
    kind: 'stats',
    group: 'Observability',
    description: 'Table of every node with run count, success rate, avg / p95 duration, last error.',
    defaultConfig: { size: { w: 420, h: 400 } },
    handles: {
      inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
      outputs: [],
    },
  },
  {
    type: 'run-timeline',
    label: 'Run · timeline',
    kind: 'stats',
    group: 'Observability',
    description: 'Gantt-style waterfall of a single run — every node as a bar, click to focus.',
    defaultConfig: { size: { w: 540, h: 320 } },
    handles: {
      inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
      outputs: [],
    },
  },
  {
    type: 'error-explorer',
    label: 'Errors',
    kind: 'stats',
    group: 'Observability',
    description: 'Groups failed node executions by signature. Click a group to see runs.',
    defaultConfig: { size: { w: 420, h: 360 } },
    handles: {
      inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
      outputs: [],
    },
  },
  {
    type: 'cost-summary',
    label: 'Cost',
    kind: 'stats',
    group: 'Observability',
    description: 'Total spend in window, by-model trend, drill-down by node type / label.',
    defaultConfig: { size: { w: 380, h: 320 } },
    handles: {
      inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
      outputs: [],
    },
  },

  // ————————————————————————— Builder (jkai autonomous build, brought into the canvas)
  {
    type: 'builder-chat',
    label: 'Builder Chat',
    kind: 'builder',
    group: 'Builder',
    description:
      'Set the build outcome and config; injects mid-build messages (/btw queue, /wtf interrupt). Wire to Builder Pi to drive a build.',
    defaultConfig: {
      prompt: '',
      thinkingLevel: 'medium',
      enforceDesignSystem: true,
      planFirst: false,
      modelProvider: '',
      modelId: '',
      minIterations: null,
      maxIterations: 25,
      maxTotalMinutes: 120,
      maxTokensPerHour: 1_000_000,
      activeMinutesPerHour: 15,
      buildId: '',
      size: { w: 380, h: 440 },
    },
    handles: {
      inputs: [{ id: 'in', kinds: ['trigger-signal', 'text', 'json'] }],
      outputs: [{ id: 'session', kinds: ['build-session'] }],
    },
  },
  {
    type: 'builder-pi',
    label: 'Builder Pi',
    kind: 'builder',
    group: 'Builder',
    description:
      'Live terminal for an active build. Visible elapsed timer + iteration ETA. Pause / Stop are graceful (work-in-progress is preserved).',
    defaultConfig: {
      buildId: '',
      showThinking: true,
      showTools: true,
      showLint: true,
      autoScroll: true,
      size: { w: 520, h: 460 },
    },
    handles: {
      inputs: [{ id: 'session', kinds: ['build-session'] }],
      outputs: [{ id: 'preview', kinds: ['build-preview', 'json'] }],
    },
  },
  {
    type: 'build-view',
    label: 'Build View',
    kind: 'builder',
    group: 'Builder',
    description:
      'iframe of the in-progress app. Passive (snapshot) or Active (live, refreshes on stage events). Expand to a modal. Connect data ports to feed or capture app data.',
    defaultConfig: {
      buildId: '',
      mode: 'active',
      expandable: true,
      sendUpstream: false,
      exposeOutputs: true,
      size: { w: 540, h: 420 },
    },
    handles: {
      inputs: [
        { id: 'preview', kinds: ['build-preview'] },
        { id: 'data', kinds: ['json', 'text'] },
      ],
      outputs: [{ id: 'out', kinds: ['json'] }],
    },
  },

  // ————————————————————————— Annotations (inert, no data flow)
  {
    type: 'postit',
    label: 'Post-it note',
    kind: 'postit',
    group: 'Annotations',
    description: 'Sticky note for comments. Does not run, does not connect to other nodes.',
    defaultConfig: { title: '', text: '', color: 'yellow', size: { w: 220, h: 180 } },
    handles: { inputs: [], outputs: [] },
  },
  {
    type: 'annotation',
    label: 'Annotation box',
    kind: 'annotation',
    group: 'Annotations',
    description: 'Transparent dashed box to group or annotate a region of the canvas. Inert.',
    defaultConfig: { title: '', size: { w: 360, h: 220 } },
    handles: { inputs: [], outputs: [] },
  },
]);

// ————————————————————————— Registry-derived palette entries
// The canvas reads a node's render/wiring handles from this list (byType), so a
// registered-but-unlisted node was both unreachable from the "+ node" picker
// AND rendered with no ports. Rather than hand-maintain a mirror that drifts
// (~19 executable nodes — apple-calendar, approval, the per-operation
// file/blog/deep-dive primitives — were missing), auto-derive an entry for any
// registered node the curated list above doesn't already cover. Excluded:
// hidden defs (superseded legacy nodes), display-only types (stats/notes), and
// dynamic-handle nodes whose per-instance ports need bespoke canvas rendering.
const CURATED_TYPES = new Set(CANVAS_NODE_TYPES.map((t) => t.type));
// `switch` derives its output handles per-config (switchHandles); the canvas
// doesn't render those yet, so adding it with static ports would mislead.
const DYNAMIC_HANDLE_SKIP = new Set(['switch']);

function categoryToGroup(category: string): string {
  switch (category) {
    case 'trigger':
    case 'control':
      return 'Trigger & Flow';
    case 'agentic':
      return 'LLM & AI';
    case 'integration':
      return 'Integrations';
    case 'core':
      return 'Parse & Transform';
    default:
      return 'Integrations';
  }
}

function defToOption(def: NodeDefinition): NodeTypeOption {
  return {
    type: def.type,
    label: def.label,
    kind: mapTypeToKind(def.type),
    group: categoryToGroup(def.category),
    description: def.description,
    defaultConfig: { ...def.defaultConfig },
    handles: {
      inputs: def.inputs.map((p) => ({ id: p.name, kinds: ['any'] })),
      outputs: def.outputs.map((p) => ({ id: p.name, kinds: ['any'] })),
    },
  };
}

const GENERATED_NODE_TYPES: readonly NodeTypeOption[] = Object.freeze(
  nodeDefinitions
    .filter(
      (def) =>
        !def.hidden &&
        !CURATED_TYPES.has(def.type) &&
        !DYNAMIC_HANDLE_SKIP.has(def.type) &&
        !isDisplayOnlyType(def.type),
    )
    .map(defToOption),
);

/** Curated entries first (they win on duplicate type), then registry-derived. */
const ALL_NODE_TYPES: readonly NodeTypeOption[] = Object.freeze([
  ...CANVAS_NODE_TYPES,
  ...GENERATED_NODE_TYPES,
]);

export function allTypes(): readonly NodeTypeOption[] {
  return ALL_NODE_TYPES;
}

export function byType(type: string): NodeTypeOption | undefined {
  return ALL_NODE_TYPES.find((t) => t.type === type);
}

export type ModelOption = { value: string; label: string };
export type ModelCatalogue = {
  defaultLabel: string; // what "" resolves to, for the first option
  glm: ModelOption[]; // GLM models — values are full OpenRouter slugs (z-ai/glm-*)
  openrouter: ModelOption[];
};

/** Map workflow node types to canvas visual kinds. */
export function mapTypeToKind(type: string): NodeKind {
  if (type === 'trigger') return 'trigger';
  if (type === 'chat') return 'chat';
  if (type === 'inspector') return 'inspector';
  if (
    type === 'stats-summary' ||
    type === 'stats-trends' ||
    type === 'stats-per-node' ||
    type === 'run-timeline' ||
    type === 'error-explorer' ||
    type === 'cost-summary'
  )
    return 'stats';
  if (type === 'postit') return 'postit';
  if (type === 'annotation') return 'annotation';
  if (type === 'manual-trigger' || type === 'http-request') return 'input';
  if (type === 'llm-agent') return 'agent';
  if (type === 'llm-call' || type === 'llm-router' || type === 'openrouter' || type === 'think')
    return 'llm';
  if (type === 'text-parser' || type === 'validator') return 'parse';
  if (type === 'intel-write' || type === 'intel-query' || type === 'deep-dive') return 'intel';
  if (type === 'intelligence' || type === 'research-result') return 'intelligence';
  if (type === 'research-chat') return 'research-chat';
  if (type === 'research-report') return 'research-report';
  if (type === 'quick-answer') return 'intel';
  if (type === 'deep-research') return 'intel';
  if (type === 'file-search' || type === 'research-search') return 'intel';
  if (type === 'webpage') return 'webpage';
  if (type === 'builder-chat' || type === 'builder-pi' || type === 'build-view') return 'builder';
  return 'output';
}

export { slugify } from './slug';

export type CanvasSummary = {
  slug: string;
  title: string;
  workflowId: string;
  nodeCount: number;
  edgeCount: number;
  triggerType: string;
  latestRunAt: string | null;
  latestRunStatus: string | null;
  updatedAt: string;
};

/** Identify terminal output node(s) — nodes with no outgoing edges. */
export function findTerminalNodeIds(
  nodes: { id: string }[],
  edges: { from: string; to: string }[],
): string[] {
  const hasOutgoing = new Set(edges.map((e) => e.from));
  return nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id);
}

/** Extract a text reply from a terminal node's last outputData. */
export function terminalReplyText(outputData: unknown): string {
  if (outputData === null || outputData === undefined) return '';
  if (typeof outputData === 'string') return outputData;
  if (typeof outputData === 'object') {
    const obj = outputData as Record<string, unknown>;
    // Common shapes: { reply }, { response }, { text }, { content }, { output }
    for (const k of ['reply', 'response', 'text', 'content', 'output', 'message']) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }
  return String(outputData);
}
