/**
 * Scraper playbook — a reusable recipe for extracting a specific kind of
 * content from a specific domain, generated once by the site-mapper node and
 * cached in `scraper_target_knowledge.playbook`.
 *
 * Every subsequent stealth-scrape against that domain dispatches through
 * `runPlaybook` instead of the free-form config on the node, so cron runs
 * don't re-derive navigation / selectors per execution. Altcha auto-solve
 * (already in scrape.py) still happens inside runScrape.
 *
 * v1 scope: single-URL extraction. No click/fill/submit step sequences —
 * those land in v2 once we hit a site that needs them.
 */

import { runScrape, type RunScrapeOptions } from './runner';
import type { ExtractRule, ScrapeJob, ScrapeResult } from './types';
import { db } from '$lib/db';
import { scraperTargetKnowledge } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeDomain } from './target-knowledge';

export type PlaybookStep =
  | { type: 'goto'; url: string }
  | { type: 'wait'; selector?: string; ms?: number; timeoutMs?: number }
  | { type: 'click'; selector?: string; text?: string }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'select'; selector: string; value: string }
  | { type: 'submit'; formSelector?: string }
  | { type: 'altcha' };

/** v1: single URL template (legacy); v2: full step sequence the agent
 *  recorded. v2 playbooks are replayed by the playbook runner via
 *  site-mapper-agent.py. v1 playbooks still dispatch through the original
 *  runScrape for backward compat. */
export interface PlaybookRequiredVar {
  /** Variable name used inside step `{{…}}` placeholders, e.g. "keyword". */
  name: string;
  /** Short hint the decomposition LLM uses to pull the right slice out of the
   *  user's natural-language searchQuery (e.g. "job title or role keyword"). */
  hint: string;
  /** Optional literal fallback if the user hasn't supplied a searchQuery and
   *  decomposition produced nothing. Leave blank to let replay fail noisily. */
  fallback?: string;
}

export interface Playbook {
  /** Version marker — bump when the shape changes so old rows are obviously stale. */
  version: 1 | 2;
  /** ISO timestamp set when the mapper created this playbook. */
  generatedAt: string;
  /** Human-readable description of what the playbook extracts (e.g. "data engineer job listings"). */
  goal: string;
  /** v1 ONLY: URL template with `{{var}}` substitution. */
  urlTemplate?: string;
  /** v1 ONLY: wait condition before extraction. */
  waitFor?: ScrapeJob['waitFor'];
  /** v2 ONLY: ordered navigation sequence. Values in fill/goto support
   *  `{{var}}` substitution from the input vars map. */
  steps?: PlaybookStep[];
  /** v2 ONLY: which named vars the playbook expects at replay time. The
   *  site-mapper derives this from every `{{…}}` placeholder in the saved
   *  steps. At replay, if the caller supplies a natural-language searchQuery
   *  (and hasn't hand-wired every var), the runner calls a small LLM to
   *  decompose that string into values for each required var. Keeps rich
   *  queries like "Analysts near Darlington within 20 miles" working across
   *  sites where different fields ask for different pieces. */
  requiredVars?: PlaybookRequiredVar[];
  /** Extraction rules applied on the page after all steps run. Same shape
   *  as stealth-scrape node's extract array. */
  extract: ExtractRule[];
  /** Optional pagination spec (v1 only for now). */
  pagination?: ScrapeJob['pagination'];
  /** Acceptance test the mapper uses to validate a freshly-generated playbook,
   *  and that stealth-scrape uses post-run to decide if the playbook is still
   *  producing useful output (if not, mark stale). */
  acceptance: {
    /** Minimum number of items in `sampleField` for the playbook to be considered valid. */
    minItems: number;
    /** Which extracted field to count items in (must be a `multi:true` rule). */
    sampleField: string;
  };
}

/** Substitute `{{var}}` placeholders in a string from a vars map. Missing vars
 *  leave the placeholder intact so mis-wired inputs surface at the URL rather
 *  than silently fetching the wrong page. Exported for the v2 runner which
 *  interpolates URLs + fill values inside each step. */
