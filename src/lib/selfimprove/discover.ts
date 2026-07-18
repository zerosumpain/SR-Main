// src/lib/selfimprove/discover.ts
//
// DISCOVER phase. For the top unmet needs, try the existing catalogue first
// (api_search); if nothing good is catalogued, do ONE web-research call, ask the
// gateway to propose a concrete API entry, and register it (api_register runs a
// live SSRF-guarded probe, so registration IS the verification). All tool calls
// go through the site-tool registry — `api_search`/`api_register` operate as
// actor `jkai` internally, which has catalogue write access.

import { errMsg, type QuestionInsights, type RunAction, type SeedApiEntry } from './types';
import type { Budget } from './run';

const MAX_NEEDS = 3;

function needText(need: unknown): string {
  return typeof need === 'string' ? need : String((need as { intent?: string })?.intent ?? need ?? '');
}

interface SearchApiHit {
  status?: string;
}

function catalogueAlreadyServes(searchData: unknown): boolean {
  const apis = (searchData as { apis?: SearchApiHit[] } | undefined)?.apis;
  if (!Array.isArray(apis) || apis.length === 0) return false;
  return apis.some((a) => (a.status ?? 'seeded') !== 'broken');
}

function buildProposeMessages(
  need: string,
  webResults: unknown,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are an integrations engineer. Given an unmet data need and some web-search results, propose ONE concrete, ' +
    'PUBLIC, no-auth (or clearly documented) HTTP API that could satisfy it. Respond with ONLY a JSON object: ' +
    '{"name": string, "baseUrl": string, "docsUrl": string, "description": string, "capabilities": string[], ' +
    '"tags": string[], "auth": {"kind":"none"} | {"kind":"bearer-env","envVar":string} | {"kind":"header-env","envVar":string,"header":string}, ' +
    '"exampleRequests": [{"label": string, "method": "GET", "url": string}]}. ' +
    'The exampleRequests urls MUST start with baseUrl and be safe GET requests. Prefer no-auth APIs. ' +
    'If no suitable real public API exists, respond with {"none": true}. No prose outside the JSON.';
  const user = `Unmet need: ${need}\n\nWeb search results:\n${JSON.stringify(webResults, null, 2).slice(0, 6000)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function coerceCandidate(json: unknown): SeedApiEntry | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (o.none === true) return null;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl.trim() : '';
  if (!name || !/^https?:\/\//i.test(baseUrl)) return null;
  const auth = o.auth && typeof o.auth === 'object' ? (o.auth as SeedApiEntry['auth']) : { kind: 'none' as const };
  const examples = Array.isArray(o.exampleRequests)
    ? o.exampleRequests
        .filter((e) => e && typeof e === 'object' && typeof (e as { url?: unknown }).url === 'string')
        .map((e) => {
          const ex = e as Record<string, unknown>;
          return {
            label: ex.label ? String(ex.label) : undefined,
            method: 'GET',
            url: String(ex.url),
          };
        })
        .slice(0, 3)
    : [];
  return {
    name,
    baseUrl,
    docsUrl: typeof o.docsUrl === 'string' ? o.docsUrl : undefined,
    description: typeof o.description === 'string' ? o.description : '',
    capabilities: Array.isArray(o.capabilities) ? o.capabilities.slice(0, 8).map(String) : [],
    tags: Array.isArray(o.tags) ? o.tags.slice(0, 8).map(String) : [],
    auth,
    exampleRequests: examples,
  };
}

/** DISCOVER: search catalogue → web research → propose → register (with probe). */
export async function discoverApis(
  insights: QuestionInsights | undefined,
  budget: Budget,
): Promise<RunAction[]> {
  const actions: RunAction[] = [];
  const needs = (insights?.topUnmet ?? []).map(needText).filter(Boolean).slice(0, MAX_NEEDS);
  if (needs.length === 0) return actions;

  const { executeTool } = await import('$lib/workflows/site-tools/registry');

  for (const need of needs) {
    try {
      // 1. Catalogue first.
      const search = await executeTool('api_search', { query: need });
      if (search.success && catalogueAlreadyServes(search.data)) {
        actions.push({ kind: 'insight', detail: `"${need}" already covered by a catalogued API` });
        continue;
      }

      // 2. ONE web-research call for candidates.
      let webResults: unknown = null;
      try {
        const web = await executeTool('research_web_search', {
          query: `public JSON HTTP API for ${need}`,
        });
        webResults = web.success ? web.data : null;
      } catch (err) {
        console.error('[selfimprove] web search failed:', errMsg(err));
      }
      if (!webResults) {
        actions.push({ kind: 'proposal', detail: `Find a data source for: ${need}` });
        continue;
      }

      // 3. Propose a concrete entry (ONE gateway call), then register it. The
      //    register tool runs a live probe, so this verifies as a side effect.
      const { json } = await budget.call(buildProposeMessages(need, webResults), { maxTokens: 3000 });
      const candidate = coerceCandidate(json);
      if (!candidate) {
        actions.push({ kind: 'proposal', detail: `No public API found for: ${need}` });
        continue;
      }

      const reg = await executeTool('api_register', { entry: candidate });
      if (reg.success) {
        const status = (reg.data as { status?: string } | undefined)?.status ?? 'candidate';
        actions.push({
          kind: status === 'verified' ? 'api_verified' : 'api_registered',
          detail: `${candidate.name} → ${status} (for "${need}")`,
        });
      } else {
        actions.push({ kind: 'proposal', detail: `Register API for "${need}": ${reg.error ?? 'failed'}` });
      }
    } catch (err) {
      // A single need failing must not sink the whole phase.
      console.error('[selfimprove] discover need failed:', errMsg(err));
      actions.push({ kind: 'proposal', detail: `Investigate data source for: ${need}` });
    }
  }

  return actions;
}
