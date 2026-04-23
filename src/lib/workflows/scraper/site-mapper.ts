/**
 * site-mapper.ts
 *
 * LLM-driven generator for scraper playbooks. Runs ONCE per domain (manually
 * or when a stealth-scrape run fails with acceptance-not-met), producing a
 * deterministic recipe that subsequent unattended runs use without another
 * LLM call.
 *
 * v1 approach — single-shot:
 *   1. Scrape the seed URL once to get the landing HTML + resolved URL.
 *   2. Hand the HTML + goal + domain to an LLM, ask for a Playbook JSON.
 *   3. Validate by running the playbook in a fresh headless browser and
 *      checking the acceptance test.
 *   4. If valid, save to scraper_target_knowledge.playbook.
 *
 * This skips click/fill step sequences for now. If a site needs form
 * submission beyond query-string params, the mapper will probably fail its
 * own acceptance check and surface the failure — a later v2 adds an
 * interactive agentic loop (tool-calling with click/fill/observe primitives).
 */

import { runScrape } from './runner';
import {
  runPlaybook,
  savePlaybook,
  type Playbook,
} from './playbook';
import { normalizeDomain } from './target-knowledge';
import { resolveLLMClient } from '$lib/workflows/nodes/llm-helpers';

const MAX_HTML_CHARS = 12000;

export interface SiteMapperOptions {
  /** URL the mapper navigates to for landing-page analysis. Usually the
   *  search/form page of the target site. */
  seedUrl: string;
  /** Natural-language description of what the scraper should extract
   *  (e.g. "data engineer job listings with title, organisation, salary,
   *  closing date, and link"). */
  goal: string;
  /** Optional search query to substitute into the playbook's urlTemplate
   *  during acceptance validation. If omitted, the LLM-generated urlTemplate
   *  is assumed to be usable as-is. */
  searchQuery?: string;
  /** Profile to use for the initial observation + validation. */
  profile?: string;
  /** Optional model override (anything resolveLLMClient accepts). */
  model?: string;
  workflowRunId?: string;
  onProgress?: (ev: Record<string, unknown>) => void;
}

export interface SiteMapperResult {
  domain: string;
  playbook: Playbook;
  /** True when the generated playbook passed its own acceptance test. */
  validated: boolean;
  itemCount: number;
  firstItemSample?: Record<string, unknown>;
  /** Error message if validation failed — the playbook is still saved so
   *  the user can inspect + edit it manually. */
  error?: string;
}

const SYSTEM_PROMPT = `You are a scraper-playbook generator. Given the landing-page HTML of a target website and a description of what the user wants to extract, output a JSON playbook that future unattended scrapes will follow deterministically.

Rules:
- Output ONLY a single JSON object. No markdown fences. No prose.
- The JSON must match this TypeScript type:
  interface Playbook {
    version: 1;
    generatedAt: string;   // ISO timestamp — you can set it to "generated"
    goal: string;          // echo back the user goal
    urlTemplate: string;   // prefer a direct results URL with query-string params; use {{keyword}} for the search term
    waitFor?:
      | { type: "networkidle" }
      | { type: "selector"; selector: string; timeoutMs?: number }
      | { type: "timeout"; ms: number };
    extract: Array<{
      field: string;        // output field name (camelCase)
      selector: string;     // CSS selector
      attr?: "text" | "html" | "href" | "src" | string;
      multi?: boolean;      // true when the selector matches many items
      trim?: boolean;
    }>;
    pagination?: { type: "next-link"; nextSelector: string; maxPages: number };
    acceptance: { minItems: number; sampleField: string };  // which extract field to count, min items expected
  }
- Prefer a direct URL with query-string params (e.g. ?q={{keyword}}) over a form-submission flow — v1 does not execute form clicks.
- For list/result pages, the primary extract rule should be \`multi: true\` over the item container selector (use attr:"html" so downstream nodes can parse the nested structure), and \`acceptance.sampleField\` should name that multi field with minItems >= 1.
- Include additional per-item field rules alongside — but only if the selector reliably targets ONE item's child. When in doubt, emit the multi container only.
- Be specific with selectors; avoid overly generic ones like \`div\` or \`a\`.`;

