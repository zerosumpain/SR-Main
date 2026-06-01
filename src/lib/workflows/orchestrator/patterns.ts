export interface WorkflowPattern {
  name: string;
  description: string;
  trigger: string;  // When to use this pattern
  nodeSequence: string[];
  edgePattern: string;
  examples: string[];
}

export const workflowPatterns: WorkflowPattern[] = [
  {
    name: 'Iterative Refinement',
    description: 'Generate output, validate it, revise if validation fails. Loop until quality threshold met.',
    trigger: 'When the user wants high-quality LLM output that may need multiple attempts.',
    nodeSequence: ['llm-call', 'text-parser', 'validator', 'conditional', 'llm-call (revision)'],
    edgePattern: 'llm-call → text-parser → validator → conditional. True → output. False → second llm-call (with feedback) → back to validator.',
    examples: ['Generate a blog post that must include specific sections', 'Create structured data that must match a schema', 'Write code that must pass validation'],
  },
  {
    name: 'Map-Reduce',
    description: 'Process each item in a collection independently, then aggregate results.',
    trigger: 'When the user needs to process a list of items and combine the results.',
    nodeSequence: ['loop', 'llm-call (per item)', 'accumulator', 'llm-call (summarize)'],
    edgePattern: 'loop → llm-call → accumulator → llm-call. Loop processes items, accumulator collects, final LLM summarizes.',
    examples: ['Summarize each chapter then create overall summary', 'Analyze each email then write digest', 'Score each resume then rank them'],
  },
  {
    name: 'Semantic Router',
    description: 'Classify input and route to specialized processing pipelines.',
    trigger: 'When different inputs need different processing paths based on meaning.',
    nodeSequence: ['llm-router', 'branch-specific-nodes'],
    edgePattern: 'llm-router → multiple branches, each with domain-specific processing.',
    examples: ['Route customer messages to teams', 'Process different content types', 'Handle different user intents'],
  },
  {
    name: 'Think-Then-Act',
    description: 'Reason about the situation before taking action. Uses chain-of-thought for better decisions.',
    trigger: 'When the workflow needs to make a complex decision before acting.',
    nodeSequence: ['think', 'conditional or llm-router', 'action-nodes'],
    edgePattern: 'think → router/conditional → action branches. Think node reasons, router picks action.',
    examples: ['Analyze health data then decide whether to alert', 'Review PR then decide feedback type', 'Assess risk then choose strategy'],
  },
  {
    name: 'Critique-Revise',
    description: 'Generate output, have a separate LLM critique it, then revise based on feedback.',
    trigger: 'When output quality is critical and benefits from a separate review step.',
    nodeSequence: ['llm-call (draft)', 'llm-call (critic)', 'validator', 'conditional', 'llm-call (revise)'],
    edgePattern: 'draft → critic → validator → conditional. Pass → output. Fail → revise (with critic feedback) → back to critic.',
    examples: ['Write then review an important email', 'Generate then fact-check a report', 'Draft then QA marketing copy'],
  },
  {
    name: 'Agent Loop',
    description: 'An autonomous agent that reasons about the task and uses tools to accomplish it. The agent decides which tools to call and when to stop.',
    trigger: 'When the task requires autonomous multi-step reasoning with tool use — the workflow cannot be predetermined.',
    nodeSequence: ['llm-agent', 'tool-nodes (connected downstream)'],
    edgePattern: 'llm-agent → multiple tool nodes (http-request, code-execute, etc.). Agent calls tools internally. Output handle → next processing step.',
    examples: [
      'Research a topic using web APIs and synthesize a report',
      'Debug a problem by running code, checking results, and iterating',
      'Process a complex request that requires multiple API calls in unpredictable order',
    ],
  },
  {
    name: 'Data Pipeline',
    description: 'Fetch data, transform it, validate, and output or store.',
    trigger: 'When the user needs to pull data from APIs, process it, and produce a result.',
    nodeSequence: ['http-request', 'text-parser', 'transform', 'validator', 'output-node'],
    edgePattern: 'Linear: fetch → parse → transform → validate → output.',
    examples: ['Fetch API data, extract fields, validate format, save to store', 'Pull health data, compute metrics, check thresholds, send alert'],
  },
  {
    name: 'Scrape-Diff-Notify',
    description: 'Read a website with a saved stealth script, diff against previously-seen items, format new ones, notify the user, persist what was sent.',
    trigger: 'When the user wants alerts for new listings/jobs/prices/posts on a site. Prefer this over http-request for any human-facing web page (it runs on a residential IP with cookies, handles JS, and has a reusable saved script).',
    nodeSequence: ['trigger', 'data-store (get sent_ids)', 'stealth-scrape', 'merge', 'transform (diff)', 'llm-call (format HTML)', 'gmail-send / whatsapp (bodyHtml)', 'data-store (set sent_ids)'],
    edgePattern: 'trigger → data-store-get; trigger → stealth-scrape. Both → merge → transform (newItems = items minus sent). transform → llm-call → gmail/whatsapp. transform → data-store-set (parallel edge carries the updated id list via valuePath).',
    examples: [
      'Email me new civil-service data engineer roles within 20 miles of Darlington',
      'WhatsApp me when new listings appear on Rightmove for a saved search',
      'Daily digest of new hackernews front-page items I haven\'t seen',
    ],
  },
];

