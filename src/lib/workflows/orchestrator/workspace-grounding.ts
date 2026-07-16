/**
 * Live workspace resource snapshot for the orchestrator's system prompt.
 *
 * The orchestrator's `workflow_create`/`update_node` tools produce config
 * blobs with values like `accountId: 1` or `entityId: 'light.kitchen'`. Without
 * a snapshot of what's actually configured in the workspace, the LLM has to
 * guess — and a guessed `accountId: 1` that doesn't exist will fail at run
 * time. This builder fetches the small set of "queryable" resources from the
 * DB and renders them as a concise markdown subsection, scoped to the current
 * workflow where it makes sense (data store keys, file store, sub-workflow
 * candidates).
 *
 * Defensive design: every query is independently try/catch'd. If a single
 * subsection fails (DB hiccup, table missing in dev), it's omitted rather
 * than crashing the whole prompt build.
 */

import { db } from '$lib/db';
import {
  gmailAccounts,
  workflows,
  workflowDataStore,
  workflowFiles,
  blogPosts,
  homeAssistantConfig,
} from '$lib/db/schema';
import { eq, desc, ne, asc } from 'drizzle-orm';

const MAX_HA_ENTITIES = 50;
const MAX_BLOG_POSTS = 50;
const MAX_FILES = 30;
const MAX_DATA_STORE_KEYS = 50;
const HA_PRIORITY_DOMAINS = new Set([
  'light',
  'switch',
  'sensor',
  'person',
  'device_tracker',
  'climate',
  'media_player',
]);

interface HaEntityRow {
  entity_id?: string;
  domain?: string;
  friendly_name?: string;
}

async function buildGmailAccountsSection(): Promise<string | null> {
  try {
    const rows = await db
      .select({
        id: gmailAccounts.id,
        email: gmailAccounts.email,
        status: gmailAccounts.status,
      })
      .from(gmailAccounts)
      .where(eq(gmailAccounts.status, 'active'))
      .orderBy(asc(gmailAccounts.id));

    if (rows.length === 0) return null;

    const lines = rows.map(
      (r) => `  - id: ${r.id}, email: \`${r.email}\`, status: \`${r.status}\``,
    );
    return `### Gmail accounts\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

async function buildWorkflowsSection(currentWorkflowId?: string | null): Promise<string | null> {
  try {
    const rows = await db
      .select({ id: workflows.id, name: workflows.name })
      .from(workflows)
      .where(currentWorkflowId ? ne(workflows.id, currentWorkflowId) : undefined)
      .orderBy(desc(workflows.updatedAt))
      .limit(50);

    if (rows.length === 0) return null;

    const lines = rows.map((r) => `  - id: \`${r.id}\`, name: ${JSON.stringify(r.name)}`);
    const heading = '### Workflows (sub-workflow candidates)';
    return `${heading}\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

const WORKFLOW_MEMORY_HEADING = '### Workflow memory';

/** ≤120-char single-line preview of a stored value. */
export function previewStoreValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const oneLine = str.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

/**
 * Render the always-on "Workflow memory" section from data-store rows. Pure, so
 * it's unit-testable without a DB. Empty rows → the empty-state guidance that
 * points the model at {{state.KEY}}; populated rows → key + updated_at + a short
 * value preview per key.
 */
export function renderWorkflowMemorySection(
  rows: Array<{ key: string; value: unknown; updatedAt?: Date | string | null }>,
): string {
  if (rows.length === 0) {
    return (
      `${WORKFLOW_MEMORY_HEADING}\n  - No stored keys yet — dedupe/data-store nodes create them on ` +
      'first run; reference future keys via {{state.KEY}}.'
    );
  }
  const lines = rows.map((r) => {
    const when = r.updatedAt ? new Date(r.updatedAt).toISOString() : '?';
    return `  - \`${r.key}\` (updated ${when}): ${previewStoreValue(r.value)}`;
  });
  return `${WORKFLOW_MEMORY_HEADING}\n${lines.join('\n')}`;
}

/**
 * Workflow memory (B8): ALWAYS rendered for generation so the model knows the
 * dedupe/data-store keys it can read via {{state.KEY}}. When keys exist it lists
 * each with its updated_at and a short value preview; when none exist (or no
 * workflow id yet) it states the empty case and points at {{state.KEY}}.
 */
