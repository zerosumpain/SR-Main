/**
 * site-mapper.ts — agentic version.
 *
 * Runs ONCE per target site. Opens a persistent browser session via the
 * Python agent harness, feeds observations to an LLM, and takes the minimum
 * number of actions needed to reach the page that satisfies `goal`.
 *
 * LOOP:
 *   1. Agent navigates to seedUrl (site root), observes, Altcha-auto-solve.
 *   2. Send the observation + goal + transcript to the LLM. LLM emits a
 *      single JSON `action` (goto/click/fill/submit/altcha/finalize/give_up).
 *   3. Execute the action via the agent; record it in the transcript.
 *   4. Repeat until the LLM emits `finalize` (with extract rules +
 *      acceptance) or hits the step cap (MAX_STEPS).
 *   5. Validate by replaying the recorded step sequence through
 *      runPlaybookV2 and checking the acceptance test. Save either way.
 *
 * The LLM never picks up the phone — it sees only summarised observations,
 * never raw HTML, so we stay well within context budgets and keep the LLM
 * focused on the goal.
 */

import { startAgent, type AgentHarness, type AgentObservation } from './agent-harness';
import {
  runPlaybook,
  savePlaybook,
  type Playbook,
  type PlaybookStep,
} from './playbook';
import { normalizeDomain } from './target-knowledge';
import { resolveLLMClient } from '$lib/workflows/nodes/llm-helpers';

// Generous step cap — altcha + observe turns burn headroom quickly on
// multi-step form sites (CS Jobs takes ~7 steps: goto, altcha, fill,
// submit, refine-distance, re-submit, observe-results). 12 was the first
// pass; 20 gives the agent room to recover from a wrong turn or two.
const MAX_STEPS = 20;
const MAX_INTERACTIVE_SUMMARY = 6500; // chars of observe summary sent to LLM

export interface SiteMapperOptions {
  /** Root / landing URL of the target site (e.g. "https://example.com"). */
  seedUrl: string;
  /** Plain-English description of the outcome the scraper should produce —
   *  e.g. "search for data engineer jobs and return the first page of results
   *  with title, organisation, salary, closing date, job URL". */
  goal: string;
  /** Optional — seeded as {{keyword}} during validation so the LLM can
   *  produce a playbook that generalises per-run. */
  searchQuery?: string;
  profile?: string;
  model?: string;
  workflowRunId?: string;
  onProgress?: (ev: Record<string, unknown>) => void;
}

export interface SiteMapperResult {
  domain: string;
  playbook: Playbook;
  validated: boolean;
  itemCount: number;
  firstItemSample?: Record<string, unknown>;
  transcript: Array<Record<string, unknown>>;
  error?: string;
}

