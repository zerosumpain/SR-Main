// src/lib/selfimprove/analyze.ts
//
// GATHER + LEARN phases. Gather pulls the last 7 days of user questions plus
// tool telemetry and current insights; Learn makes ONE gateway call to classify
// intents and surface unmet needs, then upserts the `question_insights` records
// (`latest` + `weekly:<YYYY-WW>`).

import { db } from '$lib/db';
import { orchestratorChats, customTools } from '$lib/db/schema';
import { and, eq, gte, desc } from 'drizzle-orm';
import { DatastoreError, getRecordByKey, upsertRecord } from '$lib/datastore';
import { getToolAudit } from '$lib/server/tool-audit';
import {
  COLLECTIONS,
  SYSTEM_ACTOR,
  asData,
  errMsg,
  isoWeekKey,
  type QuestionInsights,
  type RunAction,
} from './types';
import type { Budget } from './run';
import { addIdeas } from './backlog';
import { collectStarvation } from '$lib/daydream/starvation';
import { collectHealthFaults } from '$lib/daydream/health-quality';
import { collectFaultIdeas } from '$lib/daydream/faults';
import { engineProposals } from '$lib/daydream/engine-proposals';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 300;
const MAX_BODY_CHARS = 500;

export interface GatheredSignals {
  messages: Array<{ content: string; createdAt: string }>;
  toolAudit: unknown | null;
  customTools: Array<{ name: string; runCount: number; errorCount: number }>;
  currentInsights: QuestionInsights | null;
}

/** GATHER: recent user questions + tool telemetry + custom-tool health + current insights. */
export async function gatherSignals(): Promise<GatheredSignals> {
  const since = new Date(Date.now() - SEVEN_DAYS_MS);

  let messages: GatheredSignals['messages'] = [];
  try {
    const rows = await db
      .select({ content: orchestratorChats.content, createdAt: orchestratorChats.createdAt })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.role, 'user'), gte(orchestratorChats.createdAt, since)))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(MAX_MESSAGES);
    messages = rows
      // Strip long bodies (pasted docs, not questions) to keep the signal clean.
      .filter((r) => (r.content ?? '').length <= MAX_BODY_CHARS)
      .map((r) => ({
        content: (r.content ?? '').trim(),
        createdAt: (r.createdAt ?? new Date()).toISOString(),
      }))
      .filter((m) => m.content.length > 0);
  } catch (err) {
    console.error('[selfimprove] gather messages failed:', errMsg(err));
  }

  let toolAudit: unknown | null = null;
  try {
    toolAudit = await getToolAudit(7);
  } catch {
    toolAudit = null;
  }

  let ctRows: GatheredSignals['customTools'] = [];
  try {
    ctRows = await db
      .select({
        name: customTools.name,
        runCount: customTools.runCount,
        errorCount: customTools.errorCount,
      })
      .from(customTools);
  } catch {
    ctRows = [];
  }

  let currentInsights: QuestionInsights | null = null;
  try {
    const rec = await getRecordByKey(COLLECTIONS.questionInsights, 'latest', SYSTEM_ACTOR);
    currentInsights = rec.data as unknown as QuestionInsights;
  } catch (err) {
    if (!(err instanceof DatastoreError && err.code === 'not_found')) {
      console.error('[selfimprove] read current insights failed:', errMsg(err));
    }
  }

  return { messages, toolAudit, customTools: ctRows, currentInsights };
}

function compactToolAudit(audit: unknown): unknown {
  if (!audit || typeof audit !== 'object') return null;
  const a = audit as Record<string, unknown>;
  const top = (list: unknown) => (Array.isArray(list) ? list.slice(0, 15) : undefined);
  return {
    totalCalls: a.totalCalls,
    uniqueTools: a.uniqueTools,
    topTools: top(a.tools),
    resolvedJkaiTools: top(a.jkaiTools),
  };
}

