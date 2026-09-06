import { desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  conversations,
  daydreamPlaces,
  daydreamThoughts,
  orchestratorChats,
  researchSessions,
} from '$lib/db/schema';
import { getHealthSeries30d } from '$lib/health/series-30d-service';
import { getReadiness } from '$lib/health/readiness-service';
import { buildThreadGraph } from '$lib/jkai/thread-graph.server';
import { classifyContext } from './classify';
import { drillKey, entityDrillKey } from './drill';
import {
  contextLensSchema,
  contextPanelSchema,
  type ContextCard,
  type ContextLens,
  type ContextPanel,
} from './types';

function compactStatus(status: string): string {
  return status.replaceAll('_', ' ').replace(/^phase/, 'phase ');
}
function graphCards(graph: Awaited<ReturnType<typeof buildThreadGraph>>): ContextCard[] {
  const concepts = graph.nodes.filter((n) => n.kind === 'concept');
  const known = concepts.filter((n) => n.provenance === 'known').length;
  const fresh = concepts.filter((n) => n.provenance === 'new').length;
  const cards: ContextCard[] = [{
    id: 'intel-footprint',
    type: 'metrics',
    title: 'Knowledge footprint',
    subtitle: 'What this thread has connected',
    href: '/jkai/intel',
    drill: drillKey({ kind: 'entities', filter: 'all' }),
    metrics: [
      { label: 'Entities', value: String(graph.conceptTotal), detail: `${concepts.length} in this view`, drill: drillKey({ kind: 'entities', filter: 'all' }) },
      { label: 'Relations', value: String(graph.edges.length), drill: drillKey({ kind: 'relations' }) },
      { label: 'Known', value: String(known), tone: known ? 'good' : 'default', drill: drillKey({ kind: 'entities', filter: 'known' }) },
      { label: 'New here', value: String(fresh), tone: fresh ? 'warn' : 'default', drill: drillKey({ kind: 'entities', filter: 'new' }) },
    ],
  }];
  if (concepts.length) {
    cards.push({
      id: 'intel-topics',
      type: 'bars',
      title: 'Topics in focus',
      subtitle: 'Double-click a topic for everything the graph holds on it',
      drill: drillKey({ kind: 'entities', filter: 'all' }),
      rows: concepts.slice(0, 7).map((n) => ({
        id: n.id,
        label: n.name,
        value: n.mentions,
        display: `${n.mentions} mention${n.mentions === 1 ? '' : 's'}`,
        href: n.href ?? undefined,
        drill: entityDrillKey(n.id) ?? undefined,
      })),
    });
  }
  return cards;
}

async function researchCards(threadText: string): Promise<ContextCard[]> {
  const runs = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      depth: researchSessions.depth,
      createdAt: researchSessions.createdAt,
      durationMs: researchSessions.durationMs,
    })
    .from(researchSessions)
    .orderBy(desc(researchSessions.createdAt))
    .limit(12);

  const terms = new Set(threadText.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3));
  const ranked = runs
    .map((r) => ({
      ...r,
      relevance: r.topic.toLowerCase().split(/[^a-z0-9]+/).filter((t) => terms.has(t)).length,
    }))
    .sort((a, b) => b.relevance - a.relevance || +b.createdAt - +a.createdAt);
  const active = runs.filter((r) => !['complete', 'failed', 'cancelled', 'stopped'].includes(r.status)).length;
  const complete = runs.filter((r) => r.status === 'complete').length;

  return [
    {
      id: 'research-status',
      type: 'metrics',
      title: 'Research desk',
      href: '/research',
      drill: drillKey({ kind: 'research-desk', filter: 'all' }),
      metrics: [
        { label: 'Active', value: String(active), tone: active ? 'warn' : 'default', drill: drillKey({ kind: 'research-desk', filter: 'active' }) },
        { label: 'Complete', value: String(complete), tone: complete ? 'good' : 'default', drill: drillKey({ kind: 'research-desk', filter: 'complete' }) },
        { label: 'Recent runs', value: String(runs.length), drill: drillKey({ kind: 'research-desk', filter: 'all' }) },
      ],
    },
    {
      id: 'research-runs',
      type: 'links',
      title: 'Relevant runs',
      subtitle: ranked[0]?.relevance ? 'Matched to this conversation' : 'Most recent',
      href: '/research',
      drill: drillKey({ kind: 'research-desk', filter: 'all' }),
      rows: ranked.slice(0, 6).map((r) => ({
        id: r.id,
        label: r.topic,
        meta: `${r.depth} · ${compactStatus(r.status)}`,
        note: r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : undefined,
        href: `/research/${r.id}`,
        drill: drillKey({ kind: 'research-run', id: r.id }),
      })),
    },
  ];
}

