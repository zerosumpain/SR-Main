/**
 * site-mapper.ts — three-phase agent (scout → plan → execute).
 *
 * Runs ONCE per target site. Opens a persistent browser via the Python agent
 * harness and works in three distinct phases:
 *
 *   1. SCOUT (read-only, ~6-8 turns):
 *        LLM can only goto / click nav links / observe — NO fills or submits.
 *        Every page it visits is auto-catalogued: each form's selector +
 *        slot list (including inputs hidden behind collapsed sections) is
 *        recorded. Goal: build a map of candidate search surfaces.
 *
 *   2. PLAN (single LLM call):
 *        Input = the catalogue + user's goal + searchQuery.
 *        The LLM must pick the form that covers the MOST slots the user's
 *        query mentions (not just the first form that exists) and emit a
 *        complete playbook: goto, reveal toggles, fills, submit, extract.
 *
 *   3. EXECUTE (deterministic):
 *        Drive the warm browser session through the plan's steps. Extract
 *        in-session so the first run is already a real scrape.
 *
 * Why three phases instead of one reactive loop: a reactive loop always
 * finalizes on the first submittable form because that's the local maximum.
 * A scout catalogues ALL forms first; the planner then picks the global
 * maximum against the user's slot needs.
 */

import { startAgent, type AgentHarness, type AgentObservation } from './agent-harness';
import {
  extractStepVarNames,
  runPlaybook,
  savePlaybook,
  type Playbook,
  type PlaybookRequiredVar,
  type PlaybookStep,
} from './playbook';
import { normalizeDomain } from './target-knowledge';
import { resolveLLMClient } from '$lib/workflows/nodes/llm-helpers';

const SCOUT_MAX_TURNS = 8;
const MAX_INTERACTIVE_SUMMARY = 5500;
const MAX_CONTENT_GROUPS_SUMMARY = 2000;

export interface SiteMapperOptions {
  seedUrl: string;
  goal: string;
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
  landedUrl?: string;
  transcript: Array<Record<string, unknown>>;
  error?: string;
}

/** One catalogued search surface discovered during scout. */
interface FormCatalogueEntry {
  /** The URL the form was found on. */
  url: string;
  title: string;
  /** Stable selector for the form element. */
  form_selector: string;
  /** Every input/textarea/select the scout saw — including those behind
   *  collapsed panels (tagged with reveal_via so the planner knows what to
   *  click first). */
  slots: Array<{
    name: string;
    type: string;
    label: string;
    selector: string;
    hidden: boolean;
    reveal_via?: { selector: string; text: string | null };
  }>;
  /** Most likely submit target the scout saw. */
  submit: { text: string; selector: string } | null;
  /** Any expandable toggles visible on this page — useful context even if not
   *  attached to a specific form. */
  expandables: Array<{ text: string; selector: string }>;
}

