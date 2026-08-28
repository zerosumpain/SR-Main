import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { listWorkspaceFiles } from './sandbox';
import { emitLog, emitLive } from './log-emitter';
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
import { formatBriefForPrompt, type ResearchBrief } from './research-brief';

// --- System Prompts ---

const PROPOSER_SYSTEM_PROMPT = `You are a senior software architect creating a project delivery plan. You produce plans only — no code.

Given a project objective, write a delivery plan covering:
- Architecture: technology choices, key components, data flow
- UI Design: layout approach, design system choices, key screens and interactions
- Iteration Plan: 3-5 iterations starting with a WALKING SKELETON
- For each iteration: goal, deliverables, milestone (what the user sees), and tests

CONSTRAINTS YOUR PLAN MUST RESPECT:
1. FULL-STACK ALLOWED: The agent runs on a Linux host with Python 3.12, Node 22, Playwright (already installed — do NOT plan an npm-install step for it), curl, ripgrep, internet access, and root permissions in its workspace. Servers (Flask, FastAPI, Express, Hono, Next.js, plain http.server) are all supported — the host reverse-proxies the chosen port to the user's browser. Pick whichever stack best serves the objective; static sites are fine, backends are fine. Reuse what's already on the host — every reinstall is time the user spends staring at "Iteration 1".
2. REAL DATA ONLY: Every data source must be real. Name the specific API, dataset, or scraping target (e.g., Open-Meteo, REST Countries, Wikipedia API, government open-data portals). Never propose placeholder or hardcoded data unless it's explicitly a demo feature the user can edit.
3. WALKING SKELETON FIRST — non-negotiable: Iteration 1 is the absolute minimum that runs end-to-end. NOT a feature slice. NOT "core data model + auth + first view". It is: a serve.json + the smallest file (or two) that the start command needs + a "Hello from <project name>" page that boots, returns 200, and proves the deployment loop works. Aim for under 10 minutes of agent time. The user should see a clickable preview link before they finish a coffee.
4. ITERATION SIZING: After iteration 1 (skeleton), each subsequent iteration adds ONE coherent user-visible capability — e.g. "the calculator can add two numbers and show the result", then "the calculator can graph y = expr(x)". Frame each as a single feature, not a laundry list. ~30 minutes wall-clock cap. The project should fit in roughly 3-5 iterations total. If you find yourself wanting iteration 1 to do more than the skeleton, push everything else into iteration 2.
5. SERVING MODEL: The agent writes a serve.json declaring its start command and port. Any TCP server binding 0.0.0.0 on the assigned port works. Long-lived background workers, WebSockets, and in-memory state are all permitted.

Format your response as:

## Architecture
(tech stack, components, data flow — 3-5 sentences)

## UI Design
(layout approach, design system, key screens — 3-5 sentences)

## Iteration Plan

### Iteration 1: [title]
- Goal: [one sentence]
- Deliverables: [bullet list]
- Tests: [what to test]
- Milestone: [what the user sees at the end]

### Iteration 2: [title]
(same format — through Iteration 5)

## Risks & Mitigations
(2-3 key risks and how to handle them)`;

const CRITIC_SYSTEM_PROMPT = `You are a rigorous technical reviewer stress-testing a project delivery plan. Your job is to find real problems, not to validate. Be specific — cite the exact part of the plan that is problematic.

Evaluate the proposed plan across these dimensions:

1. SERVING MODEL: Does the plan specify a concrete start command and port that the sandbox reverse-proxy can hit? Look for: missing serve.json plan, ambiguous tech stack choice, routes that rely on assumptions the sandbox doesn't support (e.g. OAuth callbacks to unknown hostnames). Flag each with "VIOLATION:" and explain what needs to change.

2. DATA SOURCING: Are all proposed APIs real, public, and CORS-accessible from a browser? Look for: vague descriptions ("use an API"), APIs requiring server-side auth, APIs with CORS restrictions without proxy support, placeholder data. For each questionable source, suggest a specific replacement with a concrete API URL.

3. WALKING-SKELETON: Is iteration 1 the absolute bare minimum that runs and serves a 200 — and nothing more? Look for: iteration 1 sneaking in feature work, iteration 1 specifying a data model or framework setup beyond the bare minimum, iteration 1 asking the agent to "scaffold X with auth + Y + Z". Any iteration 1 that takes more than 10 agent-minutes to deliver is wrong. Flag with "BLOATED-SKELETON:" and rewrite as: serve.json + minimum index file + boot the server + "Hello from <name>" placeholder. Push everything else into iteration 2.
4. ITERATION SCOPING: Does each iteration AFTER the skeleton map to ONE coherent user-visible capability the agent can deliver end-to-end in ~30 minutes? Look for: laundry-list iterations ("add X, Y, Z, refactor W"), unclear acceptance criteria ("polish the UI" isn't a scope), hidden cross-iteration dependencies. Flag fragmented iterations with "FRAGMENTED:" (split into multiple features jammed together) or "VAGUE:" (no checkable definition of done) and rewrite them as single-capability slices.

5. TECHNICAL FEASIBILITY: Are the technology choices viable on a Linux host with Python 3.12, Node 22, Playwright pre-installed, and internet access? Look for: packages requiring native compilation, UI frameworks needing a build step without one, plans that propose REINSTALLING capabilities the host already provides (Playwright, Chromium, ripgrep, common npm/pip libs), unnecessarily complex patterns. Flag each with "INFEASIBLE:" or "REINSTALL-WASTE:" and explain what won't work or what to reuse instead.

6. USER EXPERIENCE: Is the proposed UI genuinely compelling, or is it a generic dashboard/list page? Look for: lack of visual identity, no interactive elements beyond basic filtering, missing animations or transitions, no clear design inspiration, cookie-cutter layouts that any AI would produce. Flag bland designs with "BLAND:" and suggest specific ways to make the experience more distinctive and engaging — a unique visual concept, a memorable interaction pattern, an unexpected layout approach.

7. INNOVATION: Is the approach creative or just the obvious solution? Look for: standard CRUD patterns where something more inventive would serve the user better, missed opportunities for visualisation or storytelling, generic data displays when the data could be presented in a novel way. Flag missed opportunities with "OBVIOUS:" and suggest a more ambitious or creative alternative that would make this project genuinely interesting.

End your review with:

## Summary of Issues
(numbered list of critical problems, ranked by severity)

## Recommended Changes
(concrete, actionable fixes for each critical issue — specific replacements, not vague suggestions)`;

