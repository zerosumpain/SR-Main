import {
  buildSystemPrompt,
  buildIterationContext,
  DESIGN_SYSTEM_PROMPT_BLOCK,
  type BuildPromptMode,
  type ChapterPlanEntry,
} from './prompt';
import {
  listWorkspaceFiles,
  allocatePort,
  ensureSandboxRunning,
  ensureWorkspace,
  syncDesignAssets,
  syncJkaiExtension,
} from './sandbox';
import { signBridgeToken } from './tool-bridge';
import { emitLog } from './log-emitter';
import type { ActionRecord, FailureEnvelope } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
import { runPi } from './pi-runner';
import { consumePendingDeliveries } from './workflow-deliveries';
import { buildAttachedWorkflowGrounding, buildDeliveriesBlock } from './workflow-grounding';
import { formatBriefForPrompt, type ResearchBrief } from './research-brief';

/**
 * Ask the tool bridge for its manifest exactly as the sandboxed agent will.
 *
 * Logs the outcome either way — a healthy build says how many tools it has, a
 * broken one says why it has none — and never throws: a missing bridge degrades
 * the build, it does not invalidate it. The agent still has its own file and
 * shell tools.
 */
/**
 * Check the bridge, and return the tool names the agent should be allowed to
 * call.
 *
 * The names matter, not just the count. pi's `--tools` is an allowlist that is
 * applied to extension-registered tools as well as built-ins
 * (agent-session.js `_refreshToolRegistry`: registered tools are filtered
 * through the same `isAllowedTool`). So a fixed allowlist of
 * read,bash,edit,write,grep,find,ls stripped every bridged tool before the
 * model ever saw it — while this function logged "Tool bridge OK — 167 site
 * tools available to the agent". Sixty days of iteration actions contain zero
 * bridged calls.
 *
 * Returns [] whenever the bridge is unusable, which the caller must treat as
 * "no site tools", never as "allow everything".
 */