export function interpolateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
    return match;
  });
}

/** Extract every `{{var}}` placeholder used inside a playbook's step values.
 *  The runner uses this to know what decomposition needs to produce, and the
 *  site-mapper uses it at finalize time to auto-derive the `requiredVars`
 *  list when the LLM forgot to declare it explicitly. */
export function extractStepVarNames(steps: PlaybookStep[]): string[] {
  const seen = new Set<string>();
  const capture = (s: string | undefined) => {
    if (!s) return;
    for (const m of s.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) seen.add(m[1]);
  };
  for (const s of steps) {
    if (s.type === 'goto') capture(s.url);
    else if (s.type === 'fill' || s.type === 'select') capture(s.value);
    else if (s.type === 'click') capture(s.text);
  }
  return Array.from(seen);
}

/**
 * One LLM round-trip that splits a natural-language searchQuery into values
 * for the playbook's `requiredVars`. Conservative: if the query obviously
 * doesn't mention a var (e.g. no location given), it returns empty string for
 * that slot rather than hallucinating — the runner then falls back to the
 * var's `fallback` or leaves the placeholder as-is (so replay fails loud).
 */
export async function decomposeSearchQuery(opts: {
  searchQuery: string;
  requiredVars: PlaybookRequiredVar[];
  model?: string;
  onDebug?: (ev: Record<string, unknown>) => void;
}): Promise<Record<string, string>> {
  const { searchQuery, requiredVars, model, onDebug } = opts;
  if (!searchQuery.trim() || requiredVars.length === 0) return {};
  const { resolveLLMClient } = await import('$lib/workflows/nodes/llm-helpers');
  const { client, model: chosen } = await resolveLLMClient(model);
  const schema = requiredVars.map((v) => `  - ${v.name}: ${v.hint}`).join('\n');
  const example = requiredVars
    .map((v) => `"${v.name}": "<value or empty string>"`)
    .join(', ');
  const prompt = [
    `Extract structured slot values from a free-form search query.`,
    ``,
    `Slots to extract (each is optional — leave blank as "" if not mentioned):`,
    schema,
    ``,
    `Rules:`,
    `- The "keyword" slot should contain ONLY the job title, role, or primary search term (e.g. "Analyst", "Software Engineer"). Do NOT put the whole query in keyword.`,
    `- Numeric slots (distance, salary, etc) must be plain numbers, no units, no commas.`,
    `- If a slot is not mentioned, use "".`,
    ``,
    `Respond with ONE JSON object only, no prose, no markdown fences. Shape:`,
    `{ ${example} }`,
    ``,
    `Query: ${searchQuery}`,
  ].join('\n');
  let raw = '';
  try {
    const resp = await (client as {
      chat: { completions: { create: (args: unknown) => Promise<{ choices: Array<{ message: { content: string | null } }> }> } };
    }).chat.completions.create({
      model: chosen,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 400,
    });
    raw = resp.choices[0]?.message?.content ?? '';
  } catch (err) {
    onDebug?.({ stage: 'decompose.llm_error', err: err instanceof Error ? err.message : String(err) });
  }
  onDebug?.({ stage: 'decompose.raw', raw: raw.slice(0, 500) });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    onDebug?.({ stage: 'decompose.no_json' });
    return {};
  }
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const v of requiredVars) {
      const val = obj[v.name];
      if (typeof val === 'string' && val.trim()) out[v.name] = val.trim();
      else if (typeof val === 'number') out[v.name] = String(val);
    }
    onDebug?.({ stage: 'decompose.parsed', keys: Object.keys(out) });
    return out;
  } catch (err) {
    onDebug?.({ stage: 'decompose.parse_error', err: err instanceof Error ? err.message : String(err) });
    return {};
  }
}