// --- Studio mode: chapter-spine planning ---
//
// A Studio build (origin === 'studio') plans a multi-chapter interactive
// explainer instead of a generic delivery plan. It swaps in these prompts —
// see planBuild's isStudio branch — and additionally persists the parsed
// chapter table onto jkai_builds.chapterPlan once the debate concludes.

export const STUDIO_PROPOSER_SYSTEM_PROMPT = `You are designing an interactive explainer — a multi-chapter learning experience about one subject. You produce plans only, no code.

You are given a research brief. Every chapter must be grounded in it.

This is a FIELD STUDY. The system it is built against is mounted at ./explainer-kit/field-study/ — nine templates, a fixed beat arc, and a ship gate. Read its TEMPLATES.md and README.md before you plan. The arc, always in this order, always numbered:

| 01 the problem | what is being claimed, and by whom? |
| 02 the estate & evidence | what exists today, and how do we know? |
| 03 the options | what are the ways to do it, and who has tried them? |
| 04 the recommendation | which one, and why that one? |
| 05 what it does & who wins | who is better off, who is worse off? |
| 06 trust & safeguards | what could go wrong, and what stops it? |
| 07 what happens next | what would change the picture, and when? |

You may merge two beats and you may rename them to the subject freely — the QUESTIONS are what is fixed. You may not reorder them or add an eighth.

Every beat carries: ONE question printed at the top; ONE claim answering it, with a confidence of exactly \`fact\`, \`hypothesis\` or \`contested\`; a "so what" in the author's voice; and an open question WITH a falsifier — the thing that would change the author's mind. The front matter states the study's three findings BEFORE beat 01: a study that withholds its conclusions to build suspense reads as a tour of the author's notes.

At least one claim in the study must be a \`hypothesis\`. A study whose every claim is a fact is not being honest about its own reasoning.

CONSTRAINTS YOUR PLAN MUST RESPECT:
1. 6-10 chapters. Each is a real route the reader can link to.
2. Every chapter has ONE idea and follows explain → manipulate → consequence: say what the thing is, let the reader change something, show them what that did.
3. Sequence so each chapter can only be understood after the last. A workable spine: what the thing is → what drives it → the mechanism in the middle → what happens when you push it → where it breaks → what is genuinely uncertain. The final chapter names the brief's GAPS honestly.
4. Each chapter names its visual mode from the explainer kit: createScene (spatial/allocation), createDiagram (mechanisms and flow), createSim (levers and consequence), createChart (over time or across categories). Do not use a 3D scene for a time series.
5. Iteration 1 is the skeleton ONLY: serve.json, navigation shell, every chapter reachable with its title and a one-line placeholder. Then one complete chapter per iteration.
6. Real data only, named from the brief's LIVE DATA section.

Format your response as:

## Concept
(what the reader will be able to do at the end that they cannot do now — 2-3 sentences)

## Architecture
(stack, routing, how chapters are served — 3-5 sentences)

## Chapter Plan

| # | Chapter | Template | Form | Control | Lever id | Outcome id |
|---|---------|----------|------|---------|----------|------------|
| 1 | ... | ... | ... | ... | ... | ... |

(one row per chapter; lever id and outcome id are the data-attribute ids the post-iteration gate will drive — lowercase, no spaces)

TEMPLATE IS THE SHAPE OF THE ARGUMENT — what kind of beat this is. The system is mounted at ./explainer-kit/field-study/; read its TEMPLATES.md before you plan. Pick from the beat's verb:
- T0 front matter — declaring. The landing page. Once, at the front. States the study's three findings BEFORE beat 01.
- T1 argument — reasoning. Prose carries it. Two figures at most.
- T2 survey — accounting. A landscape counted, every row with the same fields and its own basis.
- T3 position — recommending. One recommendation, defended, with the rejected options named fairly. Once per study.
- T4 ledger — weighing. Two sides, re-lensed by actor. The risk column is never shorter than the benefit column.
- T5 instrument — operating. A control surface, deliberately not editorial.
- T6 anatomy — decomposing. One thing, N layers.
- T7 chronicle — narrating time. Two named threads, not one undifferentiated one.
- T8 precedent — judging cases. N cases, each with a fate and a transferable lesson.

Two verbs apply → it is two beats. T0 once, at the front. Never two of the same template consecutively except T1. A study that is all T2 is a database; all T1 is an essay.

FORM IS HOW THAT ARGUMENT IS ARRANGED on the page — orthogonal to the template, and what the shell actually renders. Pick per chapter:
- open — the visual runs full width above the words. For a chapter whose picture IS the argument.
- question — the title is a question; evidence; then a bounded answer.
- walk — numbered movements, one beat each. For a process or a sequence.
- compare — two columns, this against that.
- annotate — one artefact held wide, with reading notes beside it.
- ledger — a list of items, each with its own small visual.
- close — what is established and what is not. For ending.

CONTROL is what the reader touches:
- choice — segmented buttons, one per option. THE DEFAULT. Use it whenever the parameter is a SET of things: which source, which year, which claim.
- toggle — one button, on or off. For a single assumption being held or dropped.
- step — previous/next through an ordered sequence. For a process the reader walks.
- slider — a continuous range. ONLY for a genuine quantity: money, people, a rate. A slider for "which of six topics" is a category dressed as a number, and it reads as one.

VARY BOTH. A build where every chapter has the same form and the same control is a worse artefact than the same content arranged with judgement, and the gate now says so. Across the whole plan use at least three different forms and at least two different controls, and never the same form twice in a row. Choose each from what the chapter is doing — do not rotate through the list mechanically.

## Chapter Detail

### Chapter 1: [title]
- Idea: [the single thing this chapter teaches]
- Visual: [the kit factory and what it shows — createSteps for a process, createStackBar for a composition, createIconArray for a proportion, createComparison for before/after, createTimeline for events, createDiagram for a mechanism, createScene for a quantity across a set]
- Manipulate: [what the reader changes]
- Consequence: [what visibly moves, and why that is the lesson]
- Grounded in: [which numbered FACTS from the brief]

(repeat for every chapter)

## Risks & Mitigations
(2-3 real risks)`;

