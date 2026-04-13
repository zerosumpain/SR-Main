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
    name: 'Data Pipeline',
    description: 'Fetch data, transform it, validate, and output or store.',
    trigger: 'When the user needs to pull data from APIs, process it, and produce a result.',
    nodeSequence: ['http-request', 'text-parser', 'transform', 'validator', 'output-node'],
    edgePattern: 'Linear: fetch → parse → transform → validate → output.',
    examples: ['Fetch API data, extract fields, validate format, save to store', 'Pull health data, compute metrics, check thresholds, send alert'],
  },
];

export function getPatternsForOrchestrator(): string {
  return workflowPatterns
    .map(p => `### ${p.name}\n${p.description}\n**Use when:** ${p.trigger}\n**Nodes:** ${p.nodeSequence.join(' → ')}\n**Flow:** ${p.edgePattern}\n**Examples:** ${p.examples.join('; ')}`)
    .join('\n\n');
}