const SCOUT_SYSTEM_PROMPT = `You are a scraping-agent SCOUT. Your job is READ-ONLY exploration of a website to build a catalogue of the available search forms. You have a short turn budget. You do NOT fill fields, submit forms, or extract data in this phase — that happens later once we've picked the best form.

Each turn you receive the current page's URL, title, a text snippet, and a list of interactive elements (forms, buttons, links, expandable sections).

On every turn emit ONE JSON object. No prose, no markdown.

Available actions:
  { "action": "goto",   "url": "https://…", "note": "why" }
  { "action": "click",  "selector": "…", "note": "why" }          — follow a nav link or expand a section
  { "action": "click",  "text": "Advanced search", "note": "…" }  — click by text when no stable selector
  { "action": "altcha", "note": "if you see altcha-widget" }
  { "action": "finalize_scout", "note": "why we're done exploring" }
  { "action": "give_up", "reason": "…" }

Exploration strategy:
  1. On the seed URL, observe what forms are present. Note their slot coverage.
  2. If the page only has a SIMPLE widget (e.g. 2 inputs), find + follow links like "Search jobs", "Advanced search", "All filters", "Browse", "Find a job" that likely lead to a fuller search form.
  3. On any search page, CLICK expandable toggles ("Advanced search", "More filters", "Salary", etc) so their hidden inputs become visible — every visible input gets auto-catalogued.
  4. The SYSTEM automatically catalogues every form + its inputs on every page you visit, including inputs you've revealed via clicks. You DO NOT need to "record" anything manually.
  5. Finalize scout as soon as you've found a form that covers every slot the user's query mentions, OR you've exhausted plausible nav links.

User's goal describes what content to extract. User's searchQuery describes the slots the form must express (keyword, location, distance, salary, contract type, etc). Your scout mission is to find a form that can express ALL of them.

Hints on the observation shape:
  - "kind": "form" entries list inputs. Each input has name/type/label/selector. Hidden inputs are marked { "hidden": true, "reveal_via": { selector, text } } — click reveal_via.selector to expose them.
  - "kind": "expandable" entries are standalone toggles (summary/aria-expanded). Click them to reveal hidden filter sections.
  - "kind": "a" or "button" entries with visible text are nav links / action buttons.`;

const PLAN_SYSTEM_PROMPT = `You are a scraping-agent PLANNER. You are given:
  - The user's goal (what to extract) and searchQuery (the slots to express).
  - A catalogue of every search form discovered on the site, including each form's URL, selector, slot list (with hidden inputs and their reveal-via toggles), and likely submit.

Your job: pick the SINGLE BEST form — the one that exposes the MOST slots the user's searchQuery mentions — and emit a complete playbook that drives through to its results page.

Coverage scoring: enumerate the slots the user's searchQuery mentions (keyword, location, distance/radius, salaryMin, contractType, etc). Score each catalogue entry by how many of those slots it can express (including slots behind reveal_via toggles — those still count, we'll click the toggle first). Prefer the highest-scoring form even if it requires a few extra clicks.

Output: a SINGLE JSON object, no prose, no markdown. Shape:
{
  "version": 2,
  "generatedAt": "generated",
  "goal": "<echo user goal>",
  "requiredVars": [
    { "name": "keyword",   "hint": "<short hint used to decompose future searchQueries>" },
    { "name": "location",  "hint": "…" },
    { "name": "distance",  "hint": "…" }
    /* only include vars whose slot the chosen form actually exposes AND the user's query mentions */
  ],
  "steps": [
    { "type": "goto", "url": "<form's page URL>" },
    { "type": "altcha" },                                        /* omit if site has no altcha */
    { "type": "click", "selector": "<toggle selector>" },        /* for each reveal_via toggle needed */
    { "type": "fill", "selector": "input[name=\\"KEYWORDS\\"]", "value": "{{keyword}}" },
    { "type": "fill", "selector": "input[name=\\"LOCATION\\"]", "value": "{{location}}" },
    { "type": "select", "selector": "select[name=\\"distance\\"]", "value": "{{distance}}" },
    { "type": "submit", "formSelector": "<form selector>" }
  ],
  "extract": [
    { "field": "items", "selector": "<css from content_groups>", "attr": "html", "multi": true, "trim": true }
  ],
  "acceptance": { "minItems": 1, "sampleField": "items" }
}

Rules:
  - Fill values MUST be "{{var}}" placeholders, NEVER concrete values from the user's query — the playbook will be reused across different queries.
  - The first step must be a goto to the chosen form's page.
  - If a slot is hidden behind a reveal_via toggle, prepend a click step for that toggle BEFORE the fill.
  - If a slot is an input[name] that matches a recognisable pattern (salary, salary_min, salaryFrom, salmin, etc), include it in requiredVars with an appropriate name and hint.
  - Only include requiredVars that the chosen form actually exposes AND the user's query references. Don't invent slots.
  - Extract selector MUST come from the catalogue's "content_groups" section on the results page if available; otherwise pick the most result-like repeated class you can see. Prefer short selectors.
  - acceptance.minItems must be ≥ 1.`;

