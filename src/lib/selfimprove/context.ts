// src/lib/selfimprove/context.ts
//
// The context pack handed to the authoring prompts.
//
// The old toolsmith prompt received intent labels plus a bare list of existing
// tool NAMES, and nothing else. With no view of the platform it was authoring
// against, it produced generic toys aimed at half-remembered public endpoints —
// a QR-code generator, a timezone converter against a URL that answered 405 —
// and an `openrouter_balance` tool that 401'd because nobody had told it the
// secret registry exists.
//
// Everything here is READ-ONLY and best-effort: any source that fails is simply
// omitted, because a thinner prompt is much better than a failed build phase.

import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { queryRecords, getCollectionBySlug } from '$lib/datastore';
import { COLLECTIONS, SYSTEM_ACTOR, errMsg, type ToolAttemptData } from './types';
import { listBacklog } from './backlog';
import type { BacklogItemData } from './types';

export interface ToolSummary {
  name: string;
  description: string;
  toolset: string;
}

export interface CatalogApiSummary {
  name: string;
  baseUrl: string;
  description: string;
  capabilities: string[];
  auth: string;
  status: string;
  example?: string;
}

export interface CustomToolHealth {
  name: string;
  description: string;
  enabled: boolean;
  runCount: number;
  errorCount: number;
  errorRate: number;
  handlerCode?: string;
}

export interface PriorFailure {
  name: string;
  reason: string;
  attemptedAt: string;
  codeExcerpt: string;
}

export interface ContextPack {
  /** Every registered site tool, callable from a handler via platform.call(). */
  platformTools: ToolSummary[];
  /** Catalogued APIs reachable via platform.call('api_call', …). */
  catalogApis: CatalogApiSummary[];
  /** Credential HANDLES available (never values). */
  secretHandles: string[];
  /** Existing custom tools + their health, so it neither duplicates nor ignores them. */
  customTools: CustomToolHealth[];
  /** What previous nights tried and why it failed. */
  priorFailures: PriorFailure[];
  /** The durable idea queue. */
  backlog: BacklogItemData[];
}

/** Tools that must never appear as composition suggestions in an authoring prompt. */
const UNSAFE_TO_SUGGEST = new Set([
  'create_tool',
  'promote_tool',
  'delete_tool',
  'datastore_delete',
  'datastore_collection_delete',
  'blog_delete',
  'workflow_delete',
  'build_cancel',
]);

async function loadPlatformTools(): Promise<ToolSummary[]> {
  try {
    const { getToolsetManifest } = await import('$lib/workflows/site-tools/registry');
    return getToolsetManifest()
      .flatMap((ts) =>
        ts.tools.map((t) => ({ name: t.name, description: t.description, toolset: ts.toolset })),
      )
      .filter((t) => !UNSAFE_TO_SUGGEST.has(t.name));
  } catch (err) {
    console.error('[selfimprove] loadPlatformTools failed:', errMsg(err));
    return [];
  }
}

async function loadCatalogApis(): Promise<CatalogApiSummary[]> {
  try {
    if (!(await getCollectionBySlug(COLLECTIONS.apiCatalog))) return [];
    const { records } = await queryRecords(
      COLLECTIONS.apiCatalog,
      { sort: { field: 'key', dir: 'asc' }, limit: 200 },
      SYSTEM_ACTOR,
    );
    return records
      .map((r) => r.data as Record<string, unknown>)
      .filter((d) => (d.status ?? 'seeded') !== 'broken')
      .map((d) => {
        const examples = Array.isArray(d.exampleRequests) ? d.exampleRequests : [];
        const first = examples[0] as { url?: string } | undefined;
        const auth = (d.auth ?? {}) as { kind?: string; handle?: string };
        return {
          name: String(d.name ?? ''),
          baseUrl: String(d.baseUrl ?? ''),
          description: String(d.description ?? '').slice(0, 300),
          capabilities: Array.isArray(d.capabilities) ? d.capabilities.slice(0, 6).map(String) : [],
          auth: auth.kind === 'secret' ? `secret:${auth.handle ?? '?'}` : (auth.kind ?? 'none'),
          status: String(d.status ?? 'seeded'),
          example: first?.url,
        };
      })
      .filter((a) => a.name && a.baseUrl);
  } catch (err) {
    console.error('[selfimprove] loadCatalogApis failed:', errMsg(err));
    return [];
  }
}

async function loadSecretHandles(): Promise<string[]> {
  try {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const res = await executeTool('api_secrets_list', {});
    if (!res.success) return [];
    const data = res.data as { secrets?: Array<{ handle?: string; available?: boolean }> } | undefined;
    return (data?.secrets ?? [])
      .filter((s) => s?.handle && s.available !== false)
      .map((s) => String(s.handle))
      .slice(0, 40);
  } catch {
    return [];
  }
}

