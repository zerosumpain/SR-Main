/**
 * script-author.ts — first-run authoring loop.
 *
 * Spawns the agent harness and lets an LLM iteratively draft a Python
 * scrape function for the target domain. Tools the LLM can call each turn:
 *
 *   view_page(url?)     → observe the current page (or goto then observe).
 *   try_script(code)    → run the code (with sample vars) inside the warm
 *                         Playwright session. Returns items + stdout/stderr/
 *                         error. The page state PERSISTS — clicks/cookies
 *                         from one try_script carry into the next.
 *   save_script(code, declaredVars) → persist to disk; returns success.
 *   give_up(reason)
 *
 * The LLM iterates: write a draft → run it → see what broke → fix → re-run
 * → save when items come back ≥1. Cap at MAX_TURNS turns to prevent runaway
 * spend on hopeless sites.
 */

import { startAgent, type AgentHarness } from './agent-harness';
import { writeScript, type ScriptMeta } from './script-store';
import { decomposeSearchQuery } from './playbook';
import { resolveLLMClient } from '$lib/workflows/nodes/llm-helpers';
import { normalizeDomain } from './target-knowledge';

const MAX_TURNS = 12;
const MAX_OBS_INTERACTIVE = 4500;
const MAX_OBS_TEXT = 1200;

export interface AuthorScriptOptions {
  /** Domain identifier the script lives under. */
  profile: string;
  seedUrl: string;
  goal: string;
  /** Natural-language search criteria the script should be able to consume. */
  searchQuery?: string;
  /** Optional names of vars the user expects (e.g. ["keyword","location"]).
   *  The LLM will declare these in the saved meta so the runtime decomposer
   *  knows what to fill. */
  varsHint?: string[];
  model?: string;
  workflowRunId?: string;
  onProgress?: (ev: Record<string, unknown>) => void;
}

export interface AuthorScriptResult {
  saved: boolean;
  /** The final script body (for inspection / display) — may be partial if
   *  authoring failed. */
  code: string;
  declaredVars: Array<{ name: string; hint: string }>;
  /** First items the script returned when validated. */
  sampleItems: Array<Record<string, unknown>>;
  transcript: Array<Record<string, unknown>>;
  error?: string;
}

const SYSTEM_PROMPT = `You are an autonomous browser-scraping author. You have control of a live headless Chromium session via tools, and your job is to write a working Python scrape function for a given website. You iterate: view the page, draft code, run it, see what failed, fix, re-run. When the script reliably extracts the items the user wants, you save it.

Each turn emit ONE JSON object. No prose, no markdown.

Tools:
  { "tool": "view_page", "url": "https://…" }            // optional url; omit to observe current page
  { "tool": "try_script", "code": "<python body>" }      // runs your draft. Page state persists across calls.
  { "tool": "save_script", "code": "<final body>", "declaredVars": [ { "name": "keyword", "hint": "…" }, … ] }
  { "tool": "give_up", "reason": "…" }

CODE CONVENTIONS for try_script / save_script:
  - The code is the BODY of an "async def scrape(page, vars):" function. \`page\` is a live Playwright Page already bound to the session. \`vars\` is a dict of strings the runtime supplies (e.g. vars["keyword"]).
  - Use \`await page.goto(...)\`, \`await page.fill(...)\`, \`await page.click(...)\`, \`await page.locator(...)\` etc. Standard Playwright async API.
  - Always return a list of dicts: \`return [{"title": "...", "url": "...", ...}, ...]\`. Empty list on no results.
  - Wrap risky calls in try/except — if a selector might not exist, gracefully skip.
  - Use \`vars.get("keyword", "")\` not \`vars["keyword"]\` so missing slots don't KeyError.
  - Altcha / captcha: the harness auto-solves Altcha after every \`await page.goto(...)\`. You don't need to do anything special. If a submit (instead of a goto) triggers a fresh challenge, call \`await solve_altcha()\` — that helper is injected into your scope. Do NOT write your own altcha logic.
  - print() output IS captured and shown back to you in the next turn's try_script result. Use it to inspect page contents while iterating (\`print(await page.locator(".x").count())\`, \`print(html[:500])\` etc). Captured to ~3KB — keep prints small.
  - For listings/search-result pages: collect URLs of detail pages first, THEN loop over them with await page.goto(url) inside a try/except. Use the SAME page object — don't open new contexts.
  - Returning \`return []\` is treated as failure. Only return [] from the FINAL save_script when the page genuinely has zero results. While iterating, return whatever items you DO have and use prints to debug.

STRATEGY:
  1. view_page on the seed URL. Look at interactive elements + content groups in the observation. Note input names, form selectors, content classes.
  2. Draft a minimal scrape that just goes to a results page and extracts. try_script it.
  3. If error / 0 items: read the stderr, look at observed_url, view the page again if needed, fix selectors, try again.
  4. When the script returns ≥1 well-shaped item, save_script with the final code + the vars list you actually use.

The user's goal describes what each ITEM should contain. The user's searchQuery is the kind of input the script must accept (decomposed into vars by the runtime). Declare a var for each input field your script fills — typically one or more of: keyword, location, distance, salary, contractType. Use hints that describe what each var's value looks like.`;