export const STUDIO_CRITIC_EXTRA = `

8. PEDAGOGY: Does every chapter have explain → manipulate → consequence, or are some just prose with a picture? Is the chapter order a real progression where each depends on the last, or is it topic buckets in arbitrary order? Is any chapter's lever decoration — a control that moves a number the chapter never gave meaning to? Flag chapters with no interactive model as "NO-MODEL:", an order that could be shuffled without loss as "ARBITRARY-ORDER:", and a meaningless control as "DECORATIVE-LEVER:". For each, say concretely what the model should be instead.

9. SOURCING: Does every factual claim in the plan trace to a numbered FACT in the research brief? Look for figures, dates, percentages and mechanisms that appear in the plan but not in the brief. Flag each with "UNSOURCED:" and name the claim. Also check the reverse: is the plan ignoring the brief's GAPS by presenting a settled story where the research found none? Flag that with "FALSE-CONFIDENCE:".`;

/**
 * Round 3's instruction to the proposer — the LAST format instruction the
 * model sees before it writes the final plan, and therefore the one that
 * actually decides the shape of the output.
 *
 * This has to branch. The app variant demands "## UI Design / ## Iteration
 * Plan / ### Iteration 1 through 5", which for a studio build directly
 * contradicts STUDIO_PROPOSER_SYSTEM_PROMPT's "## Chapter Plan" table. A model
 * that obeys it emits no table at all: `parseChapterPlan` returns [], and
 * planBuild's `### Chapter N:` cross-check then compares 0 against 0, agrees,
 * and stays silent. The build runs with no chapter spine and — because the
 * orchestrator's studio gate is guarded on `chapterPlan.length > 0` — no gate
 * either, while the log reads perfectly healthy.
 *
 * The studio section names and table columns below are copied verbatim from
 * STUDIO_PROPOSER_SYSTEM_PROMPT. They are machine-read downstream
 * (`parseChapterPlan` → `jkai_builds.chapterPlan` → studio-gate); paraphrasing
 * either breaks the parse. Keep the two in sync by hand.
 *
 * The non-studio string is unchanged, deliberately — including its stale "six
 * dimensions" (the app critic lists seven). Non-studio builds must not shift
 * behaviour on this branch.
 */
