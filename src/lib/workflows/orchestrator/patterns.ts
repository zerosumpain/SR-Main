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