function buildLearnMessages(signals: GatheredSignals): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are the analysis brain of a personal AI assistant ("jkai") for its single technical owner. ' +
    'You are given the owner\'s recent questions plus tool-usage telemetry. Classify the questions into ' +
    'a small set of INTENTS, and identify UNMET NEEDS — recurring questions with no good live data source or ' +
    'tool behind them (these become candidates for new API integrations or custom tools). ' +
    'Respond with ONLY a JSON object of the form: ' +
    '{"summary": string, "intents": [{"intent": string, "count": number, "examples": string[], ' +
    '"servedWell": boolean, "missingCapability": string}], "topUnmet": string[]}. ' +
    'Keep intents to at most 10, examples to at most 3 each, topUnmet to at most 5 short phrases. No prose outside the JSON.';

  const payload = {
    questionCount: signals.messages.length,
    recentQuestions: signals.messages.slice(0, 200).map((m) => m.content),
    toolUsage: compactToolAudit(signals.toolAudit),
    customToolHealth: signals.customTools.slice(0, 30),
    previousInsightsSummary: signals.currentInsights?.summary ?? null,
  };
  const user = `Signals (last 7 days):\n\n${JSON.stringify(payload, null, 2)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function coerceInsights(json: unknown, period: string): QuestionInsights {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const intentsRaw = Array.isArray(obj.intents) ? obj.intents : [];
  const intents = intentsRaw.slice(0, 10).map((i) => {
    const o = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
    return {
      intent: String(o.intent ?? 'unknown'),
      count: Number(o.count ?? 0) || 0,
      examples: Array.isArray(o.examples) ? o.examples.slice(0, 3).map(String) : [],
      servedWell: o.servedWell === true,
      missingCapability: o.missingCapability ? String(o.missingCapability) : undefined,
    };
  });
  const topUnmet = Array.isArray(obj.topUnmet) ? obj.topUnmet.slice(0, 5).map(String) : [];
  return {
    period,
    generatedAt: new Date().toISOString(),
    summary: obj.summary ? String(obj.summary) : undefined,
    intents,
    topUnmet,
  };
}

/** LEARN: one gateway call → insights, upserted to `latest` + `weekly:<YYYY-WW>`. */
export async function learnInsights(
  signals: GatheredSignals,
  budget: Budget,
): Promise<{ insights: QuestionInsights; actions: RunAction[] }> {
  const week = isoWeekKey(new Date());

  // No questions at all → still record an empty insight (idempotent, cheap) and
  // spend no LLM budget.
  if (signals.messages.length === 0) {
    const empty: QuestionInsights = {
      period: week,
      generatedAt: new Date().toISOString(),
      summary: 'No user questions in the last 7 days.',
      intents: [],
      topUnmet: [],
    };
    await upsertRecord(COLLECTIONS.questionInsights, { key: 'latest', data: asData(empty) }, SYSTEM_ACTOR);
    await upsertRecord(COLLECTIONS.questionInsights, { key: `weekly:${week}`, data: asData(empty) }, SYSTEM_ACTOR);
    return { insights: empty, actions: [{ kind: 'insight', detail: 'no questions this week' }] };
  }

  const { content, json } = await budget.call(buildLearnMessages(signals), {
    maxTokens: 3000,
    temperature: 0.3,
  });
  let insights = coerceInsights(json, week);

  // Zero intents from a non-empty question set means the model's JSON did not
  // survive parsing — it is not a real finding. This happened twice in ten
  // nights (60 questions → 0 intents on 29 Jul) and silently starved discover
  // and build of everything they needed. Retry once, tightly.
  if (insights.intents.length === 0) {
    console.warn(
      `[selfimprove] learn produced 0 intents from ${signals.messages.length} questions; raw head: ${content.slice(0, 200)}`,
    );
    const retry = await budget.call(
      [
        {
          role: 'system',
          content:
            'Output ONLY a JSON object, no markdown fence, no commentary. Shape: {"summary": string, ' +
            '"intents": [{"intent": string, "count": number, "examples": string[], "servedWell": boolean, ' +
            '"missingCapability": string}], "topUnmet": string[]}. At least one intent is required.',
        },
        {
          role: 'user',
          content: `Group these questions into intents and list unmet needs:\n${JSON.stringify(
            signals.messages.slice(0, 120).map((m) => m.content),
          )}`,
        },
      ],
      { maxTokens: 3000, temperature: 0.1 },
    );
    const second = coerceInsights(retry.json, week);
    if (second.intents.length > 0) insights = second;
  }

  await upsertRecord(COLLECTIONS.questionInsights, { key: 'latest', data: asData(insights) }, SYSTEM_ACTOR);
  await upsertRecord(COLLECTIONS.questionInsights, { key: `weekly:${week}`, data: asData(insights) }, SYSTEM_ACTOR);

  const actions: RunAction[] = [
    {
      kind: 'insight',
      detail: `${insights.intents.length} intents, ${insights.topUnmet.length} unmet need(s) across ${signals.messages.length} questions`,
    },
  ];

  // Unmet needs are the engine's best source of work. Queue them so they
  // outlive this run — previously they existed only inside one run record.
  const ideas = [
    ...insights.topUnmet.map((need) => ({
      title: need,
      detail: `Unmet need identified from ${signals.messages.length} questions in ${week}.`,
      kind: 'tool' as const,
      priority: 2,
    })),
    ...insights.intents
      .filter((i) => !i.servedWell && i.missingCapability)
      .map((i) => ({
        title: i.missingCapability as string,
        detail: `Intent "${i.intent}" (${i.count} questions) is not served well. Examples: ${(i.examples ?? []).join(' | ')}`,
        kind: 'tool' as const,
        priority: 2,
      })),
  ];

  // Starvation leads, questions follow.
  //
  // Question-mining produced 33 tools in the fortnight to 2026-08-30 and not
  // one was ever called: a question asked once is not a standing appetite, so
  // the tool built to answer it waits for a repeat that never comes.
  // Daydreaming runs every day whether or not anybody asks it anything, and it
  // keeps a record of what it could not settle — a tool built for one of those
  // has a caller the moment it ships, namely the thing that named the gap.
  //
  // Ordered first so the nightly intake cap spends its slots here before the
  // question-mined ideas, rather than after.
  let starving: Awaited<ReturnType<typeof collectStarvation>> = [];
  try {
    starving = await collectStarvation();
  } catch (err) {
    console.error('[selfimprove] starvation collection failed:', errMsg(err));
  }

  // A health source emitting numbers that cannot be true. Empty in a healthy
  // system, so this usually costs one read and adds nothing — but when a unit
  // mismatch appears it is the difference between a card saying "you slept
  // 464,018 hours" and a job to go and fix where that value is read.
  //
  // Pulled from here rather than pushed from the snapshot: this file already
  // imports daydream, and the reverse direction closes a cycle.
  let healthFaults: Awaited<ReturnType<typeof collectHealthFaults>> = [];
  try {
    healthFaults = await collectHealthFaults();
  } catch (err) {
    console.error('[selfimprove] health fault collection failed:', errMsg(err));
  }
  // The fault ledger, FIRST. Every site where daydreaming could not do
  // something writes here with the shape of the fix; nothing else in this
  // pass says as precisely what to build. Then the engine's proposals about
  // itself — kind `engine`, never built, only listed.
  let faultIdeas: Awaited<ReturnType<typeof collectFaultIdeas>> = [];
  try {
    faultIdeas = await collectFaultIdeas();
  } catch (err) {
    console.error('[selfimprove] fault ledger read failed:', errMsg(err));
  }
  let engineIdeas: Awaited<ReturnType<typeof engineProposals>> = [];
  try {
    engineIdeas = await engineProposals();
  } catch (err) {
    console.error('[selfimprove] engine proposals failed:', errMsg(err));
  }
  for (const s of [...faultIdeas, ...starving, ...healthFaults, ...engineIdeas]) {
    actions.push({
      kind: 'insight',
      detail: `${s.title} — ${s.evidence}`,
      story: {
        subject: s.title,
        driver: s.detail,
        driverEvidence: s.evidence,
        // `recorded`, not inferred: this is a measurement, not a guess about
        // what somebody meant.
        driverRef: undefined,
      },
    });
  }

  try {
    const added = await addIdeas([
      ...[...faultIdeas, ...healthFaults, ...starving, ...engineIdeas].map((s) => ({
        title: s.title,
        detail: s.detail,
        kind: s.kind,
        priority: s.priority,
      })),
      ...ideas,
    ]);
    for (const slug of added) actions.push({ kind: 'backlog_added', detail: slug });
  } catch (err) {
    console.error('[selfimprove] queueing insights to backlog failed:', errMsg(err));
  }

  return { insights, actions };
}
