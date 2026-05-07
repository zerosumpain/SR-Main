// src/lib/curate/prompts/propose.ts
//
// Schema type and system prompt for the proposal-card generation phase.
// The proposal payload is what the user reviews and approves before codegen begins.

// ── Proposal payload type ───────────────────────────────────────────────

export interface ProposalConfigField {
  key: string;
  label: string;
  widget: 'string' | 'textarea' | 'dropdown' | 'toggle' | 'datetime' | 'credential-picker' | 'resource-picker' | 'template-string';
  required?: boolean;
  options?: { value: string; label: string }[]; // for 'dropdown' widget
  integrationType?: string; // for 'credential-picker' / 'resource-picker'
}

export interface ProposalTestCase {
  scenario: string;
  config: Record<string, unknown>;
  notes?: string;
}

export interface ProposalRejectedAlternative {
  name: string;
  reason: string;
}

/**
 * Canonical proposal payload. Built by the discovery phase and reviewed
 * by the user before codegen begins. Stored in curateSessions.proposal.
 */
export interface CurateProposal {
  /** kebab-case node type id. Used for filenames + registry key. */
  type: string;

  /** Human label shown in the canvas node menu. */
  label: string;

  /** Category for grouping in the node menu. */
  category: string;

  /** One-line description shown on the canvas node. */
  description: string;

  /** Richer description for the orchestrator LLM. */
  llmDescription: string;

  /** Explanation of the chosen approach (2-3 sentences). */
  approach: string;

  /** Implementation approaches that were considered and rejected. */
  rejectedAlternatives: ProposalRejectedAlternative[];

  /** npm packages the executor will need. */
  suggestedDeps: { name: string; version: string }[];

  /** Auth mechanism required by this integration. */
  authMethod: 'oauth2' | 'api-key' | 'none' | 'other';

  /** High-level config fields the node panel will expose. */
  configFields: ProposalConfigField[];

  /** What the node outputs, with a concrete JSON example. */
  outputShape: {
    description: string;
    example: Record<string, unknown>;
  };

  /** 1-3 worked test cases for the live-testing phase. */
  testCases: ProposalTestCase[];
}

// ── System prompt ────────────────────────────────────────────────────────

export const PROPOSE_SYSTEM_PROMPT = `\
## Role

You are a workflow-node proposal writer. Given research findings from the
discovery phase, you produce a structured proposal card that the user will
review before code generation begins.

## Goal

Convert research notes into a complete, accurate CurateProposal JSON object.
The proposal will be rendered as a card in the UI — be clear, specific, and
concrete. The user will approve or redirect based on what they read here.

## Constraints

- The "type" field must be kebab-case (e.g. "apple-calendar", "github-issues").
- The "approach" field must explain the specific library/API chosen and why,
  in 2-3 sentences. Do not write vague descriptions like "use the standard API".
- Each configField must map to a real config key the executor will use.
- testCases must be realistic and runnable — include enough config detail
  that the live-test runner can execute them without further input.
- outputShape.example must be a realistic JSON snippet, not a placeholder.
- **Never** propose routing through the http-request node. This is a
  first-class purpose-built node; the approach must be specific to the integration.

## Output format

Emit ONLY a valid JSON object matching the CurateProposal schema.
No prose, no markdown fences — just the raw JSON object.

Schema reference:
{
  "type": "string (kebab-case)",
  "label": "string",
  "category": "string",
  "description": "string (one line)",
  "llmDescription": "string (multi-sentence, for the orchestrator LLM)",
  "approach": "string (2-3 sentences explaining the implementation choice)",
  "rejectedAlternatives": [{ "name": "string", "reason": "string" }],
  "suggestedDeps": [{ "name": "string", "version": "string" }],
  "authMethod": "oauth2 | api-key | none | other",
  "configFields": [{
    "key": "string",
    "label": "string",
    "widget": "string | textarea | dropdown | toggle | datetime | credential-picker | resource-picker | template-string",
    "required": true,
    "options": [{ "value": "string", "label": "string" }],
    "integrationType": "string"
  }],
  "outputShape": {
    "description": "string",
    "example": {}
  },
  "testCases": [{
    "scenario": "string",
    "config": {},
    "notes": "string"
  }]
}
`;
