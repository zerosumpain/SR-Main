/**
 * playbook-runner-v2.ts
 *
 * Deterministic replay for Playbook v2 — executes the recorded navigation
 * steps through site-mapper-agent.py, then applies the extract rules on
 * whatever page the sequence landed on. Shared by site-mapper validation
 * and stealth-scrape's playbook dispatch.
 */

import { startAgent } from './agent-harness';
import {
  decomposeSearchQuery,
  extractStepVarNames,
  interpolateVars,
  type Playbook,
  type PlaybookRequiredVar,
  type PlaybookStep,
  type RunPlaybookOptions,
  type RunPlaybookResult,
} from './playbook';
import { db } from '$lib/db';
import { scraperRunLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export async function runPlaybookV2(opts: RunPlaybookOptions): Promise<RunPlaybookResult> {
  const { playbook, vars: callerVars = {}, searchQuery, profile = 'default', workflowRunId, onProgress, model } = opts;
  const steps: PlaybookStep[] = playbook.steps ?? [];

  // Resolve vars: caller-supplied trump everything, then fill gaps via
  // decomposition of searchQuery when the playbook declares requiredVars
  // (or we can infer them from `{{…}}` placeholders in the steps).
  const declared = playbook.requiredVars ?? [];
  const inferred: PlaybookRequiredVar[] = declared.length === 0
    ? extractStepVarNames(steps).map((name) => ({ name, hint: name }))
    : declared;
  const missing = inferred.filter((v) => !(v.name in callerVars) || !callerVars[v.name]);
  let decomposed: Record<string, string> = {};
  if (missing.length > 0 && searchQuery) {
    onProgress?.({ t: 'playbook.decompose.start', vars: missing.map((v) => v.name) });
    decomposed = await decomposeSearchQuery({
      searchQuery,
      requiredVars: missing,
      model,
      onDebug: (ev) => onProgress?.({ t: 'playbook.decompose.debug', ...ev }),
    }).catch(() => ({}));
    onProgress?.({ t: 'playbook.decompose.done', resolved: Object.keys(decomposed) });
  }
  // Apply fallbacks last for any slots still blank.
  const fallbacks: Record<string, string> = {};
  for (const v of inferred) {
    if (v.fallback && !(v.name in callerVars) && !(v.name in decomposed)) {
      fallbacks[v.name] = v.fallback;
    }
  }
  // Last-resort fallback: if `keyword` is STILL missing (decomposition
  // returned empty AND no literal fallback), salvage a sensible value from
  // the raw searchQuery. Without this the fill would send "{{keyword}}"
  // verbatim and time out. Other slots are left unresolved — better to
  // submit a partial form than to hallucinate a location.
  if (
    searchQuery
    && inferred.some((v) => v.name === 'keyword')
    && !callerVars.keyword
    && !decomposed.keyword
    && !fallbacks.keyword
  ) {
    fallbacks.keyword = firstMeaningfulToken(searchQuery);
    onProgress?.({ t: 'playbook.decompose.keyword_fallback', value: fallbacks.keyword });
  }
  const vars: Record<string, string> = { ...fallbacks, ...decomposed, ...callerVars };

  const seedUrl = firstGotoUrl(steps, vars) ?? '';

  const [logRow] = await db.insert(scraperRunLog).values({
    url: seedUrl,
    profile,
    workflowRunId: workflowRunId ?? null,
  }).returning();

  const agent = await startAgent(profile);
  let landedUrl = '';
  let error: string | undefined;
  let fields: Record<string, unknown> = {};
  let success = false;

  try {
    for (const step of steps) {
      onProgress?.({ t: 'playbook.step', step });
      switch (step.type) {
        case 'goto': {
          const url = interpolateVars(step.url, vars);
          const r = await agent.goto(url);
          landedUrl = r.url;
          break;
        }
        case 'wait': {
          await agent.wait({ selector: step.selector, ms: step.ms, timeoutMs: step.timeoutMs });
          break;
        }
        case 'click': {
          const r = await agent.click({ selector: step.selector, text: step.text });
          landedUrl = r.url || landedUrl;
          break;
        }
        case 'fill': {
          const value = interpolateVars(step.value, vars);
          await agent.fill(step.selector, value);
          break;
        }
        case 'select': {
          await agent.select(step.selector, step.value);
          break;
        }
        case 'submit': {
          const r = await agent.submit(step.formSelector);
          landedUrl = r.url || landedUrl;
          break;
        }
        case 'altcha': {
          await agent.altcha();
          break;
        }
        default:
          // Unknown step type — ignore so future additions don't crash old runners.
          break;
      }
    }

    // Apply extract rules on the final page.
    onProgress?.({ t: 'playbook.extract' });
    const extractResult = await agent.extract(playbook.extract as unknown as Array<Record<string, unknown>>);
    fields = extractResult.fields;
    success = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    onProgress?.({ t: 'playbook.error', error });
  } finally {
    await agent.close();
  }

  await db.update(scraperRunLog).set({
    endedAt: new Date(),
    success,
    pagesLoaded: success ? 1 : 0,
    error: error ?? null,
  }).where(eq(scraperRunLog.id, logRow.id));

  // ExtractedPage requires fields typed as Record<string, string|string[]>;
  // the agent's extract rules honour that contract (text/html/attr → string,
  // multi → string[]) so the cast is safe.
  const page = success
    ? { url: landedUrl, fields: fields as Record<string, string | string[]> }
    : null;
  const pages = page ? [page] : [];
  const itemCount = success ? countItems(fields, playbook) : 0;

  return {
    success,
    pages,
    error,
    runLogId: logRow.id,
    acceptanceMet: itemCount >= playbook.acceptance.minItems,
    itemCount,
  };
}

/** Shared with site-mapper — extract a reasonable keyword token from a
 *  free-form query when decomposition returns nothing. */
function firstMeaningfulToken(q: string): string {
  const stop = new Set(['the','a','an','in','at','on','of','for','with','and','or','to','near','within','around','over','above','under','below','from','by']);
  const cap = q.match(/^\s*([A-Z][a-zA-Z-]+(?:\s+[A-Z][a-zA-Z-]+){0,2})/);
  if (cap) return cap[1].trim();
  for (const tok of q.split(/\s+/)) {
    const clean = tok.replace(/[^a-zA-Z-]/g, '');
    if (clean.length > 2 && !stop.has(clean.toLowerCase())) return clean;
  }
  return q.slice(0, 30).trim();
}

function firstGotoUrl(steps: PlaybookStep[], vars: Record<string, string>): string | null {
  for (const s of steps) if (s.type === 'goto') return interpolateVars(s.url, vars);
  return null;
}

function countItems(fields: Record<string, unknown>, playbook: Playbook): number {
  const val = fields[playbook.acceptance.sampleField];
  if (Array.isArray(val)) return val.length;
  if (val != null && val !== '') return 1;
  return 0;
}