export function buildRevisionInstruction(isStudio: boolean): string {
  if (isStudio) {
    return `The critic above has reviewed your plan across nine dimensions. Address all critical issues raised.

For each "VIOLATION:", "BLOATED-SKELETON:", "FRAGMENTED:", "VAGUE:", "INFEASIBLE:", "REINSTALL-WASTE:", "BLAND:", "OBVIOUS:", "NO-MODEL:", "ARBITRARY-ORDER:", "DECORATIVE-LEVER:", "UNSOURCED:", "FALSE-CONFIDENCE:", or critical issue: make a concrete fix. If the critic suggested a specific replacement, use it. If a chapter has no interactive model, give it one or replace the chapter. If the chapter order could be shuffled without loss, re-sequence it so each chapter depends on the last. If a claim was flagged as unsourced, either ground it in a numbered FACT from the research brief or remove it.

Start with a ## Changes Made section listing each marker you received and what you changed in response. Then produce the complete revised plan in EXACTLY the format you were given — same section names, same table columns:

## Changes Made
(For each marker: [marker + issue] → [what you changed])

## Concept
(what the reader will be able to do at the end that they cannot do now — 2-3 sentences)

## Architecture
(stack, routing, how chapters are served — 3-5 sentences)

## Chapter Plan

| # | Chapter | Template | Form | Control | Lever id | Outcome id |
|---|---------|----------|------|---------|----------|------------|
| 1 | ... | ... | ... | ... | ... | ... |

(one row per chapter; lever id and outcome id are the data-attribute ids the post-iteration gate will drive — lowercase, no spaces)

TEMPLATE IS THE SHAPE OF THE ARGUMENT — what kind of beat this is. The system is mounted at ./explainer-kit/field-study/; read its TEMPLATES.md before you plan. Pick from the beat's verb:
- T0 front matter — declaring. The landing page. Once, at the front. States the study's three findings BEFORE beat 01.
- T1 argument — reasoning. Prose carries it. Two figures at most.
- T2 survey — accounting. A landscape counted, every row with the same fields and its own basis.
- T3 position — recommending. One recommendation, defended, with the rejected options named fairly. Once per study.
- T4 ledger — weighing. Two sides, re-lensed by actor. The risk column is never shorter than the benefit column.
- T5 instrument — operating. A control surface, deliberately not editorial.
- T6 anatomy — decomposing. One thing, N layers.
- T7 chronicle — narrating time. Two named threads, not one undifferentiated one.
- T8 precedent — judging cases. N cases, each with a fate and a transferable lesson.

Two verbs apply → it is two beats. T0 once, at the front. Never two of the same template consecutively except T1. A study that is all T2 is a database; all T1 is an essay.

FORM IS HOW THAT ARGUMENT IS ARRANGED on the page — orthogonal to the template, and what the shell actually renders. Pick per chapter:
- open — the visual runs full width above the words. For a chapter whose picture IS the argument.
- question — the title is a question; evidence; then a bounded answer.
- walk — numbered movements, one beat each. For a process or a sequence.
- compare — two columns, this against that.
- annotate — one artefact held wide, with reading notes beside it.
- ledger — a list of items, each with its own small visual.
- close — what is established and what is not. For ending.

CONTROL is what the reader touches:
- choice — segmented buttons, one per option. THE DEFAULT. Use it whenever the parameter is a SET of things: which source, which year, which claim.
- toggle — one button, on or off. For a single assumption being held or dropped.
- step — previous/next through an ordered sequence. For a process the reader walks.
- slider — a continuous range. ONLY for a genuine quantity: money, people, a rate. A slider for "which of six topics" is a category dressed as a number, and it reads as one.

VARY BOTH. A build where every chapter has the same form and the same control is a worse artefact than the same content arranged with judgement, and the gate now says so. Across the whole plan use at least three different forms and at least two different controls, and never the same form twice in a row. Choose each from what the chapter is doing — do not rotate through the list mechanically.

## Chapter Detail

### Chapter 1: [title]
- Idea: [the single thing this chapter teaches]
- Visual: [the kit factory and what it shows — createSteps for a process, createStackBar for a composition, createIconArray for a proportion, createComparison for before/after, createTimeline for events, createDiagram for a mechanism, createScene for a quantity across a set]
- Manipulate: [what the reader changes]
- Consequence: [what visibly moves, and why that is the lesson]
- Grounded in: [which numbered FACTS from the brief]

(repeat for every chapter)

## Risks & Mitigations
(2-3 real risks)

THE ## Chapter Plan TABLE IS MANDATORY, AND IT IS MACHINE-READ. It becomes this build's chapter spine, and an automated post-iteration gate drives exactly the lever id and outcome id you write in each row. Emit it with those six columns, in that order, one row per chapter, and one "### Chapter N: [title]" heading under ## Chapter Detail for every row. Do NOT emit "## UI Design" or "## Iteration Plan" — those belong to a different kind of build, and replacing the table with them leaves this build with no spine and no gate at all.

Be specific — name exact APIs with endpoint URLs, exact datasets from the brief's LIVE DATA section, exact file structure for Iteration 1.`;
  }
  return `The critic above has reviewed your plan across six dimensions. Address all critical issues raised.

For each "VIOLATION:", "OVERSIZED:", "BLAND:", "OBVIOUS:", "INFEASIBLE:", or critical issue: make a concrete fix. If the critic suggested a specific replacement, use it. If an iteration is oversized, split or descope it. If the design was flagged as bland, make it distinctive. If the approach was flagged as obvious, make it more creative and ambitious.

Start with a ## Changes Made section listing each marker you received and what you changed in response. Then produce the complete revised plan:

## Changes Made
(For each marker: [marker + issue] → [what you changed])

## Architecture
## UI Design
## Iteration Plan
### Iteration 1 through 5 (same structure as before)
## Risks & Mitigations

Be specific — name exact APIs with endpoint URLs, exact CDN URLs for libraries, exact file structure for Iteration 1.`;
}

/**
 * Slice the plan down to the "## Chapter Plan" section only — from that
 * heading to the next "##"-level heading (or end of document).
 *
 * Without this, `parseChapterPlan` scans every `|`-prefixed line in the
 * whole document, and a second markdown table anywhere else in the plan
 * pollutes the chapter spine — observed concretely with a "Risks &
 * Mitigations" table whose rows happen to share the same 4-column shape.
 * `### Chapter N:` headings under "## Chapter Detail" are level-3 and so
 * never end the slice early. Falls back to the whole document when the
 * heading is missing, so an unusually formatted plan still yields whatever
 * `parseChapterPlan` can find rather than nothing.
 */
function extractChapterPlanSection(planMarkdown: string): string {
  const headingMatch = /^##[ \t]+Chapter Plan[ \t]*$/m.exec(planMarkdown);
  if (!headingMatch) return planMarkdown;
  const afterHeading = planMarkdown.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = /^##(?!#)[ \t]/m.exec(afterHeading);
  return nextHeading ? afterHeading.slice(0, nextHeading.index) : afterHeading;
}

/**
 * Read the chapter table out of the plan markdown.
 *
 * Deliberately forgiving: a malformed row is skipped, not fatal. The plan is
 * LLM output and one bad row must not cost the whole spine — the executor can
 * work from a partial plan, but not from an exception.
 *
 * `stats`, if passed, is populated with the count of candidate rows that were
 * dropped (missing lever/outcome id, or too few cells) — not the header or
 * divider row, which every well-formed table has and which are structural,
 * not a chapter the model tried and failed to write. A silently-dropped
 * chapter leaves a gap in `n` that nothing else surfaces, and the caller uses
 * this count (plus a `### Chapter N:` heading cross-check) to log that the
 * spine came out short.
 */
