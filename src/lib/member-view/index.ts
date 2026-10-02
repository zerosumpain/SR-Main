// What a member sees of the owner's build machinery: jkai · develop,
// jkai · codegraph and the daydream impact room ($lib/access/catalogue).
//
// The admin showcase's rule ($lib/server/showcase), for more rooms: a page's
// LOAD (or an API's handler) strips what is personal or secret before it
// returns, never the template, because everything a load returns is serialised
// into __data.json whether the page draws it or not.
//
// Every helper here is an ALLOW list. A field added to a source type later is
// dropped for members until someone decides it is safe, rather than shipped
// because nobody thought to strip it. Pure: no server imports, so each rule is
// unit-tested on its own (index.test.ts).

import type { DeliveryState } from '$lib/constants/development';
import type { BacklogEpic } from '$lib/selfimprove/backlog-room';
import type { BoardView, IdeaSource, WorkItem } from '$lib/selfimprove/board';
import type { DoctorRunData, NarrativeRun, PhaseName, PhaseRecord } from '$lib/workflows/doctor-client';

// ── develop ──────────────────────────────────────────────────────────────────

/**
 * An archive row with nothing but its shape: the prompt, conversation, model,
 * git, budget and serve config are the owner's; what it cost is spend, which
 * the member hub never shows.
 */
export function memberArchiveRow<
  T extends {
    id: string;
    title: string | null;
    status: string;
    outcome: string | null;
    planStatus: string | null;
    origin: string | null;
    publishedSlug: string | null;
    projectSlug?: string | null;
    cardTitle: string | null;
    cardBlurb: string | null;
    cardTag: string | null;
    iterationCount: number;
    createdAt: string | Date;
  },
>(b: T) {
  return {
    id: b.id,
    title: b.title,
    // The page falls back to the prompt for an untitled build; a member's
    // fallback is nothing, so the prompt never has to ship.
    prompt: '',
    status: b.status,
    outcome: b.outcome,
    planStatus: b.planStatus,
    origin: b.origin,
    gitTargetConfig: null,
    publishedSlug: b.publishedSlug,
    projectSlug: b.projectSlug ?? null,
    serveConfig: null,
    cardTitle: b.cardTitle,
    cardBlurb: b.cardBlurb,
    cardTag: b.cardTag,
    iterationCount: b.iterationCount,
    tokensUsed: null,
    createdAt: b.createdAt,
  };
}

/**
 * A delivery's state with its prose taken out. The brief, the criteria's text
 * and evidence, the worker's questions and the owner's answers, the session,
 * the patch, the gate and preview evidence are all what the owner typed or
 * what a build read; the stage, the area, the verdicts and the release link
 * are the shape of the work, and SR-Main is a public repository.
 */
export function memberDeliveryState(s: DeliveryState): DeliveryState {
  return {
    version: 1,
    commissioned: s.commissioned,
    area: s.area,
    stage: s.stage,
    brief: {
      revision: s.brief?.revision ?? 0,
      outcome: '',
      constraints: '',
      routes: [],
      acceptedAt: s.brief?.acceptedAt ?? null,
    },
    criteria: (s.criteria ?? []).map((c) => ({
      id: c.id,
      text: 'Criterion',
      verdict: c.verdict,
      evidence: '',
      revision: c.revision,
      ...(c.assessment
        ? {
            assessment: {
              basis: c.assessment.basis,
              verdict: c.assessment.verdict,
              evidence: '',
              model: '',
              revision: c.assessment.revision,
              at: c.assessment.at,
            },
          }
        : {}),
    })),
    decisions: [],
    session: { engine: 'pi', id: null, file: null, recovery: null },
    candidate: s.candidate,
    gate: s.gate ? { passed: s.gate.passed, evidence: '', revision: s.gate.revision } : null,
    preview: { status: s.preview?.status ?? 'unavailable', url: null, detail: '' },
    batch: null,
    acceptedAt: s.acceptedAt,
    releasePolicy: s.releasePolicy,
    ...(s.autopilot
      ? {
          autopilot: {
            enabled: s.autopilot.enabled,
            rounds: s.autopilot.rounds,
            maxRounds: s.autopilot.maxRounds,
            startedAt: s.autopilot.startedAt,
            lastRoundAt: s.autopilot.lastRoundAt,
            stopReason: s.autopilot.stopReason ? 'Stopped' : undefined,
          },
        }
      : {}),
    ...(s.release
      ? {
          release: {
            revision: s.release.revision,
            prUrl: s.release.prUrl,
            prNumber: s.release.prNumber,
            ci: s.release.ci,
            mergedAt: s.release.mergedAt,
            deployedAt: s.release.deployedAt,
          },
        }
      : {}),
  };
}