export async function runSiteMapper(opts: SiteMapperOptions): Promise<SiteMapperResult> {
  const domain = normalizeDomain(opts.seedUrl);
  const emit = (ev: Record<string, unknown>) => opts.onProgress?.(ev);

  emit({ t: 'map.observe', url: opts.seedUrl });
  // 1. Observe the landing page — a standard scrape with extract: "page"
  //    gives us the full rendered HTML after Altcha auto-solve + any initial
  //    redirects.
  const landing = await runScrape({
    url: opts.seedUrl,
    profile: opts.profile ?? 'default',
    waitFor: { type: 'networkidle' },
    extract: [] as unknown as Array<Record<string, unknown>> as never,
    workflowRunId: opts.workflowRunId,
    onProgress: (e) => emit({ t: 'map.landing.progress', ...e }),
  });
  if (!landing.success || landing.pages.length === 0) {
    throw new Error(
      `Site-mapper could not load ${opts.seedUrl}: ${landing.error ?? 'unknown'}`,
    );
  }
  // Re-fetch with html snapshot — runScrape with empty-array extract returns
  // just {url, fields:{}}. Call again with "page" shorthand resolver (handled
  // by scrape.py's resolve_extract) via a direct cast.
  const htmlLanding = await runScrape({
    url: opts.seedUrl,
    profile: opts.profile ?? 'default',
    waitFor: { type: 'networkidle' },
    extract: 'page' as unknown as never,
    workflowRunId: opts.workflowRunId,
  });
  const firstPage = htmlLanding.pages[0] as {
    url?: string;
    fields?: { html?: string; title?: string; url?: string };
  } | undefined;
  const fullHtml = firstPage?.fields?.html ?? '';
  const landedUrl = firstPage?.fields?.url ?? firstPage?.url ?? opts.seedUrl;
  const pageTitle = firstPage?.fields?.title ?? '';

  const htmlForLlm = pruneHtmlForLlm(fullHtml).slice(0, MAX_HTML_CHARS);

  // 2. Ask the LLM for a Playbook.
  emit({ t: 'map.llm.request', bytes: htmlForLlm.length });
  const { client, model } = await resolveLLMClient(opts.model);
  const userPrompt = [
    `Domain: ${domain}`,
    `Landed URL: ${landedUrl}`,
    `Page title: ${pageTitle}`,
    `Goal: ${opts.goal}`,
    opts.searchQuery ? `Search query (for urlTemplate substitution): ${opts.searchQuery}` : '',
    '',
    'Landing page HTML (pruned):',
    htmlForLlm,
  ].filter(Boolean).join('\n');

  // Some OpenAI-compatible providers (older z.ai deployments) reject the
  // response_format hint with 400. Try with, fall back without so the mapper
  // survives on any provider the admin has configured.
  async function callLlm(withJsonFormat: boolean) {
    return await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1200,
      ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    });
  }
  let completion;
  try {
    completion = await callLlm(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/response_format|json_object|unsupported|400/i.test(msg)) {
      emit({ t: 'map.llm.retry', reason: 'response_format unsupported', provider: model });
      completion = await callLlm(false);
    } else {
      throw err;
    }
  }
  const raw = completion.choices[0]?.message?.content ?? '';
  emit({ t: 'map.llm.response', bytes: raw.length, model });

  // Extract the first { … } block in case the provider returned prose around
  // the JSON (common when response_format isn't honoured).
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Site-mapper LLM did not return valid JSON (model=${model}): ${err instanceof Error ? err.message : String(err)}. Raw: ${raw.slice(0, 300)}`,
    );
  }
  const playbook = coercePlaybook(parsed, opts.goal);

  // 3. Validate — run the playbook in a fresh headless browser against the
  //    supplied searchQuery (or no vars if none).
  emit({ t: 'map.validate.start' });
  const vars: Record<string, string> = opts.searchQuery ? { keyword: opts.searchQuery } : {};
  let validated = false;
  let itemCount = 0;
  let firstItemSample: Record<string, unknown> | undefined;
  let validationError: string | undefined;
  try {
    const run = await runPlaybook({
      playbook,
      vars,
      profile: opts.profile ?? 'default',
      workflowRunId: opts.workflowRunId,
      onProgress: (e) => emit({ t: 'map.validate.progress', ...e }),
    });
    validated = run.acceptanceMet;
    itemCount = run.itemCount;
    if (run.pages[0]) {
      firstItemSample = (run.pages[0] as { fields?: Record<string, unknown> }).fields;
    }
    if (!run.success) {
      validationError = run.error ?? 'scrape reported failure';
    } else if (!validated) {
      validationError = `acceptance test failed — expected at least ${playbook.acceptance.minItems} items in field "${playbook.acceptance.sampleField}", got ${itemCount}`;
    }
  } catch (err) {
    validationError = err instanceof Error ? err.message : String(err);
  }

  // 4. Save. We save even when validation fails so the user can inspect + edit.
  await savePlaybook(domain, playbook);
  emit({ t: 'map.saved', domain, validated });

  return {
    domain,
    playbook,
    validated,
    itemCount,
    firstItemSample,
    error: validationError,
  };
}

/** Prune HTML for LLM context: drop <script>, <style>, <svg>, <noscript>,
 *  comments, long class attribute soup. Keeps enough structure for the LLM
 *  to pick selectors. */
function pruneHtmlForLlm(html: string): string {
  if (!html) return '';
  let out = html;
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>');
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Collapse excess whitespace
  out = out.replace(/\s+/g, ' ');
  return out;
}

function coercePlaybook(value: unknown, goal: string): Playbook {
  if (!value || typeof value !== 'object') {
    throw new Error('LLM playbook output is not an object');
  }
  const v = value as Record<string, unknown>;
  const urlTemplate = typeof v.urlTemplate === 'string' ? v.urlTemplate : '';
  if (!urlTemplate) throw new Error('LLM playbook missing urlTemplate');
  const extractRaw = Array.isArray(v.extract) ? v.extract : [];
  if (extractRaw.length === 0) throw new Error('LLM playbook has no extract rules');
  const extract = extractRaw.map(coerceExtractRule);
  const acceptance = (v.acceptance && typeof v.acceptance === 'object')
    ? v.acceptance as { minItems?: number; sampleField?: string }
    : {};
  const sampleField = acceptance.sampleField ?? extract.find((r) => r.multi)?.field ?? extract[0].field;
  const minItems = typeof acceptance.minItems === 'number' ? acceptance.minItems : 1;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    goal: typeof v.goal === 'string' ? v.goal : goal,
    urlTemplate,
    waitFor: coerceWaitFor(v.waitFor),
    extract,
    pagination: coercePagination(v.pagination),
    acceptance: { minItems, sampleField },
  };
}

function coerceExtractRule(v: unknown): Playbook['extract'][number] {
  if (!v || typeof v !== 'object') throw new Error('extract rule is not an object');
  const r = v as Record<string, unknown>;
  if (typeof r.field !== 'string' || !r.field) throw new Error('extract rule missing field');
  if (typeof r.selector !== 'string' || !r.selector) throw new Error('extract rule missing selector');
  return {
    field: r.field,
    selector: r.selector,
    attr: (typeof r.attr === 'string' ? r.attr : 'text') as Playbook['extract'][number]['attr'],
    multi: !!r.multi,
    trim: r.trim === false ? false : true,
  };
}

function coerceWaitFor(v: unknown): Playbook['waitFor'] {
  if (!v || typeof v !== 'object') return { type: 'networkidle' };
  const r = v as Record<string, unknown>;
  const t = r.type;
  if (t === 'selector' && typeof r.selector === 'string') {
    return {
      type: 'selector',
      selector: r.selector,
      timeoutMs: typeof r.timeoutMs === 'number' ? r.timeoutMs : undefined,
    };
  }
  if (t === 'timeout' && typeof r.ms === 'number') {
    return { type: 'timeout', ms: r.ms };
  }
  return { type: 'networkidle' };
}

function coercePagination(v: unknown): Playbook['pagination'] {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (r.type === 'next-link' && typeof r.nextSelector === 'string') {
    return {
      type: 'next-link',
      nextSelector: r.nextSelector,
      maxPages: typeof r.maxPages === 'number' ? r.maxPages : 5,
    };
  }
  return undefined;
}