/**
 * The editorial shapes a chapter can take, and the kinds of control it can
 * offer. Kept here because the planner is what produces them; shell.js holds
 * the browser-side twin and explainer-kit.test.ts pins the two together.
 *
 * These exist because the plan had no word for HOW a chapter is told. Every
 * chapter of every build came out as `article > h2 > h2`, seven times over,
 * and every lever was a range slider — including for "which of six topics".
 * A vocabulary with no term for variety produces none.
 */
export const CHAPTER_FORMS = ['open', 'question', 'walk', 'compare', 'annotate', 'ledger', 'close'] as const;
export const CONTROL_KINDS = ['choice', 'toggle', 'step', 'slider'] as const;

/**
 * The Field Study System's nine templates — the shape of the ARGUMENT a beat
 * makes, which is orthogonal to `CHAPTER_FORMS` (how the shell arranges it on
 * the page) and to `CONTROL_KINDS` (what the reader touches).
 *
 * The registry these mirror is `static/explainer-kit/field-study/templates.json`,
 * mounted into every studio workspace. `explainer-kit.test.ts` pins the two
 * together, because a template id the plan names and the mount does not carry
 * is a chapter the agent has no instructions for.
 */
export const STUDY_TEMPLATES = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'] as const;

export type ChapterForm = (typeof CHAPTER_FORMS)[number];
export type ControlKind = (typeof CONTROL_KINDS)[number];
export type StudyTemplate = (typeof STUDY_TEMPLATES)[number];

/**
 * Coerce a plan cell to a known form/control, or null.
 *
 * Null means "the model wrote something we do not have", which the caller
 * turns into a default rather than a rejected row: a chapter with an odd form
 * name is still a chapter, and losing it would cost more than the variety.
 */