async function buildDataStoreSection(workflowId?: string | null): Promise<string | null> {
  if (!workflowId) return renderWorkflowMemorySection([]);

  try {
    const rows = await db
      .select({
        key: workflowDataStore.key,
        value: workflowDataStore.value,
        updatedAt: workflowDataStore.updatedAt,
      })
      .from(workflowDataStore)
      .where(eq(workflowDataStore.workflowId, workflowId))
      .orderBy(asc(workflowDataStore.key))
      .limit(MAX_DATA_STORE_KEYS);

    return renderWorkflowMemorySection(rows);
  } catch {
    // Still surface the section (with guidance) rather than dropping it — the
    // point of B8 is that generation ALWAYS sees the memory guidance.
    return `${WORKFLOW_MEMORY_HEADING}\n  - (memory unavailable — dedupe/data-store nodes persist keys; reference via {{state.KEY}}).`;
  }
}

async function buildHaEntitiesSection(): Promise<string | null> {
  try {
    const [config] = await db
      .select({ entityRegistry: homeAssistantConfig.entityRegistry })
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);

    const all: HaEntityRow[] = Array.isArray(config?.entityRegistry)
      ? (config.entityRegistry as HaEntityRow[])
      : [];

    if (all.length === 0) return null;

    // Prioritise the most-used domains, fall back to alphabetical inside each.
    const prioritised = all
      .filter((e) => e.domain && HA_PRIORITY_DOMAINS.has(e.domain))
      .sort((a, b) => (a.entity_id ?? '').localeCompare(b.entity_id ?? ''));
    const remainder = all
      .filter((e) => e.domain && !HA_PRIORITY_DOMAINS.has(e.domain))
      .sort((a, b) => (a.entity_id ?? '').localeCompare(b.entity_id ?? ''));
    const ordered = [...prioritised, ...remainder];

    const shown = ordered.slice(0, MAX_HA_ENTITIES);
    const lines = shown.map((e) => {
      const friendly = e.friendly_name ? ` (${JSON.stringify(e.friendly_name)})` : '';
      return `  - \`${e.entity_id ?? '?'}\` [${e.domain ?? '?'}]${friendly}`;
    });
    if (ordered.length > shown.length) {
      lines.push(`  - (${ordered.length - shown.length} more — call ask_user if you need a specific one)`);
    }
    return `### Home Assistant entities\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

async function buildFileStoreSection(workflowId?: string | null): Promise<string | null> {
  if (!workflowId) return null;
  try {
    const rows = await db
      .select({ name: workflowFiles.name, mimeType: workflowFiles.mimeType })
      .from(workflowFiles)
      .orderBy(asc(workflowFiles.name))
      .limit(MAX_FILES);

    if (rows.length === 0) return null;

    const lines = rows.map((r) => `  - \`${r.name}\` (${r.mimeType})`);
    return `### File store\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

async function buildBlogPostsSection(): Promise<string | null> {
  try {
    const rows = await db
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        title: blogPosts.title,
        status: blogPosts.status,
      })
      .from(blogPosts)
      .orderBy(desc(blogPosts.updatedAt))
      .limit(MAX_BLOG_POSTS);

    if (rows.length === 0) return null;

    const lines = rows.map(
      (r) => `  - id: ${r.id}, slug: \`${r.slug}\`, status: \`${r.status}\` — ${JSON.stringify(r.title)}`,
    );
    return `### Blog posts\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

/**
 * Build the workspace-resources subsection for a system prompt. Pass the
 * `workflowId` of the currently-open workflow so subsections that are scoped
 * (data store, file store, "exclude self from sub-workflow list") render
 * correctly.
 */
export async function buildWorkspaceResources(workflowId?: string | null): Promise<string> {
  const sections = await Promise.all([
    buildGmailAccountsSection(),
    buildWorkflowsSection(workflowId),
    buildDataStoreSection(workflowId),
    buildHaEntitiesSection(),
    buildFileStoreSection(workflowId),
    buildBlogPostsSection(),
  ]);

  return sections.filter((s): s is string => s !== null).join('\n\n');
}