export async function runSiteMapper(opts: SiteMapperOptions): Promise<SiteMapperResult> {
  const domain = normalizeDomain(opts.seedUrl);
  const emit = (ev: Record<string, unknown>) => opts.onProgress?.(ev);
  const transcript: Array<Record<string, unknown>> = [];
  const catalogue = new Map<string, FormCatalogueEntry>();
  const visitedUrls: string[] = [];
  let resultsContentGroups: Array<Record<string, unknown>> = [];

  const agent = await startAgent(opts.profile ?? 'default');
  let inSessionFields: Record<string, unknown> | undefined;
  let inSessionUrl = '';
  let inSessionError: string | undefined;
  let finalPlaybook: Playbook | null = null;
  let giveUpReason: string | undefined;

  try {
    emit({ t: 'map.scout.goto', url: opts.seedUrl });
    await agent.goto(opts.seedUrl);
    visitedUrls.push(opts.seedUrl);
    await agent.altcha().catch(() => ({ solved: false }));

    // ============ SCOUT PHASE ============
    const { client, model } = await resolveLLMClient(opts.model);
    const scoutHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (let turn = 0; turn < SCOUT_MAX_TURNS; turn++) {
      // Auto-solve Altcha on every page — forms sit behind the challenge
      // and aren't rendered into the DOM until it clears. Without this,
      // the catalogue records only the captcha form on gated pages and
      // the planner has nothing real to pick from.
      await agent.altcha().catch(() => ({ solved: false }));
      const obs = await agent.observe();
      recordFormsFromObservation(obs, catalogue);
      // Stash the best content_groups we see in case we land on a results page.
      if (Array.isArray(obs.content_groups) && obs.content_groups.length > 0) {
        resultsContentGroups = obs.content_groups;
      }
      emit({ t: 'map.scout.observe', turn, url: obs.url, catalogueSize: catalogue.size });

      const userMsg = buildScoutMessage(opts.goal, opts.searchQuery, obs, turn, catalogue);
      const reply = await askLLM(client, model, SCOUT_SYSTEM_PROMPT, scoutHistory, userMsg);
      scoutHistory.push({ role: 'user', content: userMsg });
      scoutHistory.push({ role: 'assistant', content: reply });
      transcript.push({ phase: 'scout', turn, url: obs.url, reply });

      let action: Record<string, unknown>;
      try {
        action = extractJson(reply);
      } catch {
        emit({ t: 'map.scout.parse_error', turn, raw: reply.slice(0, 300) });
        scoutHistory.push({
          role: 'user',
          content: 'Your previous message was not valid JSON. Emit exactly one JSON action object.',
        });
        continue;
      }
      emit({ t: 'map.scout.action', turn, action });

      const kind = action.action as string;
      if (kind === 'finalize_scout') break;
      if (kind === 'give_up') {
        giveUpReason = (action.reason as string) || 'scout gave up';
        break;
      }
      try {
        await executeScoutAction(agent, action);
        const cur = await agent.observe().catch(() => null);
        if (cur && !visitedUrls.includes(cur.url)) visitedUrls.push(cur.url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ t: 'map.scout.action_error', turn, err: msg });
        scoutHistory.push({
          role: 'user',
          content: `That action failed: ${msg}\nPick a different link/toggle, or finalize_scout if you have enough.`,
        });
      }
    }

    if (catalogue.size === 0) {
      // Scout saw zero forms — the site may be JS-heavy or a non-search
      // surface. Fail out with the transcript for inspection.
      return failureResult(domain, opts.goal, [], transcript,
        giveUpReason ? `Scout gave up: ${giveUpReason}` : 'Scout found no forms to plan against.');
    }

    // ============ PLAN PHASE ============
    emit({ t: 'map.plan.start', catalogueSize: catalogue.size });
    const planMsg = buildPlanMessage(opts.goal, opts.searchQuery, catalogue, resultsContentGroups);
    const planReply = await askLLM(client, model, PLAN_SYSTEM_PROMPT, [], planMsg);
    transcript.push({ phase: 'plan', reply: planReply });
    emit({ t: 'map.plan.reply', chars: planReply.length });

    try {
      finalPlaybook = coercePlaybook(extractJson(planReply), opts.goal);
    } catch (err) {
      return failureResult(domain, opts.goal, [], transcript,
        `Planner failed to produce a valid playbook: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ============ EXECUTE PHASE ============
    emit({ t: 'map.execute.start', steps: finalPlaybook.steps?.length ?? 0 });
    const liveVars = decomposedForExecution(opts.searchQuery, finalPlaybook.requiredVars ?? []);
    try {
      await executePlaybookSteps(agent, finalPlaybook.steps ?? [], liveVars);
      const r = await agent.extract(finalPlaybook.extract as unknown as Array<Record<string, unknown>>);
      inSessionFields = r.fields;
      inSessionUrl = (await agent.observe().catch(() => null))?.url ?? '';
      emit({ t: 'map.execute.done' });
    } catch (err) {
      inSessionError = err instanceof Error ? err.message : String(err);
      emit({ t: 'map.execute.error', err: inSessionError });
    }
  } finally {
    await agent.close();
  }

  if (!finalPlaybook) {
    return failureResult(domain, opts.goal, [], transcript, giveUpReason ?? 'no playbook produced');
  }

  // Validate: prefer in-session extract (warm session, solved altcha) over a
  // fresh replay. If in-session missed, fall back to replay so we still get
  // a verdict.
  let validated = false;
  let itemCount = 0;
  let firstItemSample: Record<string, unknown> | undefined;
  let error: string | undefined;

  const sampleField = finalPlaybook.acceptance.sampleField;
  const inSessionCount = countFieldItems(inSessionFields, sampleField);
  if (inSessionFields && inSessionCount >= finalPlaybook.acceptance.minItems) {
    validated = true;
    itemCount = inSessionCount;
    firstItemSample = inSessionFields;
  } else {
    const vars: Record<string, string> = opts.searchQuery ? { keyword: opts.searchQuery } : {};
    try {
      const run = await runPlaybook({
        playbook: finalPlaybook,
        vars,
        searchQuery: opts.searchQuery,
        profile: opts.profile ?? 'default',
        workflowRunId: opts.workflowRunId,
      });
      validated = run.acceptanceMet;
      itemCount = run.itemCount;
      if (run.pages[0]) firstItemSample = (run.pages[0] as { fields?: Record<string, unknown> }).fields;
      if (!run.success) error = run.error ?? 'replay failed';
      else if (!validated)
        error = `acceptance not met — expected ≥${finalPlaybook.acceptance.minItems} items in "${sampleField}", got ${itemCount}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  await savePlaybook(domain, finalPlaybook);

  return {
    domain,
    playbook: finalPlaybook,
    validated,
    itemCount,
    firstItemSample,
    landedUrl: inSessionUrl || undefined,
    transcript,
    error: error ?? (inSessionError && !validated ? inSessionError : undefined),
  };
}

/* -------------------- scout helpers -------------------- */

function recordFormsFromObservation(
  obs: AgentObservation,
  catalogue: Map<string, FormCatalogueEntry>,
): void {
  for (const entry of obs.interactive) {
    if ((entry as { kind?: string }).kind !== 'form') continue;
    const formSel = ((entry as { selector?: string }).selector) ?? 'form';
    // Skip altcha-only forms and the captcha form entirely — they're never
    // the scrape target, and if we catalogue them the planner may greedily
    // pick their lone submit as the "easiest" path.
    if (formSel === '#captcha-form' || /captcha|altcha/i.test(formSel)) continue;
    const key = `${obs.url}::${formSel}`;
    const rawInputs = (entry as { inputs?: Array<Record<string, unknown>> }).inputs ?? [];
    const rawSubmits = (entry as { submits?: Array<Record<string, unknown>> }).submits ?? [];
    const slots = rawInputs
      .map((i) => ({
        name: String(i.name ?? ''),
        type: String(i.type ?? i.kind ?? ''),
        label: String(i.label ?? i.placeholder ?? ''),
        selector: String(i.selector ?? ''),
        hidden: i.hidden === true,
        reveal_via: i.reveal_via as { selector: string; text: string | null } | undefined,
      }))
      .filter((s) => s.selector);
    // A form whose only "slot" is an altcha hidden input is still a captcha
    // form in disguise — skip if the whole slot list is junk.
    const realSlots = slots.filter((s) => !/altcha|captcha/i.test(s.name));
    if (realSlots.length === 0) continue;
    const submitRaw = rawSubmits[0] ?? null;
    const submit = submitRaw
      ? { text: String(submitRaw.text ?? ''), selector: String(submitRaw.selector ?? '') }
      : null;
    const expandables = obs.interactive
      .filter((e) => (e as { kind?: string }).kind === 'expandable')
      .map((e) => ({
        text: String((e as { text?: string }).text ?? ''),
        selector: String((e as { selector?: string }).selector ?? ''),
      }));

    // Merge: if we already catalogued this form, prefer the version with MORE
    // slots (scout may have revealed new inputs by clicking a toggle).
    const existing = catalogue.get(key);
    if (!existing || slots.length > existing.slots.length) {
      catalogue.set(key, {
        url: obs.url,
        title: obs.title,
        form_selector: formSel,
        slots,
        submit,
        expandables,
      });
    }
  }
}

function buildScoutMessage(
  goal: string,
  searchQuery: string | undefined,
  obs: AgentObservation,
  turn: number,
  catalogue: Map<string, FormCatalogueEntry>,
): string {
  const interactiveJson = JSON.stringify(obs.interactive, null, 0).slice(0, MAX_INTERACTIVE_SUMMARY);
  const cataloguePreview = Array.from(catalogue.values()).map((e) => ({
    url: e.url,
    form: e.form_selector,
    slots: e.slots.map((s) => ({ name: s.name, label: s.label, hidden: s.hidden || undefined })),
  }));
  return [
    `Scout turn ${turn + 1} / ${SCOUT_MAX_TURNS}.`,
    `User goal: ${goal}`,
    searchQuery ? `User searchQuery (slots to express): "${searchQuery}"` : '',
    `Current URL: ${obs.url}`,
    `Current page title: ${obs.title}`,
    '',
    `Forms catalogued so far (${catalogue.size}):`,
    JSON.stringify(cataloguePreview, null, 0).slice(0, 2500),
    '',
    `Page text snippet:`,
    obs.text_snippet.slice(0, 1200),
    '',
    `Interactive elements on current page:`,
    interactiveJson,
  ].filter(Boolean).join('\n');
}

async function executeScoutAction(agent: AgentHarness, action: Record<string, unknown>): Promise<void> {
  switch (action.action) {
    case 'goto':
      if (typeof action.url !== 'string') throw new Error('goto requires url');
      await agent.goto(action.url);
      return;
    case 'click':
      await agent.click({
        selector: typeof action.selector === 'string' ? action.selector : undefined,
        text: typeof action.text === 'string' ? action.text : undefined,
      });
      return;
    case 'altcha':
      await agent.altcha();
      return;
    default:
      throw new Error(`scout cannot perform action "${String(action.action)}" — only goto/click/altcha allowed.`);
  }
}

/* -------------------- plan helpers -------------------- */

function buildPlanMessage(
  goal: string,
  searchQuery: string | undefined,
  catalogue: Map<string, FormCatalogueEntry>,
  contentGroups: Array<Record<string, unknown>>,
): string {
  const catalogueJson = JSON.stringify(Array.from(catalogue.values()), null, 0).slice(0, 12000);
  const cgJson = JSON.stringify(contentGroups, null, 0).slice(0, MAX_CONTENT_GROUPS_SUMMARY);
  return [
    `User goal: ${goal}`,
    searchQuery ? `User searchQuery: "${searchQuery}"` : '',
    '',
    `Catalogue of forms discovered during scout (${catalogue.size} entries):`,
    catalogueJson,
    '',
    `Results-page content_groups candidates (last seen on any page — use for picking the extract selector):`,
    cgJson,
    '',
    `Emit the final playbook JSON now. Remember: pick the form with the highest slot coverage against the user's searchQuery, parameterise fills with {{var}} placeholders, and include reveal_via click steps before filling hidden inputs.`,
  ].filter(Boolean).join('\n');
}

/* -------------------- execute helpers -------------------- */

async function executePlaybookSteps(
  agent: AgentHarness,
  steps: PlaybookStep[],
  vars: Record<string, string>,
): Promise<void> {
  for (const step of steps) {
    switch (step.type) {
      case 'goto':
        await agent.goto(sub(step.url, vars));
        break;
      case 'wait':
        await agent.wait({ selector: step.selector, ms: step.ms, timeoutMs: step.timeoutMs });
        break;
      case 'click':
        await agent.click({ selector: step.selector, text: step.text });
        break;
      case 'fill':
        await agent.fill(step.selector, sub(step.value, vars));
        break;
      case 'select':
        await agent.select(step.selector, sub(step.value, vars));
        break;
      case 'submit':
        await agent.submit(step.formSelector);
        break;
      case 'altcha':
        await agent.altcha();
        break;
    }
  }
}

function sub(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
  );
}

/** For the validation / first-run execute we need real values to fill in the
 *  form, not `{{keyword}}` literals. Since the executor runs inline with the
 *  user's searchQuery, decompose it once here. */
function decomposedForExecution(
  searchQuery: string | undefined,
  requiredVars: PlaybookRequiredVar[],
): Record<string, string> {
  if (!searchQuery) return {};
  // Lazy simple fallback: assign the whole searchQuery to `keyword` only.
  // For the first-run validation this is fine because the planner will have
  // structured the playbook so `keyword` carries the title; other vars
  // (location/distance/salary) would need the full decomposition LLM call,
  // which the v2 playbook runner already does during a real replay. Here
  // (in-session first-run) we just let the query act as the keyword.
  const out: Record<string, string> = { keyword: searchQuery };
  // If the planner declared any other var AND the user's query contains a
  // plausible literal for it (exact word match on hint keywords), grab it.
  const lower = searchQuery.toLowerCase();
  for (const v of requiredVars) {
    if (v.name === 'keyword') continue;
    const hintTokens = v.hint.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    // Heuristic: if the hint mentions "location" and the query mentions "in <word>",
    // pull that word; similar for "distance" and numbers; for "salary" and
    // numeric over 10k. Kept intentionally narrow — real decomposition lives
    // in playbook.decomposeSearchQuery, which the v2 runner uses on later runs.
    if (hintTokens.some((t) => ['location', 'city', 'town', 'postcode'].includes(t))) {
      const m = searchQuery.match(/\bin\s+([A-Za-z][A-Za-z' -]{1,40})/i);
      if (m) out[v.name] = m[1].trim();
    } else if (hintTokens.some((t) => ['distance', 'radius', 'miles'].includes(t))) {
      const m = lower.match(/(\d{1,3})\s*mi(les)?/);
      if (m) out[v.name] = m[1];
    } else if (hintTokens.some((t) => ['salary', 'pay', 'wage'].includes(t))) {
      const m = lower.match(/(?:over|above|min|from)\s*£?\s*(\d{2,3})\s*k/);
      if (m) out[v.name] = String(parseInt(m[1], 10) * 1000);
    }
  }
  return out;
}

/* -------------------- shared helpers -------------------- */

async function askLLM(
  client: ReturnType<typeof resolveLLMClient> extends Promise<infer T> ? T extends { client: infer C } ? C : never : never,
  model: string,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMsg: string,
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.slice(-8), // cap to last 4 pairs
    { role: 'user' as const, content: userMsg },
  ];
  const resp = await (client as {
    chat: { completions: { create: (args: unknown) => Promise<{ choices: Array<{ message: { content: string | null } }> }> } };
  }).chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: 1600,
  });
  return resp.choices[0]?.message?.content ?? '';
}

function extractJson(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  const str = match ? match[0] : raw;
  return JSON.parse(str) as Record<string, unknown>;
}

function countFieldItems(fields: Record<string, unknown> | undefined, field: string): number {
  if (!fields) return 0;
  const v = fields[field];
  if (Array.isArray(v)) return v.length;
  if (v != null && v !== '') return 1;
  return 0;
}

function failureResult(
  domain: string,
  goal: string,
  steps: PlaybookStep[],
  transcript: Array<Record<string, unknown>>,
  error: string,
): SiteMapperResult {
  return {
    domain,
    playbook: {
      version: 2,
      generatedAt: new Date().toISOString(),
      goal,
      steps,
      extract: [],
      acceptance: { minItems: 1, sampleField: 'items' },
    },
    validated: false,
    itemCount: 0,
    transcript,
    error,
  };
}

function coercePlaybook(v: unknown, goal: string): Playbook {
  if (!v || typeof v !== 'object') throw new Error('planner returned no playbook object');
  const p = v as Record<string, unknown>;
  const stepsRaw = Array.isArray(p.steps) ? p.steps : [];
  const steps: PlaybookStep[] = stepsRaw
    .map(coerceStep)
    .filter((s): s is PlaybookStep => s !== null);
  if (steps.length === 0) throw new Error('planner produced no steps');
  if (steps[0].type !== 'goto') throw new Error('first step must be a goto');

  const extractRaw = Array.isArray(p.extract) ? p.extract : [];
  if (extractRaw.length === 0) throw new Error('planner produced no extract rules');
  const extract = extractRaw.map(coerceExtractRule);

  const accRaw = (p.acceptance && typeof p.acceptance === 'object')
    ? p.acceptance as { minItems?: number; sampleField?: string }
    : {};
  const sampleField = accRaw.sampleField ?? extract.find((r) => r.multi)?.field ?? extract[0].field;
  const minItems = Math.max(1, typeof accRaw.minItems === 'number' ? accRaw.minItems : 1);

  const declaredRaw = Array.isArray(p.requiredVars) ? p.requiredVars : [];
  const declared: PlaybookRequiredVar[] = declaredRaw
    .map(coerceRequiredVar)
    .filter((v): v is PlaybookRequiredVar => v !== null);
  const usedInSteps = new Set(extractStepVarNames(steps));
  const byName = new Map<string, PlaybookRequiredVar>();
  for (const v of declared) if (usedInSteps.has(v.name)) byName.set(v.name, v);
  for (const name of usedInSteps) if (!byName.has(name)) byName.set(name, { name, hint: name });
  const requiredVars = Array.from(byName.values());

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    goal: typeof p.goal === 'string' ? p.goal : goal,
    steps,
    requiredVars: requiredVars.length > 0 ? requiredVars : undefined,
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

function coerceRequiredVar(v: unknown): PlaybookRequiredVar | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name) return null;
  return {
    name: r.name,
    hint: typeof r.hint === 'string' && r.hint ? r.hint : r.name,
    fallback: typeof r.fallback === 'string' ? r.fallback : undefined,
  };
}