export function getPatternsForOrchestrator(): string {
  return workflowPatterns
    .map(p => `### ${p.name}\n${p.description}\n**Use when:** ${p.trigger}\n**Nodes:** ${p.nodeSequence.join(' → ')}\n**Flow:** ${p.edgePattern}\n**Examples:** ${p.examples.join('; ')}`)
    .join('\n\n');
}

/**
 * A fully worked example: a natural-language request mapped to a CONCRETE node
 * graph — real registered node types, the key config values to set on each node
 * (with literal {{input.X}} / {{trigger.output.X}} data references), and the
 * exact edge wiring.
 *
 * These are few-shot exemplars, not abstract patterns. Every `type` here is a
 * real entry in the registry (manual-trigger, stealth-scrape, llm-call, email,
 * http-request, whatsapp, gmail-trigger, gmail-fetch, gmail-reply, gmail-label,
 * conditional, loop, data-store, merge, transform), and every `config` snippet
 * uses the node's ACTUAL config keys (verified against the node definitions).
 * The orchestrator should be able to translate one of these almost verbatim
 * into use_node + connect_nodes calls.
 */
export interface GoldenExemplar {
  request: string;
  /** Trigger shape: a manual-trigger node, a cron trigger config, or a gmail-trigger start node. */
  trigger: string;
  /** Ordered nodes: spec id, registered type, and the load-bearing config. */
  nodes: { id: string; type: string; config: string }[];
  /** Edges, including sourceHandle for conditional branches ("true"/"false"). */
  edges: string[];
  /** A one-line note on the data flow / why it's shaped this way. */
  note?: string;
}

