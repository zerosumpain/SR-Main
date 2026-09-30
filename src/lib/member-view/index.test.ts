import { describe, expect, it } from 'vitest';
import type { DeliveryState } from '$lib/constants/development';
import type { BacklogEpic } from '$lib/selfimprove/epic-backlog';
import type { BoardView, WorkItem } from '$lib/selfimprove/board';
import type { NarrativeRun } from '$lib/workflowdoctor/narrative';
import {
  mayFollow,
  memberArchiveRow,
  memberBacklog,
  memberDeliveryState,
  memberDoctorRun,
  memberEpisodeRow,
  memberLessonRow,
  memberMayReadRepo,
  memberOutcome,
  memberRelevanceUnit,
  memberServeRow,
  memberServesBuild,
  memberSources,
  memberSuggestion,
  memberWorkItem,
} from './index';

const SECRET = 'my bank refresh token and Katie’s birthday';

/** Nothing sensitive survives anywhere in the serialised value. */
function clean(v: unknown) {
  expect(JSON.stringify(v)).not.toContain(SECRET);
}

describe('develop', () => {
  it('an archive row keeps its shape and drops the prompt, config and cost', () => {
    const row = memberArchiveRow({
      id: 'b1', title: 'Fix the map', prompt: SECRET, status: 'done', outcome: 'delivered', planStatus: null,
      origin: 'manual', gitTargetConfig: { token: SECRET }, publishedSlug: 'map', projectSlug: null,
      serveConfig: { env: SECRET }, cardTitle: null, cardBlurb: null, cardTag: null, iterationCount: 3,
      tokensUsed: 900, costUsd: 4.2, conversationId: SECRET, budgetConfig: { cap: 9 }, createdAt: '2026-09-01',
    });
    clean(row);
    expect(row).toMatchObject({ id: 'b1', title: 'Fix the map', prompt: '', iterationCount: 3, tokensUsed: null });
    expect(row).not.toHaveProperty('costUsd');
    expect(row).not.toHaveProperty('conversationId');
  });

  it('a delivery keeps stage, area and verdicts, and no prose', () => {
    const state = {
      version: 1, area: 'Maps', stage: 'review', originalAsk: SECRET,
      grooming: { turns: [{ questions: SECRET, answer: SECRET }], model: 'm', at: 'x', summary: SECRET },
      brief: { scope: SECRET, revision: 2, outcome: SECRET, constraints: SECRET, routes: ['/secret'], acceptedAt: 'a' },
      criteria: [{ id: 'c1', text: SECRET, verdict: 'passed', evidence: SECRET, revision: 'r',
        assessment: { basis: 'observed', verdict: 'passed', evidence: SECRET, model: 'gpt', revision: 'r', at: 't' } }],
      decisions: [{ id: 'd', question: SECRET, answer: SECRET }],
      session: { engine: 'pi', id: SECRET, file: SECRET, recovery: SECRET },
      candidate: 'r', changes: { files: ['a'], patch: SECRET },
      gate: { passed: true, evidence: SECRET, revision: 'r' },
      preview: { url: 'https://preview', status: 'ready', detail: SECRET, lastError: SECRET, evidence: [SECRET] },
      batch: SECRET, acceptedAt: null, releasePolicy: 'preview_only',
      autopilot: { enabled: true, rounds: 1, maxRounds: 6, startedAt: 's', stopReason: SECRET, veto: { reason: SECRET, evidence: SECRET, model: 'm', revision: 'r', at: 't' } },
      release: { revision: 'r', prUrl: 'https://github.com/pr/1', detail: SECRET, blocker: SECRET },
    } as unknown as DeliveryState;
    const out = memberDeliveryState(state);
    clean(out);
    expect(out.stage).toBe('review');
    expect(out.area).toBe('Maps');
    expect(out.criteria[0].verdict).toBe('passed');
    expect(out.criteria[0].assessment?.verdict).toBe('passed');
    expect(out.release?.prUrl).toBe('https://github.com/pr/1');
    expect(out.preview.url).toBeNull();
    expect(out.autopilot?.stopReason).toBe('Stopped');
  });
});

function item(over: Partial<WorkItem>): WorkItem {
  return {
    id: 'backlog:x', source: 'backlog', slug: 'x', title: SECRET, detail: SECRET, grooming: { brief: SECRET } as never,
    kind: 'tool', lane: 'repo' as never, stage: 'proposed', backlogStatus: 'open', priority: 2, attempts: 0,
    attemptCeiling: 3, createdAt: 'c', updatedAt: 'u', lastError: SECRET, artifact: SECRET, artifactHref: SECRET,
    calls: null, errorRate: null, newData: false, alreadyServed: false, servedBy: SECRET,
    absorbedRequirements: { a: SECRET }, mergedBrief: SECRET, foldedCount: 0, foldedInto: null, parkedReason: SECRET,
    epicSlug: 'e', epicLabel: SECRET, capabilitySlug: null, intake: 'think', score: null, evidence: [SECRET],
    noteCount: 2, lastNoteAt: 'l', settledAt: null, actionable: true, commissionId: SECRET,
    ...over,
  };
}