const SYSTEM_PROMPT = `You are a scraping-agent pilot. You have control of a live headless browser. You will be fed the current page's URL, title, text snippet, and a list of interactive elements (forms, buttons, links) on each turn. Your job is to navigate MINIMALLY to reach the page that answers the user's goal, then emit a playbook.

Rules:
- Output a SINGLE JSON object per turn. No prose, no markdown.
- SELECTOR STABILITY IS CRITICAL. The playbook runs again in a fresh browser session on schedule, so every selector you pick must match on ANY future session. Prefer, in order:
    1. [name="..."] attribute (most stable on form inputs)
    2. Text content via { "text": "..." } for clicks (not selectors)
    3. Stable ids (e.g. #search_form) WITHOUT random-looking suffixes
    4. tag + a meaningful class (e.g. button.search-submit)
  AVOID: ids with trailing hex suffixes like "#oselect_title_50f4" or random numeric tails — those are regenerated per session and will break the playbook on replay. If the observation only exposes an unstable id, look at the element's name/text/class and use that instead.
- EXTRACT SELECTORS MUST COME FROM content_groups. Each observation includes a "content_groups" list — real repeated-element patterns detected on the live DOM with their selector, count, and sample text. When you finalize, pick your extract rule's selector from one of those. Do NOT guess selectors like "#search-results li" or ".job-list" — those rarely exist. If content_groups is empty, the page isn't a results page yet; navigate further before finalizing.
- Valid JSON shapes:
  { "action": "goto",   "url": "https://…", "note": "why" }
  { "action": "click",  "selector": "…",   "note": "why" }
  { "action": "fill",   "selector": "…", "value": "…", "note": "why" }
  { "action": "select", "selector": "…", "value": "…", "note": "why" }
  { "action": "submit", "formSelector": "form.search-form", "note": "why" }  // formSelector optional — omit to press Enter on the focused element
  { "action": "altcha",  "note": "auto-solve altcha if the widget is present" }
  { "action": "finalize", "playbook": { … }, "note": "we're on the page that contains the goal data" }
  { "action": "give_up", "reason": "…" }
- Prefer direct goto() with query-string params over form fill/submit when the site supports it — shorter playbooks are more robust.
- Use fill({{keyword}}) for the search term so the playbook generalises per-run. Example: { "action":"fill", "selector":"input[name=q]", "value":"{{keyword}}" }.
- Call altcha whenever you see an altcha-widget in the interactive list.
- Finalize the moment you can see the target data on the page — do NOT click into individual detail pages unless the goal requires them.

When you finalize, the playbook's "steps" array must START WITH a { "type": "goto", "url": "…" } for the seedUrl (the replay starts from an empty browser — it has no idea what page to land on without this) and then contain the minimum sequence of subsequent actions that reach the results page. acceptance.minItems must be ≥ 1 — you're proving the playbook actually extracts data, so 0 is not acceptable. The playbook shape:
{
  "version": 2,
  "generatedAt": "<iso timestamp — literal string 'generated'>",
  "goal": "<echo the user goal>",
  "steps": [ /* the action sequence (minus the finalize itself) — objects with { "type": "goto"|"click"|"fill"|"select"|"submit"|"altcha"|"wait", ... } */ ],
  "extract": [
    { "field": "items", "selector": "<css>", "attr": "html", "multi": true, "trim": true }
    /* plus optional per-item field rules if you're confident; otherwise the items-html multi is enough, downstream stealth-scrape-llm can parse it */
  ],
  "acceptance": { "minItems": 1, "sampleField": "items" }
}
The step shapes inside "steps" use "type" (not "action"): { "type":"goto","url":"…" }, { "type":"click","selector":"…" }, etc.`;

