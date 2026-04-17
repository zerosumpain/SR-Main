import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { listWorkspaceFiles } from './sandbox';
import { emitLog } from './log-emitter';
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';

// --- System Prompts ---

const PROPOSER_SYSTEM_PROMPT = `You are a senior software architect creating a project delivery plan. You produce plans only — no code.

Given a project objective, write a delivery plan covering:
- Architecture: technology choices, key components, data flow
- UI Design: layout approach, design system choices, key screens and interactions
- Iteration Plan: 5 iterations, each scoped to approximately 15 code execution steps
- For each iteration: goal, deliverables, milestone (what the user sees), and tests

CONSTRAINTS YOUR PLAN MUST RESPECT:
1. CLIENT-SIDE FIRST: The project is published as a static site. All data fetching must happen in the browser via fetch(). No server-side routes as primary data sources. Use public APIs directly, with the CORS proxy (/api/jkai/cors/{encoded-url}) if needed.
2. REAL DATA ONLY: Every data source must be a real, public API or dataset. Name the specific API and endpoint URL (e.g., Open-Meteo, REST Countries, Wikipedia API). Never propose placeholder or hardcoded data.
3. ITERATION SIZING: Each iteration must be completable in ~15 shell/code execution steps. Iteration 1 must produce a visible, served page — even a skeleton. No iteration should attempt to build the complete feature set.
4. STATIC SERVING: The dev server is a lightweight static server (python3 -m http.server or npx serve). All app logic must work when files are served statically.

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

Evaluate the proposed plan across these SIX dimensions:

1. CLIENT-SIDE ARCHITECTURE: Does the plan violate the static publishing constraint? Look for: server-side routes as primary data sources, backend frameworks (Flask, Express) doing data fetching, environment variables for runtime config, assumptions that a server process persists between requests. Flag each with "VIOLATION:" and explain why it breaks static publishing.

2. DATA SOURCING: Are all proposed APIs real, public, and CORS-accessible from a browser? Look for: vague descriptions ("use an API"), APIs requiring server-side auth, APIs with CORS restrictions without proxy support, placeholder data. For each questionable source, suggest a specific replacement with a concrete API URL.

3. ITERATION SCOPING: Is each iteration realistically completable in ~15 code execution steps? Look for: iterations that build too much at once, iteration 1 not delivering a served page, unclear milestones, cascading dependencies. Flag oversized iterations with "OVERSIZED:" and suggest how to split them.

4. TECHNICAL FEASIBILITY: Are the technology choices viable in a sandboxed Linux environment with Python 3.12, Node 22, and internet access? Look for: packages requiring native compilation, UI frameworks needing a build step without one, unnecessarily complex patterns. Flag each with "INFEASIBLE:" and explain what won't work.

5. USER EXPERIENCE: Is the proposed UI genuinely compelling, or is it a generic dashboard/list page? Look for: lack of visual identity, no interactive elements beyond basic filtering, missing animations or transitions, no clear design inspiration, cookie-cutter layouts that any AI would produce. Flag bland designs with "BLAND:" and suggest specific ways to make the experience more distinctive and engaging — a unique visual concept, a memorable interaction pattern, an unexpected layout approach.

6. INNOVATION: Is the approach creative or just the obvious solution? Look for: standard CRUD patterns where something more inventive would serve the user better, missed opportunities for visualisation or storytelling, generic data displays when the data could be presented in a novel way. Flag missed opportunities with "OBVIOUS:" and suggest a more ambitious or creative alternative that would make this project genuinely interesting.

End your review with:

## Summary of Issues
(numbered list of critical problems, ranked by severity)

## Recommended Changes
(concrete, actionable fixes for each critical issue — specific replacements, not vague suggestions)`;

// --- Planning Functions ---

export async function planBuild(
  buildId: string,
  prompt: string,
  timeLimitMs: number = 4 * 60 * 1000,
): Promise<void> {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  const { client, model } = await getLLMClient({
    provider: (build?.modelProvider ?? 'zai') as 'zai' | 'openrouter',
    modelId: build?.modelId ?? 'glm-5.1',
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

    const r1 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROPOSER_SYSTEM_PROMPT },
        { role: 'user', content: userPromptMsg },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    await recordBuildUsage(buildId, parseUsage(r1.usage), priceSnapshot);

    const proposal = r1.choices[0]?.message?.content || '';
    totalTokens += r1.usage?.total_tokens || 0;
    debateMessages.push({ role: 'user', content: userPromptMsg });
    debateMessages.push({ role: 'assistant', content: proposal });

    bestPlan = proposal;
    await emitLog(buildId, 'text', proposal, planIteration.id);
    await db
      .update(jkaiIterations)
      .set({ messages: debateMessages, tokensUsed: totalTokens })
      .where(eq(jkaiIterations.id, planIteration.id));

    // --- Round 2: Critic ---
    checkDeadline('Critic review');
    await emitLog(buildId, 'system', 'Round 2/3 — Critic reviewing plan...', planIteration.id);

    // Critic gets its own system prompt but sees the proposal conversation
    const r2 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: CRITIC_SYSTEM_PROMPT },
        ...debateMessages,
      ],
      temperature: 0.6,
      max_tokens: 2500,
    });

    await recordBuildUsage(buildId, parseUsage(r2.usage), priceSnapshot);

    const critique = r2.choices[0]?.message?.content || '';
    totalTokens += r2.usage?.total_tokens || 0;

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

    const r3 = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROPOSER_SYSTEM_PROMPT },
        ...debateMessages,
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    await recordBuildUsage(buildId, parseUsage(r3.usage), priceSnapshot);

    const finalPlan = r3.choices[0]?.message?.content || '';
    totalTokens += r3.usage?.total_tokens || 0;
    bestPlan = finalPlan;
    debateMessages.push({ role: 'assistant', content: finalPlan });

    await emitLog(buildId, 'text', finalPlan, planIteration.id);

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
    modelId: build.modelId ?? 'glm-5.1',
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
