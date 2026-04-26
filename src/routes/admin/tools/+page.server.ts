import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { registry } from '$lib/workflows';
import { getToolsetManifest } from '$lib/workflows/site-tools/registry';
export const load: PageServerLoad = async () => {
  const customRows = await db
    .select({
      id: customTools.id,
      name: customTools.name,
      description: customTools.description,
      toolset: customTools.toolset,
      enabled: customTools.enabled,
      parameters: customTools.parameters,
      handlerCode: customTools.handlerCode,
      runCount: customTools.runCount,
      errorCount: customTools.errorCount,
      lastRunAt: customTools.lastRunAt,
      createdAt: customTools.createdAt,
      createdBy: customTools.createdBy,
    })
    .from(customTools)
    .orderBy(desc(customTools.createdAt));

  // Workflow primitives — what the canvas builder can drop on the graph.
  // Hidden defs (legacy multi-mode nodes superseded by per-operation splits)
  // remain executable but are filtered out so the admin UI matches what
  // the orchestrator actually sees.
  const allDefs = registry.listDefinitions();
  const primitives = allDefs
    .filter((d) => !d.hidden)
    .map((d) => ({
      type: d.type,
      label: d.label,
      category: d.category,
      description: d.description,
      llmDescription: d.llmDescription ?? null,
      inputs: d.inputs,
      outputs: d.outputs,
      configSchema: d.configSchema,
      defaultConfig: d.defaultConfig,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Site tools — orchestrator-callable functions, grouped by toolset.
  const toolsets = getToolsetManifest().map((ts) => ({
    toolset: ts.toolset,
    description: ts.description,
    tools: ts.tools.map((t) => ({ name: t.name, description: t.description })),
  }));

  return {
    tools: customRows,
    primitives,
    toolsets,
  };
};