export interface RunPlaybookOptions {
  playbook: Playbook;
  /** Variables for urlTemplate substitution (e.g. { keyword: 'data engineer' }).
   *  Any var already supplied here is trusted verbatim and skips decomposition. */
  vars?: Record<string, string>;
  /** Natural-language search spec from the user (e.g. "Analysts near Darlington
   *  within 20 miles over 60k"). When the playbook declares `requiredVars` and
   *  some are missing from `vars`, the runner asks an LLM to decompose this
   *  string into the named vars. Leave blank for fully-wired callers. */
  searchQuery?: string;
  /** Profile to use for the underlying stealth-scrape. Defaults to 'default'. */
  profile?: string;
  /** Forwarded for audit / SSE wiring. */
  workflowRunId?: string;
  /** Override the LLM used for decomposition. Defaults to the workspace default. */
  model?: string;
  onProgress?: RunScrapeOptions['onProgress'];
}

export interface RunPlaybookResult extends ScrapeResult {
  /** True when the scrape's extracted output meets the playbook's acceptance test. */
  acceptanceMet: boolean;
  /** Convenience: number of items in the acceptance sampleField. */
  itemCount: number;
}

/**
 * Execute a playbook against its domain. Returns the usual ScrapeResult
 * augmented with an acceptance verdict — callers decide whether to mark the
 * playbook stale, re-run the mapper, or surface the failure.
 */
export async function runPlaybook(opts: RunPlaybookOptions): Promise<RunPlaybookResult> {
  const { playbook } = opts;
  // v2 playbooks have a full navigation step sequence — delegate to the
  // agent-harness runner so clicks/fills/submits/altcha actually fire.
  if (playbook.version === 2 && Array.isArray(playbook.steps) && playbook.steps.length > 0) {
    const { runPlaybookV2 } = await import('./playbook-runner-v2');
    return await runPlaybookV2(opts);
  }

  // v1: simple URL template + runScrape.
  const { vars = {}, profile = 'default', workflowRunId, onProgress } = opts;
  if (!playbook.urlTemplate) {
    throw new Error('Playbook v1 is missing urlTemplate');
  }
  const url = interpolateVars(playbook.urlTemplate, vars);
  const result = await runScrape({
    url,
    profile,
    waitFor: playbook.waitFor ?? { type: 'networkidle' },
    extract: playbook.extract,
    pagination: playbook.pagination,
    workflowRunId,
    onProgress,
  });
  const itemCount = countAcceptanceItems(result, playbook);
  return {
    ...result,
    acceptanceMet: itemCount >= playbook.acceptance.minItems,
    itemCount,
  };
}

function countAcceptanceItems(result: ScrapeResult, playbook: Playbook): number {
  if (!result.success || result.pages.length === 0) return 0;
  const field = playbook.acceptance.sampleField;
  let total = 0;
  for (const page of result.pages) {
    const fields = (page as { fields?: Record<string, unknown> }).fields;
    const val = fields?.[field];
    if (Array.isArray(val)) total += val.length;
    else if (val != null && val !== '') total += 1;
  }
  return total;
}

/** Load a cached playbook for the given url's domain, if any. */
export async function loadPlaybookForUrl(url: string): Promise<Playbook | null> {
  let domain: string;
  try { domain = normalizeDomain(url); }
  catch { return null; }
  const [row] = await db
    .select({ playbook: scraperTargetKnowledge.playbook })
    .from(scraperTargetKnowledge)
    .where(eq(scraperTargetKnowledge.domain, domain));
  const pb = row?.playbook as Playbook | null | undefined;
  if (!pb || (pb.version !== 1 && pb.version !== 2)) return null;
  return pb;
}

/** Upsert a playbook for the domain. Preserves other columns on the row. */
export async function savePlaybook(domain: string, playbook: Playbook): Promise<void> {
  const now = new Date();
  const existing = await db
    .select({ id: scraperTargetKnowledge.id })
    .from(scraperTargetKnowledge)
    .where(eq(scraperTargetKnowledge.domain, domain));
  if (existing.length > 0) {
    await db
      .update(scraperTargetKnowledge)
      .set({ playbook, playbookUpdatedAt: now, updatedAt: now })
      .where(eq(scraperTargetKnowledge.domain, domain));
  } else {
    await db.insert(scraperTargetKnowledge).values({
      domain,
      source: 'site-mapper',
      playbook,
      playbookUpdatedAt: now,
    });
  }
}