/**
 * The channels whose item titles are the engine's words about the site's own
 * tools. Everything else was written from something personal — a question the
 * owner asked, a chat he analysed, a daydream note, a workflow of his that
 * failed, his own entry — or cannot be traced (`unattributed`), so its title
 * is replaced.
 */
const TITLE_SAFE_INTAKE: ReadonlySet<IdeaSource> = new Set<IdeaSource>(['engine', 'health', 'starved', 'appetite', 'toolsmith']);

const INTAKE_WORDS: Partial<Record<IdeaSource, string>> = {
  owner: 'An idea John added',
  question: 'An idea from a question',
  think: 'An idea from daydream',
  fault: 'An idea from daydream',
  doctor: 'A fix the workflow doctor asked for',
  trace: 'An idea from a chat',
};

function titleIsSafe(i: WorkItem): boolean {
  return i.intake !== null && TITLE_SAFE_INTAKE.has(i.intake);
}

export function memberWorkItem(i: WorkItem): WorkItem {
  return {
    id: i.id,
    source: i.source,
    slug: i.slug,
    title: titleIsSafe(i) ? i.title : (i.intake && INTAKE_WORDS[i.intake]) || 'An idea',
    detail: '',
    grooming: null,
    kind: i.kind,
    lane: i.lane,
    stage: i.stage,
    backlogStatus: i.backlogStatus,
    priority: i.priority,
    attempts: i.attempts,
    attemptCeiling: i.attemptCeiling,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    lastError: null,
    artifact: null,
    artifactHref: null,
    calls: i.calls,
    errorRate: i.errorRate,
    newData: i.newData,
    alreadyServed: i.alreadyServed,
    servedBy: null,
    foldedCount: i.foldedCount,
    foldedInto: i.foldedInto,
    parkedReason: null,
    epicSlug: i.epicSlug,
    epicLabel: '',
    capabilitySlug: null,
    intake: i.intake,
    score: null,
    evidence: [],
    noteCount: 0,
    lastNoteAt: null,
    settledAt: i.settledAt,
    // Read-only: the room's controls are the owner's, and every one is a POST.
    actionable: false,
  };
}

/**
 * The backlog room, redacted. An epic's title is built from its members'
 * titles, so it is kept only when every member's title is; otherwise it is
 * named by position and its categories.
 */
export function memberBacklog(epics: BacklogEpic[], board: BoardView): { epics: BacklogEpic[]; board: BoardView } {
  const outEpics = epics.map((e, n) => {
    const safe = e.deliverables.every(titleIsSafe) && e.combinedDeliveries.every(titleIsSafe);
    return {
      slug: e.slug,
      title: safe ? e.title : `Group ${n + 1}${e.categories.length ? ` · ${e.categories.join(', ')}` : ''}`,
      summary: '',
      priority: e.priority,
      stage: e.stage,
      deliverables: e.deliverables.map(memberWorkItem),
      combinedDeliveries: e.combinedDeliveries.map(memberWorkItem),
      categories: e.categories,
      completed: e.completed,
      updatedAt: e.updatedAt,
    };
  });
  return {
    epics: outEpics,
    board: { ...board, items: board.items.map(memberWorkItem), error: board.error ? 'The backlog could not be read.' : null },
  };
}

// ── doctor ───────────────────────────────────────────────────────────────────

/** A doctor night as numbers: no actions, no report, no phase detail, no cost. */
export function memberDoctorRun(r: NarrativeRun): NarrativeRun {
  const d = r.data ?? ({} as DoctorRunData);
  const phases = {} as Record<PhaseName, PhaseRecord>;
  for (const [name, p] of Object.entries(d.phases ?? {}) as Array<[PhaseName, PhaseRecord]>) {
    phases[name] = { status: p.status, ms: p.ms };
  }
  return {
    runId: r.runId,
    createdAt: r.createdAt,
    data: {
      status: d.status,
      trigger: d.trigger,
      startedAt: d.startedAt,
      finishedAt: d.finishedAt,
      phases,
      llmCalls: d.llmCalls,
      tokensIn: d.tokensIn,
      tokensOut: d.tokensOut,
      costUsd: 0,
      workflowsFailing: d.workflowsFailing,
      signaturesSeen: d.signaturesSeen,
      autoApplyEnabled: d.autoApplyEnabled,
      breakerEnabled: d.breakerEnabled,
      fixesApplied: d.fixesApplied,
      fixesReverted: d.fixesReverted,
      fixesRefusedSensitive: d.fixesRefusedSensitive,
      schedulesQuarantined: d.schedulesQuarantined,
      proposalsOpened: d.proposalsOpened,
      findingsResolved: d.findingsResolved,
      whatsappDelivered: d.whatsappDelivered,
      actions: [],
      report: '',
    },
  };
}