export async function runScriptAuthor(opts: AuthorScriptOptions): Promise<AuthorScriptResult> {
  const emit = (ev: Record<string, unknown>) => opts.onProgress?.(ev);
  const transcript: Array<Record<string, unknown>> = [];

  // Pre-decompose the searchQuery using the user's varsHint so the LLM can
  // try_script with realistic values from turn 1. If no hint is given, just
  // pass the whole searchQuery as `keyword`.
  const sampleVars = await initialSampleVars(opts.searchQuery, opts.varsHint, opts.model);
  emit({ t: 'author.start', sampleVars: Object.keys(sampleVars) });

  const agent = await startAgent(opts.profile);
  let savedCode = '';
  let savedDeclaredVars: Array<{ name: string; hint: string }> = [];
  let sampleItems: Array<Record<string, unknown>> = [];
  let saveOk = false;
  let giveUp: string | undefined;

  try {
    // Initial goto so the LLM's first view_page lands on something real.
    await agent.goto(opts.seedUrl);
    await agent.altcha().catch(() => ({ solved: false }));

    const { client, model } = await resolveLLMClient(opts.model);
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    let lastTryStderr = '';
    let lastTryError: string | null = null;
    let lastTryItems: Array<Record<string, unknown>> = [];
    let lastTryUrl = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const userMsg = buildAuthorMessage({
        turn,
        goal: opts.goal,
        searchQuery: opts.searchQuery,
        sampleVars,
        lastTryStderr,
        lastTryError,
        lastTryItems,
        lastTryUrl,
      });

      const reply = await askLLM(client, model, history, userMsg);
      history.push({ role: 'user', content: userMsg });
      history.push({ role: 'assistant', content: reply });
      transcript.push({ turn, reply });

      let action: Record<string, unknown>;
      try {
        action = extractJson(reply);
      } catch {
        emit({ t: 'author.parse_error', turn });
        history.push({ role: 'user', content: 'Your previous message was not valid JSON. Emit ONE tool call object and nothing else.' });
        continue;
      }

      const tool = action.tool as string;
      emit({ t: 'author.action', turn, tool });
      console.log(`[script-author ${opts.profile}] turn ${turn + 1}/${MAX_TURNS} → ${tool}`);

      if (tool === 'view_page') {
        const url = typeof action.url === 'string' ? action.url : null;
        try {
          if (url) {
            await agent.goto(url);
            await agent.altcha().catch(() => ({ solved: false }));
          }
          const obs = await agent.observe();
          history.push({
            role: 'user',
            content: formatObservation(obs),
          });
          transcript.push({ turn, observed: obs.url });
        } catch (e) {
          history.push({ role: 'user', content: `view_page failed: ${e instanceof Error ? e.message : String(e)}` });
        }
      } else if (tool === 'try_script') {
        const code = String(action.code ?? '');
        if (!code.trim()) {
          history.push({ role: 'user', content: 'try_script needs a non-empty `code` field.' });
          continue;
        }
        try {
          const r = await agent.execScript(code, sampleVars, 180_000);
          lastTryStderr = r.stderr;
          lastTryError = r.error;
          lastTryItems = r.items;
          lastTryUrl = r.observed_url;
          // Solve any altcha that appeared during the script run.
          await agent.altcha().catch(() => ({ solved: false }));
          emit({ t: 'author.try_result', turn, items: r.items.length, error: r.error });
          console.log(`[script-author ${opts.profile}] try → items=${r.items.length} error=${r.error ?? 'none'} url=${r.observed_url}`);
          if (r.stderr) console.log(`[script-author ${opts.profile}] stderr (last 500): ${r.stderr.slice(-500)}`);
          history.push({
            role: 'user',
            content: formatTryResult(r),
          });
          transcript.push({ turn, try: { items: r.items.length, error: r.error, url: r.observed_url } });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          history.push({ role: 'user', content: `try_script harness error: ${msg}` });
        }
      } else if (tool === 'save_script') {
        const code = String(action.code ?? '');
        const declared = Array.isArray(action.declaredVars)
          ? (action.declaredVars as Array<{ name?: unknown; hint?: unknown }>)
              .map((v) => ({
                name: typeof v.name === 'string' ? v.name : '',
                hint: typeof v.hint === 'string' ? v.hint : '',
              }))
              .filter((v) => v.name)
          : [];
        if (!code.trim()) {
          history.push({ role: 'user', content: 'save_script needs a non-empty `code` field.' });
          continue;
        }
        // Validate one last time before persisting.
        emit({ t: 'author.save_validate' });
        const r = await agent.execScript(code, sampleVars, 180_000);
        if (r.error || r.items.length === 0) {
          history.push({
            role: 'user',
            content: `save_script blocked: validation run produced ${r.items.length} items / error=${r.error ?? 'none'}. Fix and try_script again before saving.`,
          });
          continue;
        }
        savedCode = code;
        savedDeclaredVars = declared.length > 0 ? declared : Object.keys(sampleVars).map((k) => ({ name: k, hint: k }));
        sampleItems = r.items.slice(0, 3);
        const meta: Omit<ScriptMeta, 'profile'> = {
          goal: opts.goal,
          seedUrl: opts.seedUrl,
          declaredVars: savedDeclaredVars,
          generatedAt: new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
          runCount: 1,
          successCount: 1,
        };
        await writeScript(opts.profile, savedCode, meta);
        saveOk = true;
        emit({ t: 'author.saved', items: sampleItems.length });
        break;
      } else if (tool === 'give_up') {
        giveUp = (action.reason as string) || 'no reason';
        break;
      } else {
        history.push({ role: 'user', content: `Unknown tool "${tool}". Use view_page / try_script / save_script / give_up.` });
      }
    }
  } finally {
    await agent.close();
  }

  // Always dump the full transcript to disk for post-mortem debugging,
  // regardless of save outcome. Successful or failed, the file lets us
  // inspect what the LLM tried turn-by-turn.
  try {
    const { promises: fs } = await import('fs');
    const { SCRIPT_DIR } = await import('./script-store');
    const { join } = await import('path');
    const dir = SCRIPT_DIR;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, `${opts.profile}.author-log.json`),
      JSON.stringify({
        savedOk: saveOk,
        savedCode,
        savedDeclaredVars,
        sampleItemsCount: sampleItems.length,
        giveUp,
        transcript,
      }, null, 2),
      'utf8',
    );
  } catch { /* non-fatal */ }

  return {
    saved: saveOk,
    code: savedCode,
    declaredVars: savedDeclaredVars,
    sampleItems,
    transcript,
    error: saveOk ? undefined : (giveUp ? `LLM gave up: ${giveUp}` : `No save in ${MAX_TURNS} turns`),
  };
}