describe('backlog', () => {
  it('replaces a title from a personal channel and keeps an engine one', () => {
    expect(memberWorkItem(item({ intake: 'question' })).title).toBe('An idea from a question');
    expect(memberWorkItem(item({ intake: 'unattributed' })).title).toBe('An idea');
    expect(memberWorkItem(item({ intake: 'engine', title: 'Index the tool table' })).title).toBe('Index the tool table');
  });

  it('drops every free-text field and makes the card read-only', () => {
    const out = memberWorkItem(item({}));
    clean(out);
    expect(out.actionable).toBe(false);
    expect(out).not.toHaveProperty('commissionId');
    expect(out).not.toHaveProperty('mergedBrief');
  });

  it("names an epic by position when any member's title was replaced", () => {
    const epic = {
      slug: 'e', title: SECRET, summary: SECRET, priority: 1, stage: 'proposed',
      deliverables: [item({})], combinedDeliveries: [], categories: ['tool'], completed: 0, updatedAt: 'u',
      suggestions: [{ reason: SECRET }], groomingHistory: [{ note: SECRET }], groomingOverrides: ['x'],
    } as unknown as BacklogEpic;
    const board = { items: [item({})], error: null } as unknown as BoardView;
    const out = memberBacklog([epic], board);
    clean(out);
    expect(out.epics[0].title).toBe('Group 1 · tool');
    expect(out.epics[0]).not.toHaveProperty('suggestions');
  });
});

describe('doctor', () => {
  it('keeps the night as numbers', () => {
    const run = {
      runId: 'r1', createdAt: 'c',
      data: {
        status: 'complete', trigger: 'cron', startedAt: 's', phases: { gather: { status: 'ok', detail: SECRET, ms: 20 } },
        llmCalls: 2, tokensIn: 1, tokensOut: 1, costUsd: 3.5, workflowsFailing: 4, signaturesSeen: 1,
        autoApplyEnabled: false, breakerEnabled: true, fixesApplied: 1, fixesReverted: 0, fixesRefusedSensitive: 0,
        schedulesQuarantined: 0, proposalsOpened: 0, findingsResolved: 0, whatsappDelivered: true,
        actions: [{ workflow: SECRET }], report: SECRET,
      },
    } as unknown as NarrativeRun;
    const out = memberDoctorRun(run);
    clean(out);
    expect(out.data.workflowsFailing).toBe(4);
    expect(out.data.costUsd).toBe(0);
    expect(out.data.phases.gather).toEqual({ status: 'ok', ms: 20 });
  });
});

describe('codegraph', () => {
  it('reads only public repositories', () => {
    expect(memberMayReadRepo('SR-Main')).toBe(true);
    expect(memberMayReadRepo('SR-Policy-Analysis')).toBe(false);
    expect(memberMayReadRepo(null)).toBe(false);
  });

  it('never shows a lesson’s words', () => {
    const out = memberLessonRow({ id: 'l1', title: SECRET, body: SECRET, origin: SECRET, served_count: 3 }, 0);
    clean(out);
    expect(out).toMatchObject({ id: 'l1', title: 'Lesson 1', served_count: 3 });
  });

  it('drops an episode’s verification and resolution', () => {
    const out = memberEpisodeRow({ id: 'e', title: 'Gate failed', verification: SECRET, resolution: SECRET, problem: SECRET, source_id: SECRET, verdict: 'repaired' });
    clean(out);
    expect(out.verdict).toBe('repaired');
  });

  it('numbers a lesson on the relevance page and leaves an episode', () => {
    expect(memberRelevanceUnit({ kind: 'lesson', title: SECRET, detail: 'a.ts' }, 4).title).toBe('Lesson 5');
    expect(memberRelevanceUnit({ kind: 'episode', title: 'Gate', detail: 'f' }, 0).title).toBe('Gate');
  });

  it('strips serves, builds, sources, suggestions and outcomes', () => {
    clean(memberServeRow({ channel: 'push', query: SECRET, error_message: SECRET, build_id: SECRET, outcome: 'served' }));
    clean(memberServesBuild({ id: 'b', title: SECRET, served: 2 }));
    const sources = memberSources([
      { access: 'owner', payload: { text: 'x' }, title: SECRET },
      { access: 'public', payload: { text: SECRET }, title: 'Svelte docs' },
    ]);
    clean(sources);
    expect(sources).toHaveLength(1);
    clean(memberSuggestion({ kind: 'stale', reason: SECRET }));
    const o = memberOutcome({ model_id: 'm', budget_config: { cap: SECRET }, mean_cost: 3 });
    clean(o);
    expect(o.mean_cost).toBeNull();
  });
});

describe('mayFollow', () => {
  it('lets the owner (no reach) follow anything', () => {
    expect(mayFollow('/admin/ai/doctor', undefined)).toBe(true);
  });

  it('lets a member follow only a page in reach, ignoring the query', () => {
    const reach = ['/jkai/codegraph', '/jkai/develop/backlog'];
    expect(mayFollow('/jkai/develop/backlog', reach)).toBe(true);
    expect(mayFollow('/jkai/codegraph?repo=SR-Main#x', reach)).toBe(true);
    expect(mayFollow('/jkai/codegraph/ask?q=file', reach)).toBe(false);
    expect(mayFollow('/jkai/canvas/monthly-burn', reach)).toBe(false);
    expect(mayFollow('/jkai/daydreams', reach)).toBe(false);
  });
});
