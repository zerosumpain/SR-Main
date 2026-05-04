import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { listWorkspaceFiles } from './sandbox';
import { emitLog, emitLive } from './log-emitter';
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';

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

Evaluate the proposed plan across these SEVEN dimensions:

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
  systemPrompt: string;
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
  const stream = await opts.client.chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      ...opts.messages,
    ],
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
    provider: (build?.modelProvider ?? 'zai') as 'zai' | 'openrouter',
    modelId: build?.modelId ?? 'glm-5-turbo',
  });
  const priceSnapshot = (build?.priceSnapshot ?? null) as PriceSnapshot | null;
  const deadline = Date.now() + timeLimitMs;

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

    const userPromptMsg = `Project objective:\n${prompt}\n\nProduce your initial delivery plan following the required format.`;

    const proposal = await streamPlannerCall({
      client, model, planIteration, buildId,
      systemPrompt: PROPOSER_SYSTEM_PROMPT,
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
      systemPrompt: CRITIC_SYSTEM_PROMPT,
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

    const revisionInstruction = `The critic above has reviewed your plan across six dimensions. Address all critical issues raised.

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

    debateMessages.push({ role: 'user', content: revisionInstruction });

    const finalPlan = await streamPlannerCall({
      client, model, planIteration, buildId,
      systemPrompt: PROPOSER_SYSTEM_PROMPT,
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
    provider: (build.modelProvider ?? 'zai') as 'zai' | 'openrouter',
    modelId: build.modelId ?? 'glm-5-turbo',
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
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'user', content: replanPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    });

    await recordBuildUsage(buildId, parseUsage(response.usage), priceSnapshot);

    const content = response.choices[0]?.message?.content || '';
    await emitLog(buildId, 'text', content);

    // Check if the LLM says the project is complete
    const isComplete = content.includes('## Complete') ||
      (content.toLowerCase().includes('no further iterations') && !content.includes('## Iteration Plan'));

    if (isComplete) {
      await emitLog(buildId, 'system', '━━━ Project Complete ━━━ No further work identified.');
      return false; // Don't continue
    }

    // Extract the new plan and save it as an updated plan iteration
    const newPlan = content.match(/## Iteration Plan[\s\S]*/)?.[0] || content;

    // Update the plan iteration (#0) with the new plan
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

    if (planIteration) {
      await db
        .update(jkaiIterations)
        .set({ plan: newPlan, evaluation: content })
        .where(eq(jkaiIterations.id, planIteration.id));
    }

    await emitLog(buildId, 'system', '━━━ Re-planning Complete ━━━ New iterations proposed. Continuing build.');
    return true; // Continue with new plan
  } catch (err: any) {
    await emitLog(buildId, 'error', `Re-planning failed: ${err.message}. Stopping build.`);
    return false;
  }
}