function formatObservation(obs: { url: string; title: string; text_snippet: string; interactive: Array<Record<string, unknown>>; content_groups: Array<Record<string, unknown>> }): string {
  return [
    `view_page result:`,
    `URL: ${obs.url}`,
    `Title: ${obs.title}`,
    `Text snippet:`,
    obs.text_snippet.slice(0, MAX_OBS_TEXT),
    ``,
    `Interactive (form inputs / buttons / links):`,
    JSON.stringify(obs.interactive, null, 0).slice(0, MAX_OBS_INTERACTIVE),
    ``,
    `Content groups (repeated DOM patterns — useful for picking item selectors):`,
    JSON.stringify(obs.content_groups, null, 0).slice(0, 1500),
  ].join('\n');
}

function formatTryResult(r: { items: Array<Record<string, unknown>>; stdout: string; stderr: string; error: string | null; observed_url: string }): string {
  const itemPreview = r.items.length > 0
    ? JSON.stringify(r.items.slice(0, 3), null, 2).slice(0, 1500)
    : '(none)';
  return [
    `try_script result:`,
    `items: ${r.items.length}`,
    r.error ? `error: ${r.error}` : `error: none`,
    `final url: ${r.observed_url}`,
    r.stdout ? `stdout (last 3000 chars — your print() output):\n${r.stdout.slice(-3000)}` : '',
    r.stderr ? `stderr (last 2000 chars):\n${r.stderr.slice(-2000)}` : '',
    `first items (max 3):\n${itemPreview}`,
  ].filter(Boolean).join('\n');
}

