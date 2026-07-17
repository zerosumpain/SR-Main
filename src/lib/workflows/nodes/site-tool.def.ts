import type { NodeDefinition } from '../types';

/**
 * Generic bridge onto the site-tool registry (~120 tools across 22 toolsets).
 * Invokes ONE registered tool by name with templated JSON args and unwraps its
 * `{ success, data, error }` envelope. Destructive tools are gated behind an
 * approval node (config.allowDestructive + an upstream `approval` node); a small
 * set of arbitrary-code / wipe tools are denylisted entirely. Read-only under
 * dryRun (never invokes anything). See `site-tool.ts` for the executor.
 */
export const siteToolDef: NodeDefinition = {
  type: 'site-tool',
  label: 'Site Tool',
  category: 'integration',
  description:
    'Invoke any registered site capability (a "site tool") by name — presentations/decks, publish page, media generation, personal memory, site-signals, diagnostics, RAG search, and more. Args are JSON with {{input.*}} templates. Destructive tools require an upstream approval node.',
  configSchema: {
    type: 'object',
    properties: {
      toolName: {
        type: 'string',
        description:
          'Exact registered tool name (e.g. "presentation_build_from_spec", "save_memory", "render_chart"). Must match the tool\'s registry name.',
      },
      args: {
        type: 'object',
        description:
          'Arguments object matching the tool\'s parameter schema. String leaves support {{input.*}} / {{state.*}} / {{today}} / {{now}} templates.',
      },
      allowDestructive: {
        type: 'boolean',
        description:
          'Required for destructive tools (send/publish/delete-class). When true you MUST also place an approval node upstream on this node\'s path — enforced at author time and at run time.',
      },
    },
    required: ['toolName'],
  },
  defaultConfig: { toolName: '', args: {}, allowDestructive: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Tool result' }],
  llmDescription: `Generic escape hatch onto the FULL site-tool registry (~120 tools across ~22 toolsets) for any capability that has no dedicated workflow node. Reach for this when the workflow needs a site capability such as:
- presentations / decks (presentation_build_from_spec, presentation_update_from_spec, presentation_list)
- publishing a page (publish_page)
- media generation (generate_image, generate_audio_tts, write_document)
- personal memory (save_memory, recall_memories, forget_memory)
- live site-signals (live_walk_status, family_presence_current, policy_engine_indicators)
- diagnostics (scheduler_status, system_logs, scheduler_run_history)
- RAG over /drive files (file_search) or cross-session research (research_search)
- home assistant, gmail read, health data, etc.

Config:
- \`toolName\` — the EXACT registered tool name.
- \`args\` — a JSON object matching that tool's parameter schema. String values support {{input.field}} templates (interpolated against the merged upstream input) plus the engine's {{state.KEY}} / {{today}} / {{now}}. Non-string args (numbers, arrays, objects) are passed through as-is.

Output on success: { success: true, toolName, data: <the tool's data envelope> } (read the tool's result via input.data.* downstream). On failure the node errors (honours the node's On-failure setting).

DESTRUCTIVE / APPROVAL RULE: tools that send, publish, or delete are flagged \`destructive\`. To run one you MUST set \`allowDestructive: true\` AND place an \`approval\` node upstream on this node's path — the run pauses for human sign-off before the destructive tool fires. Without the flag the node refuses; with the flag but no upstream approval the workflow fails author-time verification. A hard denylist (ephemeral/custom-tool authoring, node_builder_* codegen+deploy, workflow_delete, workflow_clear_data_store, build_delete) is NEVER invocable from a workflow, flag or not.

DRY RUN: under a dry run this node NEVER invokes any tool — it returns { dryRun: true, wouldInvoke, args } so you can verify wiring without side effects.

Prefer a dedicated node when one exists (whatsapp, blog-create, deep-research, file-search, tavily-search, …) — they have richer panels and schema hints. Use site-tool only for capabilities without a dedicated node. The generator grounding lists the available tools + their destructive flag.`,
  llmExamples: [
    // Non-destructive: build a deck spec.
    {
      toolName: 'presentation_build_from_spec',
      args: { title: 'Weekly Briefing', blocks: [] },
    },
    // Non-destructive: persist a fact to personal memory.
    {
      toolName: 'save_memory',
      args: { category: 'preference', content: '{{input.fact}}' },
    },
    // Non-destructive: render an inline chart from upstream rows.
    {
      toolName: 'render_chart',
      args: {
        spec: { mark: 'bar', encoding: {} },
        data: '{{input.rows}}',
        caption: 'Daily totals',
      },
    },
  ],
};