/** Existing custom tools. `withCode` is only used by the repair phase. */
export async function loadCustomToolHealth(withCode = false): Promise<CustomToolHealth[]> {
  try {
    const rows = await db.select().from(customTools).orderBy(desc(customTools.runCount));
    return rows.map((t) => ({
      name: t.name,
      description: t.description,
      enabled: t.enabled,
      runCount: t.runCount ?? 0,
      errorCount: t.errorCount ?? 0,
      errorRate: (t.runCount ?? 0) > 0 ? (t.errorCount ?? 0) / (t.runCount ?? 1) : 0,
      handlerCode: withCode ? t.handlerCode : undefined,
    }));
  } catch (err) {
    console.error('[selfimprove] loadCustomToolHealth failed:', errMsg(err));
    return [];
  }
}

async function loadPriorFailures(): Promise<PriorFailure[]> {
  try {
    if (!(await getCollectionBySlug(COLLECTIONS.toolAttempts))) return [];
    const { records } = await queryRecords(
      COLLECTIONS.toolAttempts,
      { sort: { field: 'createdAt', dir: 'desc' }, limit: 25 },
      SYSTEM_ACTOR,
    );
    return records
      .map((r) => r.data as unknown as ToolAttemptData)
      .filter((a) => a.status === 'rejected')
      .slice(0, 10)
      .map((a) => ({
        name: a.name,
        reason: (a.reason ?? '').slice(0, 300),
        attemptedAt: a.attemptedAt,
        // Enough code to recognise the approach, not enough to blow the prompt.
        codeExcerpt: (a.handlerCode ?? '').slice(0, 600),
      }));
  } catch (err) {
    console.error('[selfimprove] loadPriorFailures failed:', errMsg(err));
    return [];
  }
}

/** Assemble the full pack. Every section degrades to empty independently. */
export async function buildContextPack(): Promise<ContextPack> {
  const [platformTools, catalogApis, secretHandles, custom, priorFailures, backlog] =
    await Promise.all([
      loadPlatformTools(),
      loadCatalogApis(),
      loadSecretHandles(),
      loadCustomToolHealth(false),
      loadPriorFailures(),
      listBacklog(),
    ]);
  return { platformTools, catalogApis, secretHandles, customTools: custom, priorFailures, backlog };
}

/**
 * Render the pack as prompt text. Kept as one function so build and repair show
 * the model an identical view of the platform.
 */
export function renderContext(pack: ContextPack): string {
  const lines: string[] = [];

  lines.push('## Tools you can compose with platform.call(name, args)');
  const byToolset = new Map<string, ToolSummary[]>();
  for (const t of pack.platformTools) {
    const list = byToolset.get(t.toolset) ?? [];
    list.push(t);
    byToolset.set(t.toolset, list);
  }
  for (const [toolset, list] of byToolset) {
    lines.push(`- ${toolset}: ${list.map((t) => t.name).join(', ')}`);
  }

  lines.push('');
  lines.push(
    '## Catalogued APIs — reach these via ' +
      'platform.call("api_call", { api: "<name below>", url: "<full url starting with that baseUrl>", method: "GET" })',
  );
  for (const a of pack.catalogApis) {
    lines.push(
      `- ${a.name} [${a.auth}] ${a.baseUrl} — ${a.description}${a.example ? ` (e.g. ${a.example})` : ''}`,
    );
  }

  if (pack.secretHandles.length) {
    lines.push('');
    lines.push('## Credential handles available (values are injected server-side; you cannot read them)');
    lines.push(pack.secretHandles.join(', '));
    lines.push(
      'To use one, the API must be catalogued with auth {"kind":"secret","handle":"<handle>"} — then call it via api_call. ' +
        'NEVER put a raw key in handler code and never try to read an env var.',
    );
  }

  if (pack.customTools.length) {
    lines.push('');
    lines.push('## Custom tools that already exist (do not duplicate these)');
    for (const t of pack.customTools) {
      lines.push(
        `- ${t.name} (${t.enabled ? 'enabled' : 'disabled'}, ${t.runCount} runs, ${(t.errorRate * 100).toFixed(0)}% errors) — ${t.description}`,
      );
    }
  }

  if (pack.priorFailures.length) {
    lines.push('');
    lines.push('## Previous attempts that FAILED — do not repeat these mistakes');
    for (const f of pack.priorFailures) {
      lines.push(`- ${f.name} (${f.attemptedAt.slice(0, 10)}): ${f.reason}`);
    }
  }

  return lines.join('\n');
}