async function healthCards(): Promise<ContextCard[]> {
  const [seriesResult, readinessResult] = await Promise.allSettled([
    getHealthSeries30d(),
    getReadiness(),
  ]);
  if (seriesResult.status === 'rejected') {
    return [{ id: 'health-unavailable', type: 'note', title: 'Health data unavailable', body: 'The health services could not be read. Open Health for sync status.', tone: 'warn', href: '/health' }];
  }
  const data = seriesResult.value;
  if (data.provenance.seriesIsMock) {
    return [{ id: 'health-cold-start', type: 'note', title: 'No measured health window', body: 'The Health page is currently using its cold-start demonstration series, so this rail will not present those values as measurements.', tone: 'warn', href: '/health' }];
  }
  const readiness = readinessResult.status === 'fulfilled' ? readinessResult.value : null;
  const days = data.series.filter((d) => d.rec || d.hrv || d.rhr || d.slept);
  return [
    {
      id: 'health-today',
      type: 'metrics',
      title: 'Today',
      subtitle: readiness?.recommendation ?? data.strap,
      href: '/health',
      metrics: [
        { label: 'Readiness', value: readiness ? `${readiness.score}` : `${data.today.rec}%`, detail: readiness?.label, tone: (readiness?.score ?? data.today.rec) >= 70 ? 'good' : (readiness?.score ?? data.today.rec) < 40 ? 'bad' : 'warn' },
        { label: 'HRV', value: `${Math.round(data.today.hrv)} ms`, detail: `${data.todayDeltas.hrvDeltaPct >= 0 ? '+' : ''}${data.todayDeltas.hrvDeltaPct}%` },
        { label: 'RHR', value: `${Math.round(data.today.rhr)} bpm`, detail: `${data.todayDeltas.rhrDelta >= 0 ? '+' : ''}${data.todayDeltas.rhrDelta}` },
        { label: 'Sleep', value: `${data.today.slept.toFixed(1)} h`, detail: `${data.todayDeltas.sleepDelta >= 0 ? '+' : ''}${data.todayDeltas.sleepDelta.toFixed(1)} h` },
      ],
    },
    {
      id: 'health-recovery-trend',
      type: 'series',
      title: 'Recovery and sleep',
      subtitle: 'Select a point to bring its date back into chat',
      href: '/health',
      unit: '%',
      series: [
        { key: 'recovery', label: 'Recovery', colour: 'var(--accent)', points: days.map((d) => ({ x: d.date, y: d.rec })) },
        { key: 'sleep', label: 'Sleep', colour: 'var(--success)', points: days.map((d) => ({ x: d.date, y: d.sleepScore ?? Math.min(100, (d.slept / 8) * 100) })) },
      ],
    },
    {
      id: 'health-body-trend',
      type: 'series',
      title: 'HRV and resting heart rate',
      href: '/health',
      unit: 'bpm / ms',
      series: [
        { key: 'hrv', label: 'HRV', colour: 'var(--accent)', points: days.map((d) => ({ x: d.date, y: d.hrv })) },
        { key: 'rhr', label: 'RHR', colour: 'var(--warn)', points: days.map((d) => ({ x: d.date, y: d.rhr })) },
      ],
    },
  ];
}