// ── codegraph ────────────────────────────────────────────────────────────────

/**
 * The repositories whose graph a member may read: public on GitHub, so every
 * path and summary in it already is. Lessons are another matter — they are
 * the owner's memory notes, word for word (scripts/codegraph-backfill.mjs) —
 * and are never shown, whatever the repository.
 */
export const MEMBER_CODEGRAPH_REPOS: readonly string[] = ['SR-Main'];

export function memberMayReadRepo(repo: string | null | undefined): boolean {
  return !!repo && MEMBER_CODEGRAPH_REPOS.includes(repo);
}

type Row = Record<string, unknown>;

/** A lesson on a file, reduced to its counts: title, body and origin are memory. */
export function memberLessonRow(l: Row, n: number): Row {
  return {
    id: l.id,
    title: `Lesson ${n + 1}`,
    body: '',
    origin: null,
    stale_at: l.stale_at ?? null,
    observed_at: l.observed_at ?? null,
    served_count: l.served_count ?? 0,
    helpful_count: l.helpful_count ?? 0,
    unhelpful_count: l.unhelpful_count ?? 0,
  };
}

/** An episode on a file: its verdict and PR, never the verification or resolution prose. */
export function memberEpisodeRow(e: Row): Row {
  return {
    id: e.id,
    title: e.title ?? null,
    fingerprint: e.fingerprint ?? null,
    gate: e.gate ?? null,
    verdict: e.verdict ?? null,
    resolution: null,
    verification: null,
    pr_number: e.pr_number ?? null,
    occurred_at: e.occurred_at ?? null,
    served_count: e.served_count ?? 0,
    helpful_count: e.helpful_count ?? 0,
    unhelpful_count: e.unhelpful_count ?? 0,
  };
}

/** A ranked unit on /jkai/codegraph/relevance: a lesson's title is a memory note's description. */
export function memberRelevanceUnit<T extends { kind: 'lesson' | 'episode'; title: string; detail: string }>(u: T, n: number): T {
  return u.kind === 'lesson' ? { ...u, title: `Lesson ${n + 1}` } : u;
}

/** A recent serve: channel, outcome and timing. The query and error are what a build read. */
export function memberServeRow(r: Row): Row {
  return {
    channel: r.channel,
    query: '',
    outcome: r.outcome,
    chars_served: r.chars_served,
    duration_ms: r.duration_ms,
    build_id: null,
    error_message: null,
    created_at: r.created_at,
  };
}

/** A build on the serves page: counts, no title (it falls back to the prompt). */
export function memberServesBuild(b: Row): Row {
  return { ...b, title: 'A build' };
}

/** A registered source: only the non-owner ones, and never their payload. */
export function memberSources<T extends { access: string; payload: Record<string, unknown> }>(rows: T[]): T[] {
  return rows.filter((r) => r.access !== 'owner').map((r) => ({ ...r, payload: {} }));
}

/** A maintenance suggestion: an assessment's evidence is free text, so the reason becomes its kind. */
export function memberSuggestion<T extends { kind: string; reason: string }>(s: T): T {
  return { ...s, reason: `Suggested: ${s.kind}.` };
}

/** An outcome cohort without its budget or spend. */
export function memberOutcome(o: Row): Row {
  return { ...o, budget_config: null, mean_cost: null };
}

// ── links ────────────────────────────────────────────────────────────────────

/**
 * True when a link on an opened page leads somewhere this viewer can go. The
 * owner passes no `reach` and follows everything; a member follows only a page
 * their grants open (`memberReach`, from the /jkai layout). A `[param]` page
 * is never in reach, so a link into the owner's rows (a canvas, a feature
 * workspace) is hidden rather than left to 403.
 */
export function mayFollow(href: string, reach: readonly string[] | null | undefined): boolean {
  if (!reach) return true;
  return reach.includes(href.split(/[?#]/)[0]);
}
