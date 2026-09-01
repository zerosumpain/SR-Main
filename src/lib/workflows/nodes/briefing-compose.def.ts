import type { NodeDefinition } from '../types';

export const briefingComposeDef: NodeDefinition = {
  type: 'briefing-compose',
  label: 'Briefing compose',
  category: 'core',
  description:
    'Turn gathered signals into a verified fact sheet, an explicit gap list, and a per-source status ledger. Everything a downstream LLM is allowed to say, and nothing it is not.',
  configSchema: {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'IANA timezone for the date label (default Europe/London).' },
      titlePrefix: { type: 'string', description: 'Prefix for the generated title (default "Briefing").' },
      auditRun: {
        type: 'boolean',
        description:
          "Read this run's own node executions to build the source ledger, so failed upstream nodes are recorded with their real error text (default true).",
      },
    },
  },
  defaultConfig: { timezone: 'Europe/London', titlePrefix: 'Briefing', auditRun: true },
  inputs: [{ name: 'input', type: 'any', label: 'Merged signals' }],
  outputs: [{ name: 'output', type: 'object', label: 'Fact sheet + gaps' }],
  summarize: (config) => ({
    line: 'Build a verified fact sheet, gap list and source ledger',
    preview: {
      kind: 'other',
      details: {
        Timezone: String(config.timezone ?? 'Europe/London'),
        'Audit run': config.auditRun === false ? 'no' : 'yes',
      },
    },
  }),
  basicConfig: [
    {
      key: 'titlePrefix',
      label: 'Title prefix',
      type: 'text',
      placeholder: 'Briefing',
      description: 'Used to build the briefing title, e.g. "Briefing — Tue 29 Jul".',
    },
    {
      key: 'timezone',
      label: 'Timezone',
      type: 'text',
      placeholder: 'Europe/London',
      description: 'Timezone for the date label.',
    },
    {
      key: 'auditRun',
      label: 'Audit this run',
      type: 'toggle',
      description:
        "Read the run's node executions so failed sources appear in the ledger with their real error, instead of just going missing.",
    },
  ],
  llmDescription: `The anti-fabrication step of a briefing workflow. Sits after a \`merge\` and before the \`llm-call\` that writes the prose.

**Expected input keys** (all optional — anything absent is reported as a gap, never invented). Namespace each source with a one-line \`transform\` before the merge, e.g. \`return { sleep: input };\`:
- \`location\` — a \`location-context\` output
- \`weatherHome\`, \`weatherHere\` — the \`weather\` object from two \`weather-brief\` nodes
- \`sleep\`, \`readiness\` — \`health-query\` outputs
- \`indoor\` — a \`home-assistant\` query_state output
- \`email\` — a \`gmail-search\` output
- \`knowledge\` — an \`intel-query\` output
- \`briefingSources\` — a generic array from any capability: \`[{ key, label, status, detail, facts: [{ label, value, source }] }]\`. Use this for calendar, research, files, web results, finance, monitors, or future node types without changing this composer.

The owner-facing briefing profile controls which sources are included and which
ones are required. The composer also reads recent shared JKAI memories and
daydream activity directly, so learning completed outside the canvas is visible
in the next briefing.

**Returns** \`{ briefing, facts[], gaps[], sources[], factSheet, gapSheet, headline, availableCount, gapCount }\`.

\`factSheet\` and \`gapSheet\` are pre-rendered text to paste into the LLM prompt. Every number the briefing is allowed to state appears in \`factSheet\`, already formatted and unit-correct; \`gapSheet\` names every source that produced nothing. Prompt the LLM with "use only values that appear verbatim in FACTS; for anything in GAPS say it is unavailable" and it has nothing left to invent.

\`sources[]\` is the audit trail — one row per source with \`status\` (ok / failed / stale / empty) and the real error text, suitable for storing alongside the briefing.`,
  llmExamples: [{ titlePrefix: 'Briefing', timezone: 'Europe/London', auditRun: true }],
};