async function daydreamCards(): Promise<ContextCard[]> {
  const [thoughts, places, [counts]] = await Promise.all([
    db.select({ id: daydreamThoughts.id, title: daydreamThoughts.title, kind: daydreamThoughts.kind, score: daydreamThoughts.score, status: daydreamThoughts.status, createdAt: daydreamThoughts.createdAt })
      .from(daydreamThoughts).orderBy(desc(daydreamThoughts.createdAt)).limit(6),
    db.select({ id: daydreamPlaces.id, label: daydreamPlaces.label, suggestedLabel: daydreamPlaces.suggestedLabel, visitCount: daydreamPlaces.visitCount, distinctDays: daydreamPlaces.distinctDays })
      .from(daydreamPlaces).where(eq(daydreamPlaces.status, 'active')).orderBy(desc(daydreamPlaces.visitCount)).limit(7),
    db.select({
      newThoughts: sql<number>`count(*) filter (where ${daydreamThoughts.status} = 'new')`,
      reviewed: sql<number>`count(*) filter (where ${daydreamThoughts.reviewVerdict} is not null)`,
    }).from(daydreamThoughts),
  ]);
  return [
    {
      id: 'daydream-state',
      type: 'metrics',
      title: 'Daydream loop',
      href: '/jkai/daydreams/feed',
      drill: drillKey({ kind: 'thoughts', filter: 'all' }),
      metrics: [
        { label: 'New thoughts', value: String(Number(counts?.newThoughts ?? 0)), tone: Number(counts?.newThoughts ?? 0) ? 'warn' : 'default', drill: drillKey({ kind: 'thoughts', filter: 'new' }) },
        { label: 'Reviewed', value: String(Number(counts?.reviewed ?? 0)), tone: Number(counts?.reviewed ?? 0) ? 'good' : 'default', drill: drillKey({ kind: 'thoughts', filter: 'reviewed' }) },
        { label: 'Known places', value: String(places.filter((p) => p.label).length), drill: drillKey({ kind: 'places', filter: 'named' }) },
      ],
    },
    {
      id: 'daydream-thoughts',
      type: 'links',
      title: 'Emerging thoughts',
      href: '/jkai/daydreams/feed',
      drill: drillKey({ kind: 'thoughts', filter: 'all' }),
      // The feed opens a thought with `?open=`; `?thought=` was never read.
      rows: thoughts.map((t) => ({ id: t.id, label: t.title, meta: `${t.kind} · ${compactStatus(t.status)}`, note: `${Math.round(t.score * 100)} score`, href: `/jkai/daydreams/feed?open=${t.id}`, drill: drillKey({ kind: 'thought', id: t.id }) })),
    },
    {
      id: 'daydream-places',
      type: 'bars',
      title: 'Repeated places',
      subtitle: 'Separate days, not household visit count',
      href: '/jkai/daydreams/places',
      drill: drillKey({ kind: 'places', filter: 'all' }),
      rows: places.map((p) => ({ id: p.id, label: p.label ?? p.suggestedLabel ?? 'Unnamed place', value: p.distinctDays, display: `${p.distinctDays} days`, href: '/jkai/daydreams/places', drill: drillKey({ kind: 'place', id: p.id }) })),
    },
  ];
}

export async function composeContextPanel(conversationId: string, requestedLens?: string | null): Promise<ContextPanel | null> {
  const [[conversation], recentDesc, graph] = await Promise.all([
    db.select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt }).from(conversations).where(eq(conversations.id, conversationId)).limit(1),
    db.select({ id: orchestratorChats.id, content: orchestratorChats.content, metadata: orchestratorChats.metadata }).from(orchestratorChats).where(eq(orchestratorChats.conversationId, conversationId)).orderBy(desc(orchestratorChats.createdAt)).limit(16),
    buildThreadGraph(conversationId),
  ]);
  if (!conversation) return null;
  const messages = recentDesc.slice().reverse();
  const classification = classifyContext({
    title: conversation.title,
    messages,
    graphKinds: graph.nodes.map((n) => n.kind),
    graphTypes: graph.nodes.map((n) => n.type),
  });
  const parsedLens = contextLensSchema.safeParse(requestedLens);
  const selectedLens: ContextLens = parsedLens.success ? parsedLens.data : classification.automaticLens;
  const threadText = `${conversation.title ?? ''}\n${messages.map((m) => m.content).join('\n')}`;
  let cards: ContextCard[];
  if (selectedLens === 'health') cards = await healthCards();
  else if (selectedLens === 'research') cards = await researchCards(threadText);
  else if (selectedLens === 'daydream') cards = await daydreamCards();
  else cards = graphCards(graph);

  const focusNode = graph.nodes.find((n) => n.kind === 'concept');
  return contextPanelSchema.parse({
    revision: `${conversation.updatedAt.toISOString()}:${recentDesc[0]?.id ?? 'empty'}`,
    selectedLens,
    automaticLens: classification.automaticLens,
    focus: {
      label: focusNode?.name ?? conversation.title ?? 'Conversation context',
      reason: selectedLens === classification.automaticLens ? classification.lenses.find((l) => l.id === selectedLens)?.reason ?? 'thread overview' : 'selected manually',
    },
    lenses: classification.lenses,
    cards,
  });
}
