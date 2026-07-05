import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { registry } from '$lib/workflows';
import { getToolsetManifest } from '$lib/workflows/site-tools/registry';
import type { NodeDefinition } from '$lib/workflows/types';

// Workflow node primitives that are tied to specific site features or the
// owner's connected accounts — not general building blocks. Surfaced under
// the "Site tools" tab alongside the orchestrator-callable functions.
const SITE_NODE_FAMILIES: Array<{ family: string; description: string; types: string[] }> = [
  {
    family: 'Blog',
    description: 'Posts at /admin/content/blog.',
    types: ['blog', 'blog-list', 'blog-get', 'blog-create', 'blog-update'],
  },
  {
    family: 'Deep Dive',
    description: 'LLM research sessions at /deepdive.',
    types: ['deep-dive', 'deep-dive-start', 'deep-dive-status', 'deep-dive-report', 'deep-dive-list', 'deep-dive-control'],
  },
  {
    family: 'Intelligence',
    description: 'Intel store + query.',
    types: ['intel-write', 'intel-query', 'intelligence'],
  },
  {
    family: 'JKAI',
    description: 'Orchestrator chat hub.',
    types: ['jkai'],
  },
  {
    family: 'Gmail',
    description: 'Connected Gmail accounts.',
    types: ['gmail-trigger', 'gmail-fetch', 'gmail-send', 'gmail-reply', 'gmail-label', 'gmail-search'],
  },
  {
    family: 'Biome / Health',
    description: 'Personal HR / fitness data.',
    types: ['health-query'],
  },
  {
    family: 'Home Assistant',
    description: 'Local Home Assistant instance.',
    types: ['home-assistant'],
  },
  {
    family: 'Strava',
    description: 'Strava activities.',
    types: ['strava'],
  },
  {
    family: 'Whoop',
    description: 'Whoop wearable data.',
    types: ['whoop'],
  },
  {
    family: 'WhatsApp',
    description: 'WhatsApp inbound/outbound.',
    types: ['whatsapp'],
  },
];

const SITE_NODE_TYPES = new Set(SITE_NODE_FAMILIES.flatMap((g) => g.types));

function toRow(d: NodeDefinition) {
  return {
    type: d.type,
    label: d.label,
    category: d.category,
    description: d.description,
    llmDescription: d.llmDescription ?? null,
    inputs: d.inputs,
    outputs: d.outputs,
    configSchema: d.configSchema,
    defaultConfig: d.defaultConfig,
  };
}

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
  const allDefs = registry.listDefinitions().filter((d) => !d.hidden);

  const primitives = allDefs
    .filter((d) => !SITE_NODE_TYPES.has(d.type))
    .map(toRow)
    .sort((a, b) => a.label.localeCompare(b.label));

  const byType = new Map(allDefs.map((d) => [d.type, d]));
  const siteNodeFamilies = SITE_NODE_FAMILIES.map((g) => ({
    family: g.family,
    description: g.description,
    nodes: g.types
      .map((t) => byType.get(t))
      .filter((d): d is NodeDefinition => Boolean(d))
      .map(toRow),
  })).filter((g) => g.nodes.length > 0);

  // Site tools — orchestrator-callable functions, grouped by toolset.
  const toolsets = getToolsetManifest().map((ts) => ({
    toolset: ts.toolset,
    description: ts.description,
    tools: ts.tools.map((t) => ({ name: t.name, description: t.description })),
  }));

  return {
    tools: customRows,
    primitives,
    siteNodeFamilies,
    toolsets,
  };
};
