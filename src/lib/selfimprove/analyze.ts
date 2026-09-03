// src/lib/selfimprove/analyze.ts
//
// GATHER + LEARN phases. Gather pulls the last 7 days of user questions plus
// tool telemetry and current insights; Learn makes ONE gateway call to classify
// intents and surface unmet needs, then upserts the `question_insights` records
// (`latest` + `weekly:<YYYY-WW>`).

import { db } from '$lib/db';
import { orchestratorChats, customTools, daydreamSignals } from '$lib/db/schema';
import { and, eq, gte, desc, sql } from 'drizzle-orm';
import {
  DatastoreError,
  getCollectionBySlug,
  getRecordByKey,
  queryRecords,
  upsertRecord,
} from '$lib/datastore';
import { getToolAudit } from '$lib/server/tool-audit';
import {
  COLLECTIONS,
  SYSTEM_ACTOR,
  asData,
  errMsg,
  isoWeekKey,
  type CapabilityOpportunity,
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
  capabilityInventory: CapabilityInventory | null;
}

export interface CapabilityInventory {
  platformToolsets: Array<{ name: string; tools: number }>;
  catalogApis: Array<{ name: string; status: string; capabilities: string[] }>;
  daydreamSources: Array<{ source: string; signals: number; observing: number }>;
}

