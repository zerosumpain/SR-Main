import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkBudget } from './budget';
import { buildSystemPrompt, buildIterationContext } from './prompt';
import {
  ensureSandboxRunning,
  ensureWorkspace,
  execInSandbox,
  execInSandboxChecked,
  listWorkspaceFiles,
  readServeJson,
  startProjectServer,
  killProjectServer,
  promoteDevToLive,
  seedDevFromLive,
  snapshotIteration,
} from './sandbox';
import { validateServeConfig } from './serve';
import type { ActionRecord } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
import { EventEmitter } from 'events';
import { getLLMClient } from './llm-client';
import { failOrphanedIterations } from './orchestrator-helpers';
import { runTests } from './test-runner';

// --- Event Emitter for SSE ---

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onBuildLog(
  buildId: string,
  handler: (log: { id: number; type: string; content: string; iterationId: string | null }) => void,
): () => void {
  const key = `log:${buildId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

// Strip null bytes and other control chars that break Postgres text columns
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

async function emitLog(
  buildId: string,
  type: string,
  content: string,
  iterationId: string | null = null,
): Promise<void> {
  const safeContent = sanitize(content);
  const [log] = await db
    .insert(jkaiLogs)
    .values({ buildId, iterationId, type, content: safeContent })
    .returning();
  emitter.emit(`log:${buildId}`, {
    id: log.id,
    type: log.type,
    content: log.content,
    iterationId: log.iterationId,
  });
}

// --- Code Block Extraction ---

const FENCE_REGEX = /```(bash|python|sh|javascript|typescript|node)\n([\s\S]*?)```/;

function extractCodeBlock(text: string): { lang: string; code: string } | null {
  const match = text.match(FENCE_REGEX);
  if (!match) return null;
  return { lang: match[1], code: match[2].trimEnd() };
}

function hasEvaluation(text: string): boolean {
  return text.includes('## Evaluation');
}

/**
 * Detect whether an iteration's evaluation signals the project is complete.
 * Looks for strong completion signals in the evaluation text.
 */
function detectCompletion(evaluation: string | null): boolean {
  if (!evaluation) return false;
  const lower = evaluation.toLowerCase();

  // Look for completion percentages anchored to progress/completion context
  // Must be near words like "complete", "done", "progress", "goal" to avoid false positives
  // like "95% of tests passing" or "95% of CSS work done"
  const pctMatch = lower.match(/(?:progress|complete|done|goal|finished|overall)[^.]{0,30}(\d+)\s*%|(\d+)\s*%[^.]{0,30}(?:complete|done|finished|overall)/);
  const pctValue = pctMatch ? parseInt(pctMatch[1] || pctMatch[2]) : 0;
  if (pctValue >= 95) return true;

  // Strong completion phrases
  const completionPhrases = [
    'project is complete',
    'project complete',
    'all features implemented',
    'all features have been implemented',
    'fully complete',
    'fully implemented',
    'nothing remains',
    'no remaining work',
    'all goals achieved',
    'all objectives met',
    'everything is working',
    'all requirements met',
    'all requirements have been met',
    'project is finished',
    'build is complete',
  ];

  return completionPhrases.some((phrase) => lower.includes(phrase));
}

function extractSection(text: string, header: string): string | null {
  const regex = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

// --- Orchestrator Singleton ---

class Orchestrator {
  private activeBuildId: string | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  async startBuild(buildId: string): Promise<void> {
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build started');

    // Run setup and planning asynchronously so the API returns immediately
    this.initAndPlan(buildId).catch(async (err) => {
      await emitLog(buildId, 'error', `Build init failed: ${err.message}`);
    });
  }

  async pauseBuild(buildId: string): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.activeBuildId = null;

    // Mark any running iterations as failed (they were interrupted)
    await failOrphanedIterations(buildId);

    await db
      .update(jkaiBuilds)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build paused');
  }

  async resumeBuild(buildId: string): Promise<void> {
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    // Clean up any orphaned running iterations before resuming
    await failOrphanedIterations(buildId);

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build resumed');
    this.scheduleNext(buildId);
  }

  async stopBuild(buildId: string): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.activeBuildId = null;

    // Mark any running iterations as failed
    await failOrphanedIterations(buildId);

    await db
      .update(jkaiBuilds)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build stopped by user');
  }

  async continueBuild(buildId: string, improvementPrompt: string): Promise<void> {
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('Build not found');

    // Clean up any orphaned running iterations
    await failOrphanedIterations(buildId);

    this.activeBuildId = buildId;
    this.stopped = false;

    // Append the improvement prompt to the original build prompt
    const combinedPrompt = `${build.prompt}\n\n--- Continuation ---\nThe project above has been built. The user now wants the following improvements:\n${improvementPrompt}`;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', prompt: combinedPrompt, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', `Build continuing with new objectives: ${improvementPrompt.slice(0, 200)}`);

    // Run a fresh planning debate with full context of existing work, then resume iterations
    this.initContinuation(buildId, combinedPrompt).catch(async (err) => {
      await emitLog(buildId, 'error', `Continuation init failed: ${err.message}`);
      await db
        .update(jkaiBuilds)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      this.activeBuildId = null;
    });
  }

  private async initContinuation(buildId: string, combinedPrompt: string): Promise<void> {
    await ensureSandboxRunning();

    // Remove the old plan iteration (#0) so planBuild can create a fresh one
    await db
      .delete(jkaiIterations)
      .where(
        and(
          eq(jkaiIterations.buildId, buildId),
          eq(jkaiIterations.number, 0),
        ),
      );

    // Gather context from existing iterations
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

    const existingWork = completedIterations
      .filter((it) => it.number > 0)
      .map((it) => `### Iteration ${it.number}\n${it.evaluation || 'No evaluation'}`)
      .join('\n\n');

    const fileList = await listWorkspaceFiles(buildId);

    // Augment the prompt with existing work context
    const contextPrompt = `${combinedPrompt}\n\n--- Existing Work ---\nThe following iterations have already been completed:\n${existingWork}\n\nCurrent workspace files:\n${fileList || '(empty)'}\n\nPlan the next set of iterations to deliver the improvements. Build on what exists — do not start over.`;

    // Run a new 3-round planning debate
    await this.planBuild(buildId, contextPrompt);

    if (!this.stopped) {
      this.scheduleNext(buildId);
    }
  }

  getActiveBuildId(): string | null {
    return this.activeBuildId;
  }

  async recoverOnStartup(): Promise<void> {
    const [runningBuild] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.status, 'running'))
      .limit(1);

    if (!runningBuild) return;

    await failOrphanedIterations(runningBuild.id);

    await emitLog(runningBuild.id, 'system', 'Recovered after restart — resuming build');
    this.activeBuildId = runningBuild.id;
    this.stopped = false;
    this.scheduleNext(runningBuild.id);
  }

  private async initAndPlan(buildId: string): Promise<void> {
    await ensureSandboxRunning();
    await ensureWorkspace(buildId);

    const [buildRecord] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (buildRecord && !this.stopped) {
      await this.planBuild(buildId, buildRecord.prompt);
    }

    if (!this.stopped) {
      this.scheduleNext(buildId);
    }
  }

  // --- Private: Planning Phase ---

  private async planBuild(
    buildId: string,
    prompt: string,
    timeLimitMs: number = 4 * 60 * 1000,
  ): Promise<void> {
    const { client, model } = getLLMClient();
    const deadline = Date.now() + timeLimitMs;

    const [planIteration] = await db
      .insert(jkaiIterations)
      .values({ buildId, number: 0, status: 'running' })
      .returning();

    await emitLog(buildId, 'system', '━━━ Planning Phase (3-round debate) ━━━', planIteration.id);

    // --- System Prompts ---

    const proposerSystemPrompt = `You are a senior software architect creating a project delivery plan. You produce plans only — no code.

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

    const criticSystemPrompt = `You are a rigorous technical reviewer stress-testing a project delivery plan. Your job is to find real problems, not to validate. Be specific — cite the exact part of the plan that is problematic.

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
          { role: 'system', content: proposerSystemPrompt },
          { role: 'user', content: userPromptMsg },
        ],
        temperature: 0.7,
        max_tokens: 3000,
      });

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
          { role: 'system', content: criticSystemPrompt },
          ...debateMessages,
        ],
        temperature: 0.6,
        max_tokens: 2500,
      });

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
          { role: 'system', content: proposerSystemPrompt },
          ...debateMessages,
        ],
        temperature: 0.7,
        max_tokens: 3000,
      });

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

  // --- Private: Re-planning Phase (triggered on completion detection) ---

  private async replanBuild(buildId: string): Promise<boolean> {
    const { client, model } = getLLMClient();

    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) return false;

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

      const content = response.choices[0]?.message?.content || '';
      await emitLog(buildId, 'text', content);

      // Check if the LLM says the project is complete
      const isComplete = content.includes('## Complete') ||
        (content.toLowerCase().includes('no further iterations') && !content.includes('## Iteration Plan'));

      if (isComplete) {
        await emitLog(buildId, 'system', '━━━ Project Complete ━━━ No further work identified.');
        await db
          .update(jkaiBuilds)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(jkaiBuilds.id, buildId));
        this.activeBuildId = null;
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
      await db
        .update(jkaiBuilds)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      this.activeBuildId = null;
      return false;
    }
  }

  // --- Private: Loop ---

  private scheduleNext(buildId: string, delayMs = 0): void {
    this.loopTimer = setTimeout(() => this.runIteration(buildId), delayMs);
  }

  private async runIteration(buildId: string): Promise<void> {
    if (this.stopped || this.activeBuildId !== buildId) return;

    try {
      // Re-fetch build to get latest counters
      const [build] = await db
        .select()
        .from(jkaiBuilds)
        .where(eq(jkaiBuilds.id, buildId));

      if (!build || build.status !== 'running') return;

      const budget = await checkBudget(build);
      if (!budget.canProceed) {
        if (budget.shouldComplete) {
          await db
            .update(jkaiBuilds)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, buildId));
          await emitLog(buildId, 'system', `Build completed: ${budget.reason}`);
          this.activeBuildId = null;
          return;
        }
        await emitLog(buildId, 'system', `Cooling down: ${budget.reason}`);
        this.scheduleNext(buildId, budget.sleepMs || 60000);
        return;
      }

      // Get the highest iteration number (completed or failed) to avoid duplicates
      const [lastIteration] = await db
        .select()
        .from(jkaiIterations)
        .where(eq(jkaiIterations.buildId, buildId))
        .orderBy(desc(jkaiIterations.number))
        .limit(1);

      // Get last completed iteration for context
      const [prevIteration] = await db
        .select()
        .from(jkaiIterations)
        .where(
          and(
            eq(jkaiIterations.buildId, buildId),
            eq(jkaiIterations.status, 'completed'),
          ),
        )
        .orderBy(desc(jkaiIterations.number))
        .limit(1);

      const iterationNumber = (lastIteration?.number || 0) + 1;

      const [iteration] = await db
        .insert(jkaiIterations)
        .values({
          buildId,
          number: iterationNumber,
          status: 'running',
        })
        .returning();

      await emitLog(buildId, 'system', `━━━ Iteration #${iterationNumber} started ━━━`, iteration.id);

      // Fetch the project plan (iteration #0) if it exists
      const [planIteration] = await db
        .select()
        .from(jkaiIterations)
        .where(
          and(
            eq(jkaiIterations.buildId, buildId),
            eq(jkaiIterations.number, 0),
            eq(jkaiIterations.status, 'completed'),
          ),
        )
        .limit(1);
      const projectPlan = planIteration?.plan || null;

      // Seed dev from live so the LLM starts with the latest working version
      await seedDevFromLive(buildId);

      const startTime = Date.now();

      const result = await this.executeIteration(build, iteration, prevIteration, projectPlan, iterationNumber);

      const durationMs = Date.now() - startTime;

      // Always update the iteration record, even if no evaluation was produced
      await db
        .update(jkaiIterations)
        .set({
          status: 'completed',
          goals: result.goals,
          plan: result.plan,
          actions: result.actions,
          messages: result.messages,
          evaluation: result.evaluation,
          nextSteps: result.nextSteps,
          tokensUsed: result.tokensUsed,
          durationMs,
        })
        .where(eq(jkaiIterations.id, iteration.id));

      // Update build counters
      await db
        .update(jkaiBuilds)
        .set({
          iterationsCompleted: build.iterationsCompleted + 1,
          tokensUsed: build.tokensUsed + result.tokensUsed,
          activeMinutesUsed: build.activeMinutesUsed + durationMs / 60000,
          updatedAt: new Date(),
        })
        .where(eq(jkaiBuilds.id, buildId));

      // Run test suite
      await emitLog(buildId, 'system', 'Running tests...', iteration.id);
      const testResult = await runTests(buildId, `/home/jkai/workspace/${buildId}/dev`);
      const testEmoji = testResult.passed ? 'PASS' : 'FAIL';
      const testSummary = `${testEmoji} Tests: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed${testResult.failCount > 0 ? ` (${testResult.failCount} failed)` : ''}`;
      await emitLog(buildId, testResult.passed ? 'system' : 'error', `${testSummary}\n${testResult.output.slice(0, 2000)}`, iteration.id);

      // Snapshot this iteration's dev state
      await snapshotIteration(buildId, iterationNumber);

      // Append workspace state and test results to evaluation for next iteration's context
      const currentFiles = await listWorkspaceFiles(buildId);
      if (result.evaluation) {
        const extras = [
          currentFiles ? `\n\nWorkspace state after this iteration:\n${currentFiles}` : '',
          testResult.testCount > 0
            ? `\n\nTest results: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed${testResult.failCount > 0 ? `\nFailing tests:\n${testResult.output.slice(0, 1000)}` : ''}`
            : '',
        ].join('');
        result.evaluation = result.evaluation + extras;
        await db
          .update(jkaiIterations)
          .set({ evaluation: result.evaluation })
          .where(eq(jkaiIterations.id, iteration.id));
      }

      // Only promote to live if tests pass (or no tests exist)
      if (testResult.passed) {
        await this.checkServeConfig(buildId);
      } else {
        await emitLog(buildId, 'system', 'Skipping promotion to live — tests failed. Next iteration will receive failure context.', iteration.id);
      }

      // Log iteration summary
      const summary = [
        `━━━ Iteration #${iterationNumber} complete ━━━`,
        `Duration: ${(durationMs / 1000).toFixed(0)}s | Tokens: ${result.tokensUsed} | Actions: ${result.actions.length}`,
        testResult.testCount > 0 ? `Tests: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed` : 'No tests',
        result.evaluation ? `Evaluation: ${result.evaluation.slice(0, 200)}` : 'No evaluation produced (max turns reached)',
        result.nextSteps ? `Next: ${result.nextSteps.slice(0, 200)}` : '',
      ].filter(Boolean).join('\n');
      await emitLog(buildId, 'system', summary, iteration.id);

      // Check if the iteration signals project completion
      if (detectCompletion(result.evaluation)) {
        await emitLog(buildId, 'system', 'Completion detected — entering re-planning phase to review outcomes.');
        const shouldContinue = await this.replanBuild(buildId);
        if (!shouldContinue) return; // Build stopped or completed
      }

      this.scheduleNext(buildId, 1000);
    } catch (err: any) {
      await emitLog(buildId, 'error', `Iteration error: ${err.message}`);
      this.scheduleNext(buildId, 30000);
    }
  }

  private async executeIteration(
    build: JkaiBuild,
    iteration: JkaiIteration,
    prevIteration: JkaiIteration | null,
    projectPlan: string | null = null,
    iterationNumber: number = 1,
  ): Promise<{
    goals: string | null;
    plan: string | null;
    actions: ActionRecord[];
    messages: Array<{ role: string; content: string }>;
    evaluation: string | null;
    nextSteps: string | null;
    tokensUsed: number;
  }> {
    const { client, model } = getLLMClient();
    const systemPrompt = buildSystemPrompt(build.id);
    const fileList = await listWorkspaceFiles(build.id);
    const contextMessages = buildIterationContext(build.prompt, prevIteration, fileList, projectPlan, iterationNumber);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
    ];

    const actions: ActionRecord[] = [];
    let goals: string | null = null;
    let plan: string | null = null;
    let evaluation: string | null = null;
    let nextSteps: string | null = null;
    let totalTokens = 0;
    const maxTurns = 20;
    const maxTokensPerIteration = 100000; // Hard cap per iteration

    for (let turn = 0; turn < maxTurns; turn++) {
      if (this.stopped) break;

      // Progressive nudging toward evaluation
      if (turn >= 12 && !evaluation) {
        const turnsLeft = maxTurns - turn - 1;
        if (turnsLeft <= 0) {
          messages.push({
            role: 'user',
            content: 'This is your FINAL step. Write your ## Evaluation and ## Next Steps NOW. No code blocks.',
          });
        } else if (turnsLeft <= 3) {
          // Don't add extra message, but the continue prompt below will include the nudge
        }
      }

      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      });

      const assistantContent = response.choices[0]?.message?.content || '';
      totalTokens += response.usage?.total_tokens || 0;

      // Check per-iteration token cap
      if (totalTokens >= maxTokensPerIteration && !hasEvaluation(assistantContent)) {
        await emitLog(build.id, 'system', `Token cap reached (${totalTokens} tokens). Forcing evaluation.`, iteration.id);
        messages.push({
          role: 'user',
          content: 'You have exceeded the token budget for this iteration. Write your ## Evaluation and ## Next Steps NOW. No more code blocks.',
        });
        // Do one more turn to get the evaluation
        const evalResponse = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
        });
        const evalContent = evalResponse.choices[0]?.message?.content || '';
        totalTokens += evalResponse.usage?.total_tokens || 0;
        evaluation = extractSection(evalContent, 'Evaluation') || `Iteration stopped at token cap (${totalTokens} tokens). ${actions.length} actions executed.`;
        nextSteps = extractSection(evalContent, 'Next Steps') || 'Continue from where this iteration left off.';
        await emitLog(build.id, 'text', evalContent || evaluation, iteration.id);
        break;
      }

      messages.push({ role: 'assistant', content: assistantContent });

      // Persist messages incrementally
      await db
        .update(jkaiIterations)
        .set({
          messages: messages.filter((m) => m.role !== 'system'),
          tokensUsed: totalTokens,
        })
        .where(eq(jkaiIterations.id, iteration.id));

      if (turn === 0) {
        goals = assistantContent.split('\n').slice(0, 5).join('\n');
        const codeStart = assistantContent.indexOf('```');
        plan = codeStart > 0 ? assistantContent.slice(0, codeStart).trim() : assistantContent;
      }

      // Check for evaluation (signals iteration complete)
      if (hasEvaluation(assistantContent)) {
        evaluation = extractSection(assistantContent, 'Evaluation');
        nextSteps = extractSection(assistantContent, 'Next Steps');

        const textBeforeEval = assistantContent.split('## Evaluation')[0].trim();
        if (textBeforeEval) {
          await emitLog(build.id, 'text', textBeforeEval, iteration.id);
        }
        await emitLog(build.id, 'text', `## Evaluation\n${evaluation || ''}`, iteration.id);
        if (nextSteps) {
          await emitLog(build.id, 'text', `## Next Steps\n${nextSteps}`, iteration.id);
        }
        break;
      }

      // Check for code block
      const codeBlock = extractCodeBlock(assistantContent);
      if (codeBlock) {
        const textBefore = assistantContent.split('```')[0].trim();
        if (textBefore) {
          await emitLog(build.id, 'text', textBefore, iteration.id);
        }

        await emitLog(build.id, 'code', `\`\`\`${codeBlock.lang}\n${codeBlock.code}\n\`\`\``, iteration.id);

        // Execute code in the sandbox
        // execInSandbox now properly preserves newlines via base64, so all
        // multi-line scripts work correctly. For python/JS, we write to a
        // temp file and run with the correct interpreter.
        const workdir = `/home/jkai/workspace/${build.id}/dev`;
        let execCmd: string;
        if (['python'].includes(codeBlock.lang)) {
          // Write python code to temp file via bash heredoc (inside container, newlines preserved)
          const escaped = codeBlock.code.replace(/'/g, "'\\''");
          execCmd = `cd ${workdir} && cat > /tmp/jkai-code.py << 'JKAI_PYTHON_EOF'\n${codeBlock.code}\nJKAI_PYTHON_EOF\npython3 /tmp/jkai-code.py`;
        } else if (['javascript', 'typescript', 'node'].includes(codeBlock.lang)) {
          execCmd = `cd ${workdir} && cat > /tmp/jkai-code.js << 'JKAI_JS_EOF'\n${codeBlock.code}\nJKAI_JS_EOF\nnode /tmp/jkai-code.js`;
        } else {
          // Bash — executed directly (newlines preserved by execInSandbox)
          execCmd = `cd ${workdir}\n${codeBlock.code}`;
        }
        const execResult = await execInSandboxChecked(
          execCmd,
          codeBlock.code.includes('install') ? 300000 : 120000,
        );

        const action: ActionRecord = {
          lang: codeBlock.lang,
          code: codeBlock.code,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          exitCode: execResult.exitCode,
        };
        actions.push(action);

        const outputStr = [
          execResult.stdout ? `stdout:\n${execResult.stdout}` : '',
          execResult.stderr ? `stderr:\n${execResult.stderr}` : '',
          `exit code: ${execResult.exitCode}`,
        ]
          .filter(Boolean)
          .join('\n');
        await emitLog(build.id, 'output', outputStr, iteration.id);

        const turnsRemaining = maxTurns - turn - 1;
        let outputMsg = `Command output (exit code ${execResult.exitCode}):\n${execResult.stdout}\n${execResult.stderr ? `stderr: ${execResult.stderr}` : ''}`;
        if (turnsRemaining <= 5 && turnsRemaining > 2) {
          outputMsg += `\n\n[${turnsRemaining} steps remaining — start wrapping up soon]`;
        } else if (turnsRemaining <= 2 && turnsRemaining > 0) {
          outputMsg += `\n\n[Only ${turnsRemaining} step(s) left — write your ## Evaluation and ## Next Steps next]`;
        }
        messages.push({ role: 'user', content: outputMsg });
      } else {
        // Plain text response (no code, no evaluation)
        await emitLog(build.id, 'text', assistantContent, iteration.id);

        const turnsLeft = maxTurns - turn - 1;
        let continueMsg = 'Continue with your next step. Write exactly ONE code block per response, or if you are done, write your ## Evaluation and ## Next Steps.';
        if (turnsLeft <= 5 && turnsLeft > 2) {
          continueMsg = `You have ${turnsLeft} steps remaining in this iteration. Start planning your evaluation. Continue with code or write your ## Evaluation and ## Next Steps.`;
        } else if (turnsLeft <= 2 && turnsLeft > 0) {
          continueMsg = `Only ${turnsLeft} step(s) left! Write your ## Evaluation and ## Next Steps now, or execute ONE final critical command.`;
        }
        messages.push({ role: 'user', content: continueMsg });
      }
    }

    // If we exhausted maxTurns without an evaluation, synthesize one
    if (!evaluation) {
      evaluation = `Iteration reached maximum turns (${maxTurns}) without completing evaluation. ${actions.length} actions were executed.`;
      nextSteps = 'Continue from where this iteration left off.';
      await emitLog(build.id, 'system', `Auto-evaluation: ${evaluation}`, iteration.id);
    }

    return { goals, plan, actions, messages: messages.filter((m) => m.role !== 'system'), evaluation, nextSteps, tokensUsed: totalTokens };
  }

  private async checkServeConfig(buildId: string): Promise<void> {
    const raw = await readServeJson(buildId);
    if (!raw) return;

    const config = validateServeConfig(raw);
    if (!config) {
      await emitLog(buildId, 'system', 'Found serve.json but it failed validation');
      return;
    }

    const [build] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, buildId));

    const currentConfig = build?.serveConfig as any;
    const configChanged = currentConfig?.port !== config.port || currentConfig?.startCommand !== config.startCommand;

    // Always promote dev to live after a successful iteration
    await emitLog(buildId, 'system', 'Promoting dev → live');
    await promoteDevToLive(buildId);

    if (configChanged) {
      await emitLog(buildId, 'system', `Starting project server on port ${config.port}: ${config.startCommand}`);

      const healthy = await startProjectServer(
        buildId,
        config.startCommand,
        config.port,
        config.healthCheck,
      );

      if (healthy) {
        await db
          .update(jkaiBuilds)
          .set({ serveConfig: config, updatedAt: new Date() })
          .where(eq(jkaiBuilds.id, buildId));
        await emitLog(buildId, 'system', `Project server healthy at port ${config.port}`);
      } else {
        await emitLog(buildId, 'error', `Project server failed health check on port ${config.port}`);
      }
    } else if (currentConfig) {
      // Config unchanged but still promote and restart to pick up code changes
      await killProjectServer();
      const healthy = await startProjectServer(
        buildId,
        config.startCommand,
        config.port,
        config.healthCheck,
      );
      if (healthy) {
        await emitLog(buildId, 'system', `Project server restarted from live`);
      }
    }
  }

}

export const orchestrator = new Orchestrator();