export function normaliseVocab<T extends string>(raw: string, allowed: readonly T[]): T | null {
  const v = raw.toLowerCase().replace(/[`*'"]/g, '').trim();
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * Reduce a plan-table id to something an agent can find and a gate can drive.
 *
 * The gate builds an attribute selector from this value, so anything that
 * cannot appear unescaped in `[data-lever="..."]` has to go. Returns null when
 * nothing usable survives, which the caller treats as a rejected row.
 */
export function normaliseSpineId(raw: string): string | null {
  const id = raw
    .toLowerCase()
    .replace(/[`*'"]/g, '')
    .trim()
    // Models write "match claim", "match-claim" and "matchClaim" for the same
    // thing; collapse the separators rather than rejecting two of the three.
    .replace(/[\s.]+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
  // {0,63}, not {1,63}: a one-character id is legal in an attribute selector
  // and the existing plans use them. Length is a sanity bound, not a style rule.
  return /^[a-z][a-z0-9_-]{0,63}$/.test(id) ? id : null;
}

export interface ChapterSpineRow {
  n: number;
  title: string;
  /** The Field Study template this beat's argument takes (T0-T8). */
  template: StudyTemplate;
  form: ChapterForm;
  control: ControlKind;
  leverId: string;
  outcomeId: string;
}

export function parseChapterPlan(
  planMarkdown: string,
  stats?: { rejected: number },
): ChapterSpineRow[] {
  if (stats) stats.rejected = 0;
  const out: ChapterSpineRow[] = [];
  for (const line of extractChapterPlanSection(planMarkdown).split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    // Strip inline markdown emphasis before parsing: a model emitting
    // "| **1** | **Title** | ... |" must still parse as n=1 with a clean
    // title, not NaN (silently dropping the row) or a title carrying raw
    // asterisks into jkai_builds.chapterPlan.
    //
    // Backticks matter as much as asterisks, and cost more. Models write ids
    // as code spans by reflex — build 85dac418's whole spine was stored as
    // "`matchclaim`" — and the gate then looks for a control tagged
    // data-lever="`matchclaim`" which no sane agent writes. That build's
    // agent wrote the clean id every time, so `no-model` fired on all eight
    // chapters, every iteration, permanently unsatisfiable. Replaying the
    // real gate against the surviving snapshot with the backticks stripped
    // took it from 24 findings to 8.
    const cells = line.split('|').map((c) => c.replace(/[*`]+/g, '').trim());
    // ['', '#', 'Chapter', 'Lever id', 'Outcome id', ''] -> 6 cells
    if (cells.length < 6) {
      if (stats) stats.rejected++;
      continue;
    }
    const n = Number.parseInt(cells[1], 10);
    // A non-finite n is overwhelmingly the header row ("#") or the divider
    // row ("---...") — both structural and present in every well-formed
    // table — so this is not counted as a rejected chapter.
    if (!Number.isFinite(n)) continue;
    // Three table shapes are accepted, newest first:
    //   | # | Chapter | Template | Form | Control | Lever id | Outcome id |
    //   | # | Chapter | Form | Control | Lever id | Outcome id |
    //   | # | Chapter | Lever id | Outcome id |
    // Every older shape still parses. A plan written by an older prompt — or by
    // a model that drops a column — yields a working spine rather than nothing,
    // which matters because the studio gate is guarded on the spine being
    // non-empty and an empty one turns the gate off silently.
    const study = cells.length >= 9;
    const wide = cells.length >= 8;
    const title = cells[2];
    const rawTemplate = study ? cells[3] : '';
    const rawForm = study ? cells[4] : wide ? cells[3] : '';
    const rawControl = study ? cells[5] : wide ? cells[4] : '';
    const rawLeverId = study ? cells[6] : wide ? cells[5] : cells[3];
    const rawOutcomeId = study ? cells[7] : wide ? cells[6] : cells[4];

    if (/^-+$/.test(title)) continue; // defensive: a divider row whose number cell happened to parse
    if (!title || !rawLeverId || !rawOutcomeId) {
      if (stats) stats.rejected++;
      continue;
    }
    // An unrecognised form is defaulted, never rejected. `question` is the
    // plainest shape; `choice` is the default control because the house style
    // this copies uses buttons over sliders 43 to 10, and a slider is only
    // honest for a continuous quantity.
    const form = normaliseVocab(rawForm, CHAPTER_FORMS) ?? 'question';
    const control = normaliseVocab(rawControl, CONTROL_KINDS) ?? 'choice';
    // Defaulted, never rejected — same reasoning as form. `t1` (argument) is
    // the plainest beat shape, and a chapter whose template cell is missing or
    // unrecognised is still a chapter.
    const template = normaliseVocab(rawTemplate, STUDY_TEMPLATES) ?? 't1';
    // An id has to survive the round trip into an HTML attribute selector, so
    // normalise to the same shape the gate will look for. Anything left
    // unusable is a rejected row rather than a silent time bomb: the spine
    // coming out short is logged by the caller, whereas a malformed id looks
    // healthy right up until every gate run fails on it.
    const leverId = normaliseSpineId(rawLeverId);
    const outcomeId = normaliseSpineId(rawOutcomeId);
    if (!leverId || !outcomeId) {
      if (stats) stats.rejected++;
      continue;
    }
    out.push({ n, title, template, form, control, leverId, outcomeId });
  }
  return out;
}

// --- Streaming helper ---
//
// All three planner LLM calls (Proposer, Critic, Proposer-revision) go
// through this. Each chunk's content delta is emitted as a `stream_text` or
// `stream_thinking` LiveEvent so the UI's existing per-token rendering
// (LaneOutput / LaneThinking) lights up character-by-character. Without
// streaming, the user stares at a "Round 1/3..." log line for ~30s before
// the full block lands at once — phase 4 verified streaming worked for pi
// iterations but the planner was still buffered.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LLMClient = any;

async function streamPlannerCall(opts: {
  client: LLMClient;
  model: string;
  planIteration: { id: string };
  buildId: string;
  /** Optional system prompt. Omit (or pass empty) to skip the system message. */
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature: number;
  max_tokens: number;
  streamIdSuffix: string;
  lane: 'text' | 'thinking';
  priceSnapshot: PriceSnapshot | null;
  onUsage: (totalTokens: number) => void;
}): Promise<string> {
  const streamId = `${opts.planIteration.id}:plan-${opts.streamIdSuffix}`;
  const eventType = opts.lane === 'thinking' ? 'stream_thinking' : 'stream_text';
  const messages = opts.systemPrompt
    ? [{ role: 'system', content: opts.systemPrompt }, ...opts.messages]
    : opts.messages;
  const stream = await opts.client.chat.completions.create({
    model: opts.model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.max_tokens,
    stream: true,
    stream_options: { include_usage: true },
  });

  let acc = '';
  let usageTokens = 0;
  for await (const chunk of stream as AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }>; usage?: { total_tokens?: number } }>) {
    const delta = chunk.choices?.[0]?.delta?.content ?? '';
    if (delta) {
      acc += delta;
      emitLive(opts.buildId, {
        type: eventType,
        iterationId: opts.planIteration.id,
        streamId,
        delta,
      });
    }
    if (chunk.usage?.total_tokens) usageTokens = chunk.usage.total_tokens;
  }
  emitLive(opts.buildId, {
    type: 'stream_turn_end',
    iterationId: opts.planIteration.id,
    streamId,
    full: acc,
  });
  if (usageTokens > 0) {
    await recordBuildUsage(
      opts.buildId,
      parseUsage({ total_tokens: usageTokens } as unknown as Parameters<typeof parseUsage>[0]),
      opts.priceSnapshot,
    );
    opts.onUsage(usageTokens);
  }
  return acc;
}

// --- Planning Functions ---

export async function planBuild(
  buildId: string,
  prompt: string,
  timeLimitMs: number = 4 * 60 * 1000,
): Promise<void> {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  const { client, model } = await getLLMClient({
    provider: 'openrouter',
    // The build's own pin, else the single site default (the builder no longer
    // has a separate model setting).
    modelId: build?.modelId ?? (await resolveDefaultModel()).modelId,
  });
  const priceSnapshot = (build?.priceSnapshot ?? null) as PriceSnapshot | null;
  const deadline = Date.now() + timeLimitMs;

  // Studio mode: swap in the chapter-spine prompts and, when the research
  // stage has already attached a brief, ground the proposer in it. Gated on
  // isStudio (not just brief-presence) so a non-studio origin plans exactly
  // as it always has even in the unreachable case its researchBrief were
  // somehow non-null.
  const isStudio = build?.origin === 'studio';
  const proposerPrompt = isStudio ? STUDIO_PROPOSER_SYSTEM_PROMPT : PROPOSER_SYSTEM_PROMPT;
  const criticPrompt = isStudio ? CRITIC_SYSTEM_PROMPT + STUDIO_CRITIC_EXTRA : CRITIC_SYSTEM_PROMPT;
  const brief: ResearchBrief | null = isStudio ? (build?.researchBrief ?? null) : null;
  const briefBlock = brief ? `${formatBriefForPrompt(brief)}\n\n---\n\n` : '';

  const [planIteration] = await db
    .insert(jkaiIterations)
    .values({ buildId, number: 0, status: 'running' })
    .returning();

  await emitLog(buildId, 'system', '━━━ Planning Phase (3-round debate) ━━━', planIteration.id);

  // --- Debate State ---

  const debateMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let totalTokens = 0;
  let bestPlan: string | null = null; // Track the best available plan for crash recovery
  const startMs = Date.now();

  function checkDeadline(phase: string): void {
    if (Date.now() >= deadline) {
      throw new Error(`Planning time limit exceeded before ${phase} (limit: ${timeLimitMs / 1000}s)`);
    }
  }

  try {
    // --- Round 1: Proposer ---
    await emitLog(buildId, 'system', 'Round 1/3 — Proposer drafting initial plan...', planIteration.id);

    const userPromptMsg = `${briefBlock}Project objective:\n${prompt}\n\nProduce your initial delivery plan following the required format.`;

    const proposal = await streamPlannerCall({
      client, model, planIteration, buildId,
      systemPrompt: proposerPrompt,
      messages: [{ role: 'user', content: userPromptMsg }],
      temperature: 0.7,
      max_tokens: 3000,
      streamIdSuffix: 'r1',
      lane: 'text',
      priceSnapshot,
      onUsage: (u) => { totalTokens += u; },
    });
    debateMessages.push({ role: 'user', content: userPromptMsg });
    debateMessages.push({ role: 'assistant', content: proposal });

    bestPlan = proposal;
    await emitLog(buildId, 'text', proposal, planIteration.id);
    // Persist the round-1 draft into iter 0's plan column AND emit a live
    // event so the PlanEditor in the UI updates as drafts land — without
    // this the user only sees the plan after round 3 finishes (or never,
    // if the planner crashes mid-flight).
    await db
      .update(jkaiIterations)
      .set({ plan: proposal, messages: debateMessages, tokensUsed: totalTokens })
      .where(eq(jkaiIterations.id, planIteration.id));
    emitLive(buildId, {
      type: 'plan_proposed',
      iterationId: planIteration.id,
      streamId: `${planIteration.id}:plan`,
      full: proposal,
    });

    // --- Round 2: Critic ---
    checkDeadline('Critic review');
    await emitLog(buildId, 'system', 'Round 2/3 — Critic reviewing plan...', planIteration.id);

    // Critic gets its own system prompt but sees the proposal conversation.
    const critique = await streamPlannerCall({
      client, model, planIteration, buildId,
      systemPrompt: criticPrompt,
      messages: debateMessages,
      temperature: 0.6,
      max_tokens: 2500,
      streamIdSuffix: 'r2',
      lane: 'thinking',
      priceSnapshot,
      onUsage: (u) => { totalTokens += u; },
    });

    // Push critique as 'user' role — from the Proposer's perspective in Round 3,
    // the critique is external feedback, not its own prior output
    debateMessages.push({ role: 'user', content: `[Critic review]\n\n${critique}` });

    await emitLog(buildId, 'thinking', critique, planIteration.id);
    await db
      .update(jkaiIterations)
      .set({ messages: debateMessages, tokensUsed: totalTokens })
      .where(eq(jkaiIterations.id, planIteration.id));

    // --- Round 3: Proposer revision ---
    checkDeadline('Proposer revision');
    await emitLog(buildId, 'system', 'Round 3/3 — Proposer revising based on critique...', planIteration.id);

    const revisionInstruction = buildRevisionInstruction(isStudio);

    debateMessages.push({ role: 'user', content: revisionInstruction });

    const finalPlan = await streamPlannerCall({
      client, model, planIteration, buildId,
      systemPrompt: proposerPrompt,
      messages: debateMessages,
      temperature: 0.7,
      max_tokens: 3000,
      streamIdSuffix: 'r3',
      lane: 'text',
      priceSnapshot,
      onUsage: (u) => { totalTokens += u; },
    });
    bestPlan = finalPlan;
    debateMessages.push({ role: 'assistant', content: finalPlan });

    await emitLog(buildId, 'text', finalPlan, planIteration.id);
    emitLive(buildId, {
      type: 'plan_proposed',
      iterationId: planIteration.id,
      streamId: `${planIteration.id}:plan`,
      full: finalPlan,
    });

    // Studio mode: persist the chapter spine now that the debate has
    // concluded. executor.ts reads jkai_builds.chapterPlan to drive each
    // chapter's lever/outcome gate — see prompt.ts's ChapterPlanEntry.
    if (isStudio) {
      const rowStats = { rejected: 0 };
      const chapterPlan = parseChapterPlan(finalPlan, rowStats);
      await db.update(jkaiBuilds).set({ chapterPlan }).where(eq(jkaiBuilds.id, buildId));
      await emitLog(
        buildId,
        'system',
        `Chapter spine: ${chapterPlan.length} chapters${rowStats.rejected > 0 ? ` (${rowStats.rejected} malformed row(s) dropped)` : ''}.`,
        planIteration.id,
      );

      // Cross-check against the Chapter Detail section: the proposer writes
      // one "### Chapter N:" heading per chapter there, independent of the
      // table row. If the counts disagree, the table and the detail drifted
      // — Task 13's gate will drive whatever ended up in chapterPlan, so a
      // silently short spine needs to be visible to whoever reads this build,
      // not just inferred from rowStats.
      const detailHeadings = (finalPlan.match(/^###\s+Chapter\s+\d+:/gm) ?? []).length;
      if (detailHeadings !== chapterPlan.length) {
        await emitLog(
          buildId,
          'error',
          `Chapter spine mismatch: ${chapterPlan.length} row(s) parsed from the Chapter Plan table but ${detailHeadings} "### Chapter N:" heading(s) found in Chapter Detail — the spine is incomplete.`,
          planIteration.id,
        );
      }
    }

    // --- Store results ---
    const durationMs = Date.now() - startMs;
    const debateSummary = [
      `Planning debate: 3 rounds, ${totalTokens} tokens, ${Math.round(durationMs / 1000)}s.`,
      '',
      'Critic review highlights:',
      critique.slice(0, 800),
    ].join('\n');

    await db
      .update(jkaiIterations)
      .set({
        status: 'completed',
        goals: 'Project planning — 3-round debate (propose → critique → revise)',
        plan: finalPlan,
        evaluation: debateSummary,
        messages: debateMessages,
        tokensUsed: totalTokens,
        durationMs,
        actions: [],
      })
      .where(eq(jkaiIterations.id, planIteration.id));

    await emitLog(buildId, 'system', `━━━ Planning Phase Complete (${Math.round(durationMs / 1000)}s, 3 rounds) ━━━`, planIteration.id);
  } catch (err: any) {
    const durationMs = Date.now() - startMs;

    await emitLog(buildId, 'error', `Planning failed: ${err.message}`, planIteration.id);
    await db
      .update(jkaiIterations)
      .set({
        status: bestPlan ? 'completed' : 'failed',
        plan: bestPlan, // Only ever the proposal or final plan, never the critique
        messages: debateMessages,
        tokensUsed: totalTokens,
        durationMs,
      })
      .where(eq(jkaiIterations.id, planIteration.id));
  }
}

// --- Re-planning Phase (triggered on completion detection) ---

export async function replanBuild(buildId: string): Promise<boolean> {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) return false;

  const { client, model } = await getLLMClient({
    provider: 'openrouter',
    modelId: build.modelId ?? (await resolveDefaultModel()).modelId,
  });
  const priceSnapshot = (build.priceSnapshot ?? null) as PriceSnapshot | null;

  // Gather all completed iteration evaluations
  const completedIterations = await db
    .select()
    .from(jkaiIterations)
    .where(
      and(
        eq(jkaiIterations.buildId, buildId),
        eq(jkaiIterations.status, 'completed'),
      ),
    )
    .orderBy(jkaiIterations.number);

  const iterationSummaries = completedIterations
    .filter((it) => it.number > 0)
    .map((it) => `### Iteration ${it.number}\n${it.evaluation || 'No evaluation'}`)
    .join('\n\n');

  const fileList = await listWorkspaceFiles(buildId);

  // Fetch the plan iteration (#0) up-front. We need its id for the streaming
  // event ids so the live tokens land on the same plan-stream the UI is
  // already subscribed to, and we'll persist the new plan onto the same row.
  const [planIteration] = await db
    .select()
    .from(jkaiIterations)
    .where(
      and(
        eq(jkaiIterations.buildId, buildId),
        eq(jkaiIterations.number, 0),
      ),
    )
    .limit(1);

  if (!planIteration) {
    await emitLog(buildId, 'error', 'Re-planning: no plan iteration #0 found. Stopping build.');
    return false;
  }

  await emitLog(buildId, 'system', '━━━ Re-planning Phase ━━━ Reviewing outcomes and considering further improvements');

  const replanPrompt = `You are a senior software architect reviewing a completed project.

The user's original objective was:
${build.prompt}

Here is a summary of all iterations completed so far:
${iterationSummaries}

Current workspace files:
${fileList || '(empty)'}

CONSTRAINTS (any new iterations must respect these):
1. CLIENT-SIDE FIRST: All data fetching must happen in the browser via fetch(). No server-side routes as primary data sources.
2. REAL DATA ONLY: Use real, public APIs. Name the specific API and endpoint URL.
3. ITERATION SIZING: Each iteration must be completable in ~15 code execution steps.
4. STATIC SERVING: All app logic must work when files are served statically.

Your task:
1. Review the original objective — has everything the user asked for been delivered?
2. Consider whether there are meaningful improvements, features, or polish that would significantly enhance the project beyond what was asked.
3. If you identify worthwhile further work, propose it as a new iteration plan (same format as before: ## Iteration Plan with numbered iterations). Ensure proposed iterations respect the constraints above.
4. If the project genuinely meets or exceeds the original objective and no further work would add significant value, say so clearly.

Respond with ONE of these two formats:

FORMAT A — Further work needed:
## Assessment
(What's been delivered vs. what was asked. Any gaps.)

## Iteration Plan
### Iteration [N]: [title]
- Goal: ...
- Deliverables: ...
(continue for each proposed iteration)

FORMAT B — Project complete:
## Assessment
(What's been delivered vs. what was asked.)

## Complete
No further iterations are needed. The project meets the stated objectives.`;

  try {
    const content = await streamPlannerCall({
      client, model, planIteration, buildId,
      messages: [{ role: 'user', content: replanPrompt }],
      temperature: 0.7,
      max_tokens: 4096,
      streamIdSuffix: 'replan',
      lane: 'text',
      priceSnapshot,
      onUsage: () => {},
    });

    await emitLog(buildId, 'text', content, planIteration.id);

    // Check if the LLM says the project is complete
    const isComplete = content.includes('## Complete') ||
      (content.toLowerCase().includes('no further iterations') && !content.includes('## Iteration Plan'));

    if (isComplete) {
      await emitLog(buildId, 'system', '━━━ Project Complete ━━━ No further work identified.');
      return false; // Don't continue
    }

    // Extract the new plan and save it onto the same plan iteration row.
    const newPlan = content.match(/## Iteration Plan[\s\S]*/)?.[0] || content;
    await db
      .update(jkaiIterations)
      .set({ plan: newPlan, evaluation: content })
      .where(eq(jkaiIterations.id, planIteration.id));

    await emitLog(buildId, 'system', '━━━ Re-planning Complete ━━━ New iterations proposed. Continuing build.');
    return true; // Continue with new plan
  } catch (err: any) {
    await emitLog(buildId, 'error', `Re-planning failed: ${err.message}. Stopping build.`);
    return false;
  }
}