export async function runSiteMapper(opts: SiteMapperOptions): Promise<SiteMapperResult> {
  const domain = normalizeDomain(opts.seedUrl);
  const emit = (ev: Record<string, unknown>) => opts.onProgress?.(ev);
  const transcript: Array<Record<string, unknown>> = [];

  const agent = await startAgent(opts.profile ?? 'default');
  const recordedSteps: PlaybookStep[] = [];
  let finalPlaybook: Playbook | null = null;
  let giveUpReason: string | undefined;

  // During the mapping loop we substitute {{keyword}} (etc.) with the real
  // searchQuery so the site actually returns real results to observe. The
  // playbook SAVES the pre-substitution template, so replay keeps the
  // generalisable form.
  const liveVars: Record<string, string> = opts.searchQuery ? { keyword: opts.searchQuery } : {};

  try {
    emit({ t: 'map.goto', url: opts.seedUrl });
    const first = await agent.goto(opts.seedUrl);
    recordedSteps.push({ type: 'goto', url: opts.seedUrl });
    transcript.push({ type: 'goto', url: opts.seedUrl, result: first });

    // Auto-altcha if the widget is on the landing page.
    await agent.altcha().catch(() => ({ solved: false }));

    const { client, model } = await resolveLLMClient(opts.model);
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (let turn = 0; turn < MAX_STEPS; turn++) {
      const obs = await agent.observe();
      const userMsg = buildUserMessage(opts.goal, opts.searchQuery, obs, turn);
      emit({ t: 'map.observe', turn, url: obs.url });

      const reply = await askLLM(client, model, history, userMsg);
      history.push({ role: 'user', content: userMsg });
      history.push({ role: 'assistant', content: reply });
      transcript.push({ turn, observation: { url: obs.url, title: obs.title }, reply });

      let action: Record<string, unknown>;
      try {
        action = extractJson(reply);
      } catch (err) {
        emit({ t: 'map.parse_error', turn, raw: reply.slice(0, 400), err: String(err) });
        history.push({
          role: 'user',
          content: 'Your previous message was not valid JSON. Emit ONE JSON object matching the action schema and nothing else.',
        });
        continue;
      }
      emit({ t: 'map.action', turn, action });

      const kind = action.action as string;
      if (kind === 'finalize') {
        finalPlaybook = coercePlaybook(action.playbook, opts.goal, recordedSteps);
        break;
      }
      if (kind === 'give_up') {
        giveUpReason = (action.reason as string) || 'llm gave up';
        break;
      }

      // Execute the action via the agent, then record it into the step sequence.
      try {
        await executeAction(agent, action, liveVars);
        const step = actionToStep(action);
        if (step) recordedSteps.push(step);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ t: 'map.action_error', turn, err: msg });
        history.push({
          role: 'user',
          content: `That action failed: ${msg}\nTry a different approach or give_up.`,
        });
      }
    }

  } finally {
    await agent.close();
  }

  // If the LLM didn't finalize, return a structured failure result WITH the
  // transcript instead of throwing — the transcript is the only way to
  // diagnose why the agent didn't reach the results page, and throwing
  // would drop it on the floor (node_executions.output_data stays null on
  // thrown executions).
  if (!finalPlaybook) {
    return {
      domain,
      playbook: {
        version: 2,
        generatedAt: new Date().toISOString(),
        goal: opts.goal,
        steps: recordedSteps,
        extract: [],
        acceptance: { minItems: 1, sampleField: 'items' },
      },
      validated: false,
      itemCount: 0,
      transcript,
      error: giveUpReason
        ? `LLM gave up: ${giveUpReason}`
        : `LLM ran ${MAX_STEPS} turns without finalizing — see transcript below for each turn's action.`,
    };
  }

  // Validate via a fresh replay through runPlaybook (v2 path).
  emit({ t: 'map.validate' });
  const vars: Record<string, string> = opts.searchQuery ? { keyword: opts.searchQuery } : {};
  let validated = false;
  let itemCount = 0;
  let firstItemSample: Record<string, unknown> | undefined;
  let error: string | undefined;
  try {
    const run = await runPlaybook({
      playbook: finalPlaybook,
      vars,
      profile: opts.profile ?? 'default',
      workflowRunId: opts.workflowRunId,
      onProgress: (e) => emit({ t: 'map.validate.progress', ...e }),
    });
    validated = run.acceptanceMet;
    itemCount = run.itemCount;
    if (run.pages[0]) firstItemSample = (run.pages[0] as { fields?: Record<string, unknown> }).fields;
    if (!run.success) error = run.error ?? 'replay failed';
    else if (!validated)
      error = `acceptance not met — expected ≥${finalPlaybook.acceptance.minItems} items in "${finalPlaybook.acceptance.sampleField}", got ${itemCount}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Save either way so the user can inspect + tweak failing playbooks.
  await savePlaybook(domain, finalPlaybook);

  return {
    domain,
    playbook: finalPlaybook,
    validated,
    itemCount,
    firstItemSample,
    transcript,
    error,
  };
}

function buildUserMessage(
  goal: string,
  searchQuery: string | undefined,
  obs: AgentObservation,
  turn: number,
): string {
  const interactiveJson = JSON.stringify(obs.interactive, null, 0).slice(0, MAX_INTERACTIVE_SUMMARY);
  const contentGroupsJson = JSON.stringify(obs.content_groups, null, 0).slice(0, 2500);
  return [
    `Turn ${turn + 1} / ${MAX_STEPS}.`,
    `User goal: ${goal}`,
    searchQuery ? `Search query the playbook should parameterise on ({{keyword}}): "${searchQuery}"` : '',
    `Current URL: ${obs.url}`,
    `Current page title: ${obs.title}`,
    '',
    'Page text snippet:',
    obs.text_snippet.slice(0, 1500),
    '',
    'Interactive elements (JSON):',
    interactiveJson,
    '',
    'Repeated-content clusters on this page (use these to pick extract selectors when you finalize — these are the real classes used by list/card containers on the live DOM):',
    contentGroupsJson,
  ].filter(Boolean).join('\n');
}

async function askLLM(
  client: ReturnType<typeof resolveLLMClient> extends Promise<infer T> ? T extends { client: infer C } ? C : never : never,
  model: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMsg: string,
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...history,
    { role: 'user' as const, content: userMsg },
  ];
  const resp = await (client as {
    chat: { completions: { create: (args: unknown) => Promise<{ choices: Array<{ message: { content: string | null } }> }> } };
  }).chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: 800,
  });
  return resp.choices[0]?.message?.content ?? '';
}

function extractJson(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  const str = match ? match[0] : raw;
  return JSON.parse(str) as Record<string, unknown>;
}

async function executeAction(
  agent: AgentHarness,
  action: Record<string, unknown>,
  vars: Record<string, string>,
): Promise<void> {
  const sub = (s: string): string => {
    // Replace {{var}} placeholders in the value the LLM is actively sending
    // to the browser. The playbook records the ORIGINAL templated value
    // (good — the playbook generalises per-run), but during the mapping
    // loop we want to see real data so the page actually returns results
    // — otherwise the LLM sees "0 Search results" for the literal
    // "{{keyword}}" string and thrashes trying to fix it.
    return s.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
    );
  };
  switch (action.action) {
    case 'goto': {
      if (typeof action.url !== 'string') throw new Error('goto requires url');
      await agent.goto(sub(action.url));
      return;
    }
    case 'click': {
      await agent.click({
        selector: typeof action.selector === 'string' ? action.selector : undefined,
        text: typeof action.text === 'string' ? sub(action.text) : undefined,
      });
      return;
    }
    case 'fill': {
      if (typeof action.selector !== 'string' || typeof action.value !== 'string') {
        throw new Error('fill requires selector + value');
      }
      await agent.fill(action.selector, sub(action.value));
      return;
    }
    case 'select': {
      if (typeof action.selector !== 'string' || typeof action.value !== 'string') {
        throw new Error('select requires selector + value');
      }
      await agent.select(action.selector, action.value);
      return;
    }
    case 'submit': {
      await agent.submit(typeof action.formSelector === 'string' ? action.formSelector : undefined);
      return;
    }
    case 'altcha': {
      await agent.altcha();
      return;
    }
    case 'wait': {
      await agent.wait({
        selector: typeof action.selector === 'string' ? action.selector : undefined,
        ms: typeof action.ms === 'number' ? action.ms : undefined,
      });
      return;
    }
    default:
      throw new Error(`unknown action: ${JSON.stringify(action.action)}`);
  }
}

function actionToStep(action: Record<string, unknown>): PlaybookStep | null {
  switch (action.action) {
    case 'goto':
      return { type: 'goto', url: action.url as string };
    case 'click':
      return {
        type: 'click',
        selector: typeof action.selector === 'string' ? action.selector : undefined,
        text: typeof action.text === 'string' ? action.text : undefined,
      };
    case 'fill':
      return { type: 'fill', selector: action.selector as string, value: action.value as string };
    case 'select':
      return { type: 'select', selector: action.selector as string, value: action.value as string };
    case 'submit':
      return {
        type: 'submit',
        formSelector: typeof action.formSelector === 'string' ? action.formSelector : undefined,
      };
    case 'altcha':
      return { type: 'altcha' };
    case 'wait':
      return {
        type: 'wait',
        selector: typeof action.selector === 'string' ? action.selector : undefined,
        ms: typeof action.ms === 'number' ? action.ms : undefined,
      };
    default:
      return null;
  }
}

function coercePlaybook(v: unknown, goal: string, fallbackSteps: PlaybookStep[]): Playbook {
  if (!v || typeof v !== 'object') throw new Error('LLM finalize had no playbook object');
  const p = v as Record<string, unknown>;
  const stepsRaw = Array.isArray(p.steps) ? p.steps : [];
  const llmSteps: PlaybookStep[] = stepsRaw
    .map(coerceStep)
    .filter((s): s is PlaybookStep => s !== null);

  // If the LLM's steps don't start with a goto, prepend the initial goto we
  // recorded at the top of the agent loop. LLMs often forget the seedUrl
  // navigation because from their perspective it was "already done" — but
  // replay starts from an empty session, so the playbook MUST include it.
  let effectiveSteps: PlaybookStep[] = llmSteps.length > 0 ? llmSteps : fallbackSteps;
  if (effectiveSteps.length > 0 && effectiveSteps[0].type !== 'goto') {
    const firstGoto = fallbackSteps.find((s) => s.type === 'goto');
    if (firstGoto) effectiveSteps = [firstGoto, ...effectiveSteps];
  }

  const extractRaw = Array.isArray(p.extract) ? p.extract : [];
  if (extractRaw.length === 0) throw new Error('LLM playbook has no extract rules');
  const extract = extractRaw.map(coerceExtractRule);
  const accRaw = (p.acceptance && typeof p.acceptance === 'object')
    ? p.acceptance as { minItems?: number; sampleField?: string }
    : {};
  const sampleField = accRaw.sampleField ?? extract.find((r) => r.multi)?.field ?? extract[0].field;
  // Clamp minItems to ≥1 — LLMs sometimes write 0 to guarantee the
  // acceptance test passes, which defeats the test. An extraction with
  // zero matching items is never a useful successful scrape.
  const requestedMin = typeof accRaw.minItems === 'number' ? accRaw.minItems : 1;
  const minItems = Math.max(1, requestedMin);
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    goal: typeof p.goal === 'string' ? p.goal : goal,
    steps: effectiveSteps,
    extract,
    acceptance: { minItems, sampleField },
  };
}

function coerceStep(v: unknown): PlaybookStep | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const t = s.type;
  if (t === 'goto' && typeof s.url === 'string') return { type: 'goto', url: s.url };
  if (t === 'click') return {
    type: 'click',
    selector: typeof s.selector === 'string' ? s.selector : undefined,
    text: typeof s.text === 'string' ? s.text : undefined,
  };
  if (t === 'fill' && typeof s.selector === 'string' && typeof s.value === 'string') {
    return { type: 'fill', selector: s.selector, value: s.value };
  }
  if (t === 'select' && typeof s.selector === 'string' && typeof s.value === 'string') {
    return { type: 'select', selector: s.selector, value: s.value };
  }
  if (t === 'submit') {
    return { type: 'submit', formSelector: typeof s.formSelector === 'string' ? s.formSelector : undefined };
  }
  if (t === 'altcha') return { type: 'altcha' };
  if (t === 'wait') return {
    type: 'wait',
    selector: typeof s.selector === 'string' ? s.selector : undefined,
    ms: typeof s.ms === 'number' ? s.ms : undefined,
  };
  return null;
}

function coerceExtractRule(v: unknown): Playbook['extract'][number] {
  if (!v || typeof v !== 'object') throw new Error('extract rule is not an object');
  const r = v as Record<string, unknown>;
  if (typeof r.field !== 'string') throw new Error('extract rule missing field');
  if (typeof r.selector !== 'string') throw new Error('extract rule missing selector');
  return {
    field: r.field,
    selector: r.selector,
    attr: (typeof r.attr === 'string' ? r.attr : 'text') as Playbook['extract'][number]['attr'],
    multi: !!r.multi,
    trim: r.trim === false ? false : true,
  };
}