export const goldenExemplars: GoldenExemplar[] = [
  {
    request: 'Scrape the pricing page at example.com, summarise the plans, and email me the summary.',
    trigger: 'manual-trigger',
    nodes: [
      { id: 'scrape', type: 'stealth-scrape', config: `url: "https://example.com/pricing", profile: "example-com", waitFor: { type: "selector", selector: ".pricing-table" }` },
      { id: 'summarise', type: 'llm-call', config: `userPrompt: "Summarise the pricing plans below in 3 bullet points:\\n\\n{{input.pages[0].text}}"  (leave model unset → admin default)` },
      { id: 'send', type: 'email', config: `to: "me@example.com", subject: "example.com pricing summary", body: "{{input.text}}"` },
    ],
    edges: ['trigger → scrape', 'scrape → summarise', 'summarise → send'],
    note: 'stealth-scrape requires url + a stable profile name; its output is { pages: [{ url, fields, html, text }], pagesLoaded, profile } — so the LLM reads input.pages[0].text. llm-call output exposes input.text, which feeds the email body. Linear chain, no transform needed.',
  },
  {
    request: 'Every 15 minutes, check a JSON status API and WhatsApp me if the service is down.',
    trigger: 'cron — trigger.config.expression = "*/15 * * * *"',
    nodes: [
      { id: 'fetch', type: 'http-request', config: `method: "GET", url: "https://api.example.com/status"` },
      { id: 'isDown', type: 'conditional', config: `expression: "input.body.status !== 'ok'"` },
      { id: 'alert', type: 'whatsapp', config: `to: "+447359228511", message: "Service is DOWN: {{input.body.status}}"` },
    ],
    edges: ['trigger → fetch', 'fetch → isDown', 'isDown → alert (sourceHandle: "true")'],
    note: 'Only the "true" handle of the conditional is wired — when the service is healthy the workflow ends. http-request auto-parses JSON bodies, so reference input.body.* paths. conditional config key is `expression` (a single boolean JS expression).',
  },
  {
    request: 'When an email from my boss arrives, draft a polite acknowledgement reply and label the thread "Boss".',
    trigger: 'gmail-trigger (start node) — config.accountId = 1 (boss filter set via a gmail watch)',
    nodes: [
      { id: 'full', type: 'gmail-fetch', config: `accountId: 1, messageId: "{{trigger.output.messageId}}"` },
      { id: 'draft', type: 'llm-call', config: `userPrompt: "Write a short, polite acknowledgement reply to this email:\\n\\nSubject: {{input.subject}}\\n\\n{{input.bodyText}}"` },
      { id: 'reply', type: 'gmail-reply', config: `accountId: 1, to: "{{trigger.output.from}}", threadId: "{{trigger.output.threadId}}", inReplyTo: "{{nodes.full.output.rfc822MessageId}}", subject: "{{trigger.output.subject}}", bodyText: "{{nodes.draft.output.text}}"` },
      { id: 'label', type: 'gmail-label', config: `accountId: 1, messageId: "{{trigger.output.messageId}}", add: ["Label_boss"]` },
    ],
    edges: ['gmail-trigger → full', 'full → draft', 'draft → reply', 'reply → label'],
    note: 'gmail-trigger only yields a snippet — gmail-fetch gets the full body (input.subject/input.bodyText/input.rfc822MessageId). gmail-reply REQUIRES accountId, to, threadId, inReplyTo and subject, and the body goes in bodyText (or bodyHtml) — there is no plain `body` key. gmail-label uses `add`/`remove` arrays of label IDs (custom label IDs like "Label_boss", looked up at /admin/gmail), not action/labelName.',
  },
  {
    request: 'Classify each incoming support email as "urgent" or "normal"; reply immediately to urgent ones, otherwise just label it.',
    trigger: 'gmail-trigger (start node) — config.accountId = 1 (support watch)',
    nodes: [
      { id: 'full', type: 'gmail-fetch', config: `accountId: 1, messageId: "{{trigger.output.messageId}}"` },
      { id: 'classify', type: 'llm-call', config: `userPrompt: "Reply with exactly one word, 'urgent' or 'normal':\\n\\n{{input.subject}}\\n{{input.bodyText}}"` },
      { id: 'isUrgent', type: 'conditional', config: `expression: "input.text.toLowerCase().includes('urgent')"` },
      { id: 'reply', type: 'gmail-reply', config: `accountId: 1, to: "{{trigger.output.from}}", threadId: "{{trigger.output.threadId}}", inReplyTo: "{{nodes.full.output.rfc822MessageId}}", subject: "Re: {{trigger.output.subject}}", bodyText: "Thanks — we've flagged this as urgent and will respond shortly."` },
      { id: 'labelNormal', type: 'gmail-label', config: `accountId: 1, messageId: "{{trigger.output.messageId}}", add: ["Label_triage_normal"]` },
    ],
    edges: [
      'gmail-trigger → full',
      'full → classify',
      'classify → isUrgent',
      'isUrgent → reply (sourceHandle: "true")',
      'isUrgent → labelNormal (sourceHandle: "false")',
    ],
    note: 'Branch example: the conditional fans out to two different action nodes via the "true" and "false" handles. The LLM classification (input.text) is read inside the `expression`. Note input.text/input.subject/input.body all survive through the conditional pass-through.',
  },
  {
    request: 'Fetch the latest blog posts from an API and reshape each one into a {title, url} record for downstream use.',
    trigger: 'manual-trigger',
    nodes: [
      { id: 'fetch', type: 'http-request', config: `method: "GET", url: "https://api.example.com/posts?limit=10"` },
      { id: 'shape', type: 'loop', config: `arrayPath: "body.posts", expression: "return { title: item.title, url: item.url }"` },
      { id: 'digest', type: 'llm-call', config: `userPrompt: "Write a digest from this list of posts:\\n\\n{{input.results}}"` },
    ],
    edges: ['trigger → fetch', 'fetch → shape', 'shape → digest'],
    note: 'Loop example: `loop` is a MAP-TRANSFORM, not a control-flow loop. It applies `expression` to each element of input.body.posts and emits { results, count } ONCE. Downstream nodes run once with the whole array — so the digest llm-call embeds {{input.results}} in a single batch prompt rather than running per item. Do NOT place a per-item llm-call/http-request after a loop.',
  },
  {
    request: 'Daily at 8am, scrape new job listings, skip any I have already seen, and email me only the new ones.',
    trigger: 'cron — trigger.config.expression = "0 8 * * *"',
    nodes: [
      { id: 'seen', type: 'data-store', config: `operation: "get", key: "seen_job_ids"` },
      { id: 'scrape', type: 'stealth-scrape', config: `url: "https://jobs.example.com/search?q=engineer", profile: "jobs-example-com", extract: [{ field: "links", selector: ".job a", attr: "href", multi: true }]` },
      { id: 'merge', type: 'merge', config: `(no config — combines the data-store and scrape outputs into one input object)` },
      { id: 'diff', type: 'transform', config: `expression: "(() => { const all = (input.pages && input.pages[0] && input.pages[0].fields.links) || []; const seen = input.value || []; return { allLinks: all, newLinks: all.filter(h => !seen.includes(h)) }; })()"` },
      { id: 'email', type: 'email', config: `to: "me@example.com", subject: "New jobs", body: "{{input.newLinks}}"` },
      { id: 'save', type: 'data-store', config: `operation: "set", key: "seen_job_ids", valuePath: "allLinks"` },
    ],
    edges: [
      'trigger → seen',
      'trigger → scrape',
      'seen → merge',
      'scrape → merge',
      'merge → diff',
      'diff → email',
      'diff → save',
    ],
    note: 'Diff-and-persist: data-store get/set keeps state across runs (operation get|set, NOT read/write). The get output exposes input.value (the stored list); merge fans the two upstream outputs into one input (no config). The transform pulls the scraped links out of input.pages[0].fields.links, diffs against input.value, and emits { allLinks, newLinks } — a flat top-level shape so the data-store set can persist via valuePath: "allLinks" (valuePath is a dot-path and resolves top-level keys, not array-index brackets). This is the concrete form of the Scrape-Diff-Notify pattern.',
  },
];

export function getGoldenExemplarsForOrchestrator(): string {
  return goldenExemplars
    .map((ex, i) => {
      const nodeLines = ex.nodes
        .map((n) => `  - \`${n.id}\` (\`${n.type}\`): ${n.config}`)
        .join('\n');
      const edgeLines = ex.edges.map((e) => `  - ${e}`).join('\n');
      const note = ex.note ? `\n**Why:** ${ex.note}` : '';
      return `### Example ${i + 1}: ${ex.request}\n**Trigger:** ${ex.trigger}\n**Nodes:**\n${nodeLines}\n**Edges:**\n${edgeLines}${note}`;
    })
    .join('\n\n');
}