/** Give the learner the source/service portfolio, not only a list of tools. */
async function loadCapabilityInventory(): Promise<CapabilityInventory | null> {
  const inventory: CapabilityInventory = {
    platformToolsets: [],
    catalogApis: [],
    daydreamSources: [],
  };

  try {
    const { getToolsetManifest } = await import('$lib/workflows/site-tools/registry');
    inventory.platformToolsets = getToolsetManifest()
      .map((t) => ({ name: t.toolset, tools: t.tools.length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('[selfimprove] capability toolsets failed:', errMsg(err));
  }

  try {
    if (await getCollectionBySlug(COLLECTIONS.apiCatalog)) {
      const { records } = await queryRecords(COLLECTIONS.apiCatalog, { limit: 200 }, SYSTEM_ACTOR);
      inventory.catalogApis = records
        .map((r) => r.data as Record<string, unknown>)
        .filter((d) => (d.status ?? 'seeded') !== 'broken')
        .map((d) => ({
          name: String(d.name ?? ''),
          status: String(d.status ?? 'seeded'),
          capabilities: Array.isArray(d.capabilities) ? d.capabilities.slice(0, 6).map(String) : [],
        }))
        .filter((a) => a.name)
        .slice(0, 100);
    }
  } catch (err) {
    console.error('[selfimprove] capability API catalogue failed:', errMsg(err));
  }

  try {
    const rows = await db
      .select({
        source: daydreamSignals.source,
        signals: sql<number>`count(*)::int`,
        observing: sql<number>`count(*) filter (where ${daydreamSignals.observedDays} > 0)::int`,
      })
      .from(daydreamSignals)
      .groupBy(daydreamSignals.source);
    inventory.daydreamSources = rows.map((r) => ({
      source: r.source,
      signals: Number(r.signals ?? 0),
      observing: Number(r.observing ?? 0),
    }));
  } catch (err) {
    console.error('[selfimprove] capability daydream sources failed:', errMsg(err));
  }

  return inventory.platformToolsets.length || inventory.catalogApis.length || inventory.daydreamSources.length
    ? inventory
    : null;
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

  const capabilityInventory = await loadCapabilityInventory();

  return { messages, toolAudit, customTools: ctRows, currentInsights, capabilityInventory };
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
    'You are given the owner\'s recent questions, tool telemetry, and an inventory of current APIs, integrations ' +
    'and Daydream signal sources. Classify questions into a small set of INTENTS and identify UNMET NEEDS. Then ' +
    'perform a CAPABILITY PORTFOLIO audit: look for valuable missing datasets/feeds, APIs, online services, and ' +
    'site functionality that could improve JKAI answers, Daydream intelligence, or the site itself. Do not default ' +
    'to another wrapper tool. A tool is appropriate only when it turns an existing source/platform operation into ' +
    'a useful repeatable outcome. Prefer durable, current, authoritative data and services over novelty utilities. ' +
    'Every opportunity must state who consumes it and the concrete value unlocked; do not duplicate inventory. ' +
    'Respond with ONLY a JSON object of the form: ' +
    '{"summary": string, "intents": [{"intent": string, "count": number, "examples": string[], ' +
    '"servedWell": boolean, "missingCapability": string}], "topUnmet": string[], "opportunities": [' +
    '{"title": string, "need": string, "kind":"tool"|"data_source"|"online_service"|"site_feature", ' +
    '"consumer":"jkai"|"daydream"|"site"|"shared", "value": string, "integrationHint": string}]}. ' +
    'Keep intents to 10, examples to 3, topUnmet to 5, and opportunities to 4. Include at least one non-tool ' +
    'opportunity when a defensible portfolio gap exists. No prose outside the JSON.';

  const payload = {
    questionCount: signals.messages.length,
    recentQuestions: signals.messages.slice(0, 200).map((m) => m.content),
    toolUsage: compactToolAudit(signals.toolAudit),
    customToolHealth: signals.customTools.slice(0, 30),
    capabilityInventory: signals.capabilityInventory,
    previousInsightsSummary: signals.currentInsights?.summary ?? null,
  };
  const user = `Signals (last 7 days):\n\n${JSON.stringify(payload, null, 2)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function coerceInsights(json: unknown, period: string): QuestionInsights {
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
  const opportunities: CapabilityOpportunity[] = (Array.isArray(obj.opportunities) ? obj.opportunities : [])
    .map((raw): CapabilityOpportunity | null => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const need = typeof o.need === 'string' ? o.need.trim() : '';
      const value = typeof o.value === 'string' ? o.value.trim() : '';
      const kinds = new Set(['tool', 'data_source', 'online_service', 'site_feature']);
      const consumers = new Set(['jkai', 'daydream', 'site', 'shared']);
      if (!title || !need || !value || !kinds.has(String(o.kind)) || !consumers.has(String(o.consumer))) {
        return null;
      }
      return {
        title: title.slice(0, 160),
        need: need.slice(0, 600),
        kind: String(o.kind) as CapabilityOpportunity['kind'],
        consumer: String(o.consumer) as CapabilityOpportunity['consumer'],
        value: value.slice(0, 600),
        integrationHint:
          typeof o.integrationHint === 'string' && o.integrationHint.trim()
            ? o.integrationHint.trim().slice(0, 600)
            : undefined,
      };
    })
    .filter((o): o is CapabilityOpportunity => o !== null)
    .slice(0, 4);
  return {
    period,
    generatedAt: new Date().toISOString(),
    summary: obj.summary ? String(obj.summary) : undefined,
    intents,
    topUnmet,
    opportunities,
  };
}

/** LEARN: one gateway call → insights, upserted to `latest` + `weekly:<YYYY-WW>`. */
export async function learnInsights(
  signals: GatheredSignals,
  budget: Budget,
): Promise<{ insights: QuestionInsights; actions: RunAction[] }> {
  const week = isoWeekKey(new Date());

  // With neither questions nor a source inventory there is genuinely nothing
  // to audit. An inventory on its own is still useful: portfolio discovery is
  // proactive and must not stop merely because the owner had a quiet week.
  if (signals.messages.length === 0 && !signals.capabilityInventory) {
    const empty: QuestionInsights = {
      period: week,
      generatedAt: new Date().toISOString(),
      summary: 'No user questions in the last 7 days.',
      intents: [],
      topUnmet: [],
      opportunities: [],
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

  // No intents AND no portfolio opportunities means the model's JSON did not
  // survive parsing. A quiet week may legitimately have no intents, but should
  // still produce an inventory-backed opportunity. Retry once, tightly.
  if (insights.intents.length === 0 && (insights.opportunities?.length ?? 0) === 0) {
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
            '"missingCapability": string}], "topUnmet": string[], "opportunities": [{"title": string, ' +
            '"need": string, "kind":"tool"|"data_source"|"online_service"|"site_feature", ' +
            '"consumer":"jkai"|"daydream"|"site"|"shared", "value": string, "integrationHint": string}]}. ' +
            'Return at least one intent when questions exist, or one concrete opportunity from the inventory.',
        },
        {
          role: 'user',
          content: `Audit these questions and the capability inventory:\n${JSON.stringify({
            questions: signals.messages.slice(0, 120).map((m) => m.content),
            inventory: signals.capabilityInventory,
          })}`,
        },
      ],
      { maxTokens: 3000, temperature: 0.1 },
    );
    const second = coerceInsights(retry.json, week);
    if (second.intents.length > 0 || (second.opportunities?.length ?? 0) > 0) insights = second;
  }

  await upsertRecord(COLLECTIONS.questionInsights, { key: 'latest', data: asData(insights) }, SYSTEM_ACTOR);
  await upsertRecord(COLLECTIONS.questionInsights, { key: `weekly:${week}`, data: asData(insights) }, SYSTEM_ACTOR);

  const actions: RunAction[] = [
    {
      kind: 'insight',
      detail:
        `${insights.intents.length} intents, ${insights.topUnmet.length} unmet need(s), ` +
        `${insights.opportunities?.length ?? 0} portfolio opportunity(s) across ${signals.messages.length} questions`,
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
    ...(insights.opportunities ?? []).map((o) => ({
      title: o.title,
      detail:
        `[${o.kind} for ${o.consumer}] ${o.need} Value: ${o.value}` +
        (o.integrationHint ? ` Integration path: ${o.integrationHint}` : ''),
      kind: o.kind === 'tool' || o.kind === 'data_source' ? ('tool' as const) : ('feature' as const),
      priority: o.consumer === 'shared' || o.consumer === 'daydream' ? 1 : 2,
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