async function preflightToolBridge(
  buildId: string,
  apiUrl: string,
  token: string,
  iterationId: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${apiUrl}/api/jkai/tools/manifest`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await emitLog(
        buildId,
        'error',
        `Tool bridge unavailable — ${apiUrl}/api/jkai/tools/manifest returned ${res.status}. ` +
          `This iteration will run with NO site tools (no workflow_*, datastore_*, gmail_* …). ` +
          `A 401 usually means the route is not exempted in hooks.server.ts or JKAI_BRIDGE_SECRET ` +
          `differs between this process and the web app; a connection error usually means ` +
          `JKAI_API_URL is stale — this process reads it once at start, so restart the builder ` +
          `after editing .env.`,
        iterationId,
      );
      return [];
    }
    const body = (await res.json().catch(() => null)) as
      | { tools?: Array<{ name?: unknown }> }
      | null;
    const names = (body?.tools ?? [])
      .map((t) => (typeof t?.name === 'string' ? t.name : null))
      .filter((n): n is string => Boolean(n));
    await emitLog(
      buildId,
      'system',
      names.length > 0
        ? `Tool bridge OK — ${names.length} site tools available to the agent.`
        : `Tool bridge reachable but published no usable tool names — this iteration runs with NO site tools.`,
      iterationId,
    );
    return names;
  } catch (err) {
    await emitLog(
      buildId,
      'error',
      `Tool bridge unreachable at ${apiUrl} (${(err as Error).message}). This iteration will run ` +
        `with NO site tools. JKAI_API_URL is read once at process start — restart the builder ` +
        `service after changing it.`,
      iterationId,
    );
  }
  return [];
}

// --- Section extraction (used by orchestrator for completion detection) ---

export function extractSection(text: string, header: string): string | null {
  const regex = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

// --- Iteration Result ---

export interface IterationResult {
  goals: string | null;
  plan: string | null;
  actions: ActionRecord[];
  messages: Array<{ role: string; content: string }>;
  evaluation: string | null;
  nextSteps: string | null;
  tokensUsed: number;
  failure: FailureEnvelope | null;
}

// --- Executor (pi-backed) ---

export async function executeIteration(
  build: JkaiBuild,
  iteration: JkaiIteration,
  prevIteration: JkaiIteration | null,
  projectPlan: string | null,
  iterationNumber: number,
  isStopped: () => boolean,
  systemPromptSuffix?: string,
  deadlineRef?: { current: number },
): Promise<IterationResult> {
  const workdir = `/home/jkai/workspace/${build.id}/dev`;

  // A git-target build is editing an existing repo and its deliverable is a
  // diff, not a preview server. It needs a different system prompt — see
  // REPO_SYSTEM_PROMPT in ./prompt for why the app-build one actively harms it.
  const gitTarget = (build as JkaiBuild & { gitTargetConfig?: { gateCommand?: string; finalGateCommand?: string } | null })
    .gitTargetConfig;
  const originIsStudio = (build as JkaiBuild & { origin?: string }).origin === 'studio';
  const promptMode: BuildPromptMode = gitTarget ? 'repo' : originIsStudio ? 'studio' : 'app';
  // promptMode is the single decider from here down. Every studio-only branch
  // below (design-system suffix, asset-mount, chapter-plan arg) reads
  // isStudio rather than origin directly, so a git-target build's repo
  // precedence flows through automatically instead of being re-decided per
  // branch.
  const isStudio = promptMode === 'studio';

  // Verify-then-fix: the sandbox may have been removed since the last iteration
  // (admin action, image rebuild, crash). Re-verify every time.
  await ensureSandboxRunning();
  await ensureWorkspace(build.id);

  const assignedPort = await allocatePort(build.id);

  let systemPrompt = buildSystemPrompt(build.id, assignedPort, promptMode);
  const enforceDesign = (build as JkaiBuild & { enforceDesignSystem?: boolean }).enforceDesignSystem !== false;
  if (enforceDesign && !isStudio) {
    systemPrompt += DESIGN_SYSTEM_PROMPT_BLOCK;
  }
  if (systemPromptSuffix) systemPrompt = `${systemPrompt}\n\n${systemPromptSuffix}`;

  // Sync design assets + jkai-tools extension into the sandbox before each run.
  // Updates land here so the agent always sees the latest tokens.
  const skillDirs: string[] = [];
  const extensions: string[] = [];
  const extraEnv: Record<string, string> = {};
  let bridgedToolNames: string[] = [];
  if (isStudio) {
    try {
      const { syncExplainerKit } = await import('./sandbox');
      const kitPath = await syncExplainerKit(build.id);
      skillDirs.push(kitPath);
    } catch (err) {
      // Loud, not silent. A studio build with no kit will invent its own
      // visual language, fail the visual gate, and burn iterations finding out.
      await emitLog(
        build.id,
        'error',
        `Explainer kit sync FAILED — this build will not have the kit: ${(err as Error).message}`,
        iteration.id,
      );
    }
  } else if (enforceDesign) {
    try {
      const dsPath = await syncDesignAssets(build.id);
      skillDirs.push(dsPath);
    } catch (err) {
      await emitLog(
        build.id,
        'system',
        `Design assets sync failed (continuing without): ${(err as Error).message}`,
        iteration.id,
      );
    }
  }
  try {
    const extPath = await syncJkaiExtension(build.id);
    extensions.push(extPath);
    // host.docker.internal only resolves inside the (now-retired) docker
    // sandbox. Host mode talks to the local SvelteKit web app on loopback.
    const HOST_DEFAULT = process.env.JKAI_BUILDS_HOSTMODE === '1'
      ? 'http://127.0.0.1:4173'
      : 'http://host.docker.internal:5173';
    extraEnv.JKAI_API_URL = process.env.JKAI_API_URL ?? HOST_DEFAULT;
    extraEnv.JKAI_BRIDGE_TOKEN = signBridgeToken(build.id);

    // Preflight the bridge from the orchestrator, before spending a single
    // model token. The extension itself only writes a line to stderr when the
    // manifest fetch fails, and the agent then runs with ZERO site tools while
    // appearing perfectly healthy — builds #125/#126 each burned ~1.5M tokens
    // that way before dying of something unrelated (2026-08-07). A tool-less
    // build is worth knowing about at second zero, not at minute twenty.
    // The names are the point, not just the count — they go into pi's
    // --tools allowlist below, which is the only way a bridged tool reaches
    // the model.
    bridgedToolNames = await preflightToolBridge(
      build.id,
      extraEnv.JKAI_API_URL,
      extraEnv.JKAI_BRIDGE_TOKEN,
      iteration.id,
    );
  } catch (err) {
    await emitLog(
      build.id,
      'system',
      `JKAI tools extension sync failed (continuing without): ${(err as Error).message}`,
      iteration.id,
    );
  }
  const thinkingLevel = (build as JkaiBuild & { thinkingLevel?: string }).thinkingLevel || undefined;

  const fileList = await listWorkspaceFiles(build.id);

  // Build a structured codebase digest — file map + extracted signatures —
  // injected into iteration context so the agent skips the rediscovery
  // phase. listDevFiles returns rich entries (path, size, mtime); the
  // digest helper picks the most-recently-modified relevant files,
  // summarises each, and produces a markdown block under 8 KB.
  const { listDevFiles } = await import('./sandbox');
  const { buildCodebaseDigest } = await import('./codebase-digest');
  const devFiles = await listDevFiles(build.id).catch(() => []);
  // The precedent channel spends ~4.8 KB of the same context. Shrink the digest
  // by the same amount rather than adding to a prompt that is already ~19 KB —
  // the digest's tail is its least relevant part.
  const precedentEnabled = promptMode === 'repo' && process.env.CODEGRAPH_PRECEDENT !== '0';
  const codebaseDigest = await buildCodebaseDigest(build.id, devFiles, {
    sharingBudgetWithPrecedent: precedentEnabled,
  }).catch(() => '');

  // Codegraph push — what this codebase has already learned about the files
  // this iteration is touching, or about the gate error the last one hit.
  //
  // Repo mode only: an app/studio build is greenfield and has no history in
  // this graph, so the retrieval would be a guaranteed miss and pure latency.
  //
  // Deliberately not fatal and deliberately not silent. The tool bridge spent
  // sixty days logging "OK" while returning nothing to 280 iterations, so this
  // logs three DISTINCT outcomes — served, empty, failed — and `empty` is a
  // real finding ("no precedent"), not a soft error. Timeboxed, because a slow
  // graph must cost the build nothing.
  let codegraphBlock = '';
  if (promptMode === 'repo' && process.env.CODEGRAPH_PUSH !== '0') {
    try {
      // Close the loop on the PREVIOUS iteration's serve first. This is the
      // earliest moment the answer exists: the gate has now run and its
      // diagnostics are in prevIteration.evaluation. Without this the evidence
      // counters stay at zero forever and ranking never leaves its recency bias.
      const { resolveBuildServes, recordServed } = await import('$lib/codegraph/feedback');
      const resolution = await resolveBuildServes({
        buildId: build.id,
        nextEvaluation: prevIteration?.evaluation ?? null,
        nextGatePassed: prevIteration ? /gate.{0,20}(passed|green)/i.test(prevIteration.evaluation ?? '') : null,
      }).catch(() => null);
      if (resolution && resolution.resolved > 0) {
        await emitLog(
          build.id,
          'system',
          `Codegraph feedback: ${resolution.resolved} serve(s) resolved as ${resolution.outcome} — ${resolution.lessons} lesson(s), ${resolution.episodes} episode(s) updated`,
          iteration.id,
        );
      }

      const { planBuildQuery, bareNamesInText, dirHintsInText } = await import(
        '$lib/codegraph/build-context'
      );
      // Bare filenames need the node table to become paths, so the lookup
      // happens here rather than inside the pure planner. Without it a task
      // that names `orchestrator.ts` instead of `src/lib/jkai/orchestrator.ts`
      // retrieves nothing at all — which is how build f85ed296 ran with no
      // context and no serve recorded.
      const { lookupNamedFiles } = await import('$lib/codegraph/name-lookup');
      const named = await lookupNamedFiles(
        bareNamesInText(build.prompt),
        dirHintsInText(build.prompt),
      );
      if (named.ambiguous.length) {
        await emitLog(
          build.id,
          'system',
          `Codegraph: ignored ${named.ambiguous.length} ambiguous filename(s) — ${named.ambiguous.join(', ')} (name each with its full path to seed from it)`,
          iteration.id,
        );
      }
      const planned = planBuildQuery(
        {
          prompt: build.prompt,
          previousEvaluation: prevIteration?.evaluation ?? null,
          previousActions: prevIteration?.actions ?? null,
        },
        named.resolved,
      );
      if (!planned) {
        await emitLog(build.id, 'system', 'Codegraph: nothing to query (no gate error, no file set)', iteration.id);
      } else {
        const { runCgql, buildContextBlock } = await import('$lib/codegraph/retrieve');
        const { db: database } = await import('$lib/db');
        const { codegraphQueries } = await import('$lib/db/schema');
        const result = await Promise.race([
          runCgql(planned.query),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500)),
        ]);
        codegraphBlock = buildContextBlock(result);
        const servedLessonIds = result.lessons.map((l) => l.id);
        const servedEpisodeIds = result.episodes.map((e) => e.id);
        await database.insert(codegraphQueries).values({
          channel: 'push',
          buildId: build.id,
          iterationId: iteration.id,
          query: planned.query,
          outcome: result.outcome,
          episodeIds: servedEpisodeIds,
          lessonIds: servedLessonIds,
          // The fingerprints that CAUSED this retrieval, kept so the next
          // iteration can tell whether what was served actually addressed them.
          servedFor: planned.fingerprints ?? [],
          charsServed: codegraphBlock.length,
          durationMs: result.durationMs,
        }).catch(() => {});
        await recordServed({ lessonIds: servedLessonIds, episodeIds: servedEpisodeIds }).catch(() => {});
        await emitLog(
          build.id,
          'system',
          result.outcome === 'served'
            ? `Codegraph: ${result.lessons.length} lesson(s), ${result.episodes.length} episode(s) from ${planned.reason} — ${codegraphBlock.length} chars in ${result.durationMs}ms`
            : `Codegraph: NO PRECEDENT for ${planned.reason} — this is new ground`,
          iteration.id,
        );
      }
    } catch (err) {
      // Loud, and distinguishable from "nothing found". A retrieval that fails
      // quietly is the failure mode this whole system exists to stop repeating.
      codegraphBlock = '';
      await emitLog(
        build.id,
        'error',
        `Codegraph push FAILED (continuing without): ${(err as Error).message}`,
        iteration.id,
      );
    }
  }

  /*
   * The precedent channel — what this repo's code actually LOOKS like.
   *
   * Separate from the codegraph push on purpose: different question, different
   * heading, its own kill switch and its own ledger row, so either can be
   * switched off and A/B'd without the other. Merging them would make the
   * budget impossible to attribute.
   *
   * codegraph picks the paths; the bytes come from this build's own workspace.
   * A sibling the clone does not have is skipped rather than injected as a file
   * the agent cannot open.
   */
  let precedentBlock = '';
  if (promptMode === 'repo' && process.env.CODEGRAPH_PRECEDENT !== '0') {
    try {
      const { precedentTargets, precedentQuery, skeleton, buildPrecedentBlock, PRECEDENT_MAX_FILES } =
        await import('$lib/codegraph/precedent');
      const { editedPathsFromActions, pathsInText, bareNamesInText, dirHintsInText } = await import(
        '$lib/codegraph/build-context'
      );
      const { lookupNamedFiles } = await import('$lib/codegraph/name-lookup');
      const named = await lookupNamedFiles(bareNamesInText(build.prompt), dirHintsInText(build.prompt));
      const targets = precedentTargets(
        editedPathsFromActions(prevIteration?.actions ?? null),
        pathsInText(build.prompt),
        named.resolved,
      );

      if (!targets.length) {
        await emitLog(build.id, 'system', 'Precedent: no target file to match a shape against', iteration.id);
      } else {
        const { runCgql } = await import('$lib/codegraph/retrieve');
        const { readDevFile } = await import('./sandbox');
        const { db: database } = await import('$lib/db');
        const { codegraphQueries } = await import('$lib/db/schema');

        const chosen: Array<{ target: string; path: string; source: string }> = [];
        const asked: string[] = [];
        const missing: string[] = [];

        for (const target of targets) {
          if (chosen.length >= PRECEDENT_MAX_FILES) break;
          const q = precedentQuery(target, PRECEDENT_MAX_FILES - chosen.length);
          if (!q) continue;
          asked.push(q);
          const result = await Promise.race([
            runCgql(q),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500)),
          ]);
          for (const node of result.nodes) {
            if (chosen.length >= PRECEDENT_MAX_FILES) break;
            if (chosen.some((c) => c.path === node.canonicalPath)) continue;
            // The workspace is the authority on what exists. A read that fails
            // means this clone predates the file, which is a fact about the
            // branch, not an error worth failing the iteration over.
            const source = await readDevFile(build.id, node.canonicalPath).catch(() => '');
            if (!source) { missing.push(node.canonicalPath); continue; }
            chosen.push({ target, path: node.canonicalPath, source: skeleton(source) });
          }
        }

        precedentBlock = buildPrecedentBlock(chosen);
        await database.insert(codegraphQueries).values({
          channel: 'precedent',
          buildId: build.id,
          iterationId: iteration.id,
          query: asked.join(' ;; ').slice(0, 2000),
          outcome: chosen.length ? 'served' : 'empty',
          episodeIds: [],
          lessonIds: [],
          servedFor: [],
          charsServed: precedentBlock.length,
          durationMs: 0,
        }).catch(() => {});

        await emitLog(
          build.id,
          'system',
          chosen.length
            ? `Precedent: ${chosen.map((c) => c.path).join(', ')} — ${precedentBlock.length} chars` +
              (missing.length ? ` (${missing.length} not in this clone)` : '')
            : `Precedent: NO PRECEDENT for ${targets.join(', ')} — no file of that shape in the graph`,
          iteration.id,
        );
      }
    } catch (err) {
      // Loud and non-fatal, same contract as the codegraph push.
      precedentBlock = '';
      await emitLog(
        build.id,
        'error',
        `Precedent channel FAILED (continuing without): ${(err as Error).message}`,
        iteration.id,
      );
    }
  }

  const contextMessages = buildIterationContext(
    build.prompt,
    prevIteration,
    fileList,
    projectPlan,
    iterationNumber,
    assignedPort,
    codebaseDigest,
    promptMode,
    gitTarget?.gateCommand ?? null,
    isStudio
      ? ((build as JkaiBuild & { chapterPlan?: Array<ChapterPlanEntry> }).chapterPlan ?? null)
      : null,
    gitTarget?.finalGateCommand ?? null,
  );

  const attachedIds = (build as JkaiBuild & { attachedWorkflowIds?: string[] }).attachedWorkflowIds ?? [];
  const attachedGrounding = attachedIds.length > 0 ? await buildAttachedWorkflowGrounding(attachedIds) : '';
  if (attachedGrounding) systemPrompt = `${systemPrompt}\n\n${attachedGrounding}`;

  // Studio: the research brief IS the agent's evidence base, and until now it
  // had exactly two readers — the planner, and the gate's sourceUrls list.
  // Never the agent. STUDIO_SYSTEM_PROMPT tells it "Your research brief is in
  // the context below" (false on every iteration) and chapter contract point 4
  // requires an <a data-citation> pointing at one of the brief's sources, which
  // studio-gate then checks against the brief's fact hosts. An agent that has
  // never seen the brief cannot satisfy that, so `uncited` fired on every
  // chapter forever with a remedy naming a document not in context — the
  // unfixable-finding loop. Appended before the notes and pending blocks so a
  // later human instruction still has the last word.
  if (isStudio) {
    const brief: ResearchBrief | null = build.researchBrief ?? null;
    if (brief) {
      systemPrompt = `${systemPrompt}\n\n${formatBriefForPrompt(brief)}`;
    } else {
      // Should be unreachable: initAndPlan aborts a studio build whose research
      // stage fails. Say so anyway rather than shipping a prompt that claims a
      // brief is present when it is not.
      await emitLog(
        build.id,
        'error',
        'Studio build has no research brief — the agent is being asked to cite sources it has not been given, ' +
          'and every chapter will fail the gate\'s citation check. Expect an unfixable `uncited` finding each iteration.',
        iteration.id,
      );
    }
  }

  // Phase 6: re-inject pinned notes every iteration. The user's "always
  // remember this" directives — applied as hard constraints by the agent.
  const { listNotes, formatNotesForPrompt } = await import('./build-notes');
  const notes = await listNotes(build.id).catch(() => []);
  const notesBlock = formatNotesForPrompt(notes);
  if (notesBlock) systemPrompt = `${systemPrompt}\n\n${notesBlock}`;

  // Phase 5: drain queued user messages (typed mid-iteration via the
  // session WebSocket). They take precedence over earlier instructions
  // where they conflict, so they're appended last.
  const { drainPendingMessages, formatPendingForPrompt } = await import('./pending-messages');
  const pending = await drainPendingMessages(build.id).catch(() => []);
  const pendingBlock = formatPendingForPrompt(pending);
  if (pendingBlock) systemPrompt = `${systemPrompt}\n\n${pendingBlock}`;

  const deliveries = await consumePendingDeliveries(build.id, 10).catch(() => []);
  const deliveriesBlock = buildDeliveriesBlock(deliveries);

  // Codegraph last: it is the most specific thing in the prompt, and what the
  // history says about THIS file set should be the freshest instruction the
  // agent reads before it starts work.
  const userPrompt = [
    deliveriesBlock,
    contextMessages.map((m) => m.content).join('\n\n'),
    // Shape first, then history: "here is how we write this" is context for
    // "here is what went wrong last time", not the other way round.
    precedentBlock,
    codegraphBlock,
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');

  await emitLog(
    build.id,
    'system',
    `Iteration #${iterationNumber} — assigned port ${assignedPort}, workdir ${workdir}`,
    iteration.id,
  );

  const result = await runPi({
    build,
    iteration,
    workdir,
    systemPrompt,
    userPrompt,
    isStopped,
    deadlineRef,
    extensions,
    skillDirs,
    thinkingLevel,
    extraEnv,
    bridgedToolNames,
  });

  const tailText = result.finalAssistantText || '';
  const goals = extractSection(tailText, 'Goals') ?? (tailText ? tailText.split('\n').slice(0, 4).join('\n') : null);
  const plan = extractSection(tailText, 'Plan') ?? null;
  let evaluation = extractSection(tailText, 'Evaluation');
  let nextSteps = extractSection(tailText, 'Next Steps');

  // Classify "empty output": pi finished without failure, but produced no tool
  // calls. Pi-runner can't distinguish this from a legitimate no-op turn, so
  // the executor owns the classification.
  let failure = result.failure;
  if (!failure && result.actions.length === 0) {
    failure = {
      kind: 'empty_output',
      message: 'Pi finished without making any tool calls.',
      attempts: 1,
    };
  }

  if (!evaluation) {
    evaluation =
      result.errorMessage
        ? `Iteration ended with error: ${result.errorMessage}`
        : failure?.kind === 'empty_output'
        ? `Pi produced no tool calls this turn (${failure.message}).`
        : `Iteration finished. Pi executed ${result.actions.length} tool calls. No structured evaluation produced — consider lowering iteration scope or checking the agent's final message.`;
  }
  if (!nextSteps) {
    nextSteps = 'Continue from where this iteration left off.';
  }

  return {
    goals,
    plan,
    actions: result.actions,
    messages: result.messages,
    evaluation,
    nextSteps,
    tokensUsed: result.tokensUsed,
    failure,
  };
}