function buildAuthorMessage(args: {
  turn: number;
  goal: string;
  searchQuery: string | undefined;
  sampleVars: Record<string, string>;
  lastTryStderr: string;
  lastTryError: string | null;
  lastTryItems: Array<Record<string, unknown>>;
  lastTryUrl: string;
}): string {
  // First turn: full briefing. Subsequent turns: short reminder + last result
  // (already in history).
  if (args.turn === 0) {
    return [
      `Turn 1 / ${MAX_TURNS}.`,
      `Goal: ${args.goal}`,
      args.searchQuery ? `User searchQuery: "${args.searchQuery}"` : '',
      `Sample vars the runtime would supply for try_script: ${JSON.stringify(args.sampleVars)}`,
      ``,
      `Start by calling view_page (no url) to see the current page (the harness has already navigated to the seed URL).`,
    ].filter(Boolean).join('\n');
  }
  return [
    `Turn ${args.turn + 1} / ${MAX_TURNS}.`,
    `Reminder: goal = ${args.goal}`,
    `Pick your next tool call.`,
  ].join('\n');
}

async function askLLM(
  client: ReturnType<typeof resolveLLMClient> extends Promise<infer T> ? T extends { client: infer C } ? C : never : never,
  model: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMsg: string,
): Promise<string> {
  const tail = history.slice(-12);
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...tail,
    { role: 'user' as const, content: userMsg },
  ];
  const resp = await (client as {
    chat: { completions: { create: (args: unknown) => Promise<{ choices: Array<{ message: { content: string | null } }> }> } };
  }).chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: 2400,
  });
  return resp.choices[0]?.message?.content ?? '';
}

function extractJson(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  const str = match ? match[0] : raw;
  return JSON.parse(str) as Record<string, unknown>;
}

async function initialSampleVars(
  searchQuery: string | undefined,
  varsHint: string[] | undefined,
  model: string | undefined,
): Promise<Record<string, string>> {
  if (!searchQuery) return {};
  if (varsHint && varsHint.length > 0) {
    const requiredVars = varsHint.map((name) => ({ name, hint: name }));
    const decomposed = await decomposeSearchQuery({ searchQuery, requiredVars, model }).catch(() => ({}));
    return Object.keys(decomposed).length > 0
      ? decomposed
      : { [varsHint[0]]: firstWord(searchQuery) };
  }
  // No hint — best-effort: pass the searchQuery as `keyword`.
  return { keyword: firstWord(searchQuery) };
}

function firstWord(s: string): string {
  const m = s.match(/^\s*([A-Z][a-zA-Z-]+(?:\s+[A-Z][a-zA-Z-]+){0,2})/);
  if (m) return m[1].trim();
  const w = s.trim().split(/\s+/)[0] ?? '';
  return w.replace(/[^a-zA-Z0-9-]/g, '');
}

// normalizeDomain re-export so callers don't need a separate import for the
// profile-derivation convention used elsewhere in the scraper stack.
export { normalizeDomain };
