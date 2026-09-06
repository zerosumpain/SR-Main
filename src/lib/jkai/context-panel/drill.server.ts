// Drill manifests — what a double-click on the thread inspector opens.
//
// THIS HALF TOUCHES THE DB. The target grammar is in `drill.ts` (pure); the
// manifest schema is in `types.ts`; the modal that draws a manifest is
// `ContextDrillModal.svelte`, which knows nothing about research runs or
// daydream thoughts — only facts, sections and actions.
//
// Every resolver here reuses an endpoint that already exists for its
// actions (`/api/research/[id]/control`, `/api/daydream/thoughts`,
// `/api/jkai/memory`). Nothing becomes writable through a drill that was not
// writable already; the drill is a shorter path to the same button.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  agentActions,
  conversations,
  daydreamPlaces,
  daydreamThoughts,
  facts,
  jkaiMemories,
  jkaiMemoryEntities,
  orchestratorChats,
  researchSessions,
  sources,
} from '$lib/db/schema';
import { buildThreadGraph } from '$lib/jkai/thread-graph.server';
import type { ThreadGraph, ThreadGraphNode } from '$lib/jkai/thread-graph';
import { entityIdOf } from '$lib/jkai/graph-layout';
import { commitState } from '$lib/deepdive/graph-commit';
import { resolveEvidence } from '$lib/daydream/evidence';
import { memoryLinks } from '$lib/jkai/memory/graph.server';
import { MEMORY_STATE_LABEL, memoryState } from '$lib/jkai/memory/contracts';
import { composeThreadMemory } from '$lib/jkai/memory/thread.server';
import type { ThreadMemoryRow } from '$lib/jkai/memory/thread';
import { composeContextPanel } from './compose.server';
import { drillKey, relativeStamp, type DrillTarget } from './drill';
import {
  drillManifestSchema,
  type DrillAction,
  type DrillFact,
  type DrillManifest,
  type DrillRow,
  type DrillSection,
} from './types';

function compactStatus(status: string): string {
  return status.replaceAll('_', ' ').replace(/^phase/, 'phase ');
}

function ask(label: string, detail: string): DrillAction {
  return { id: 'ask', label: 'ask about this →', kind: 'ask', ask: { label, detail } };
}

function link(id: string, label: string, href: string): DrillAction {
  return { id, label, kind: 'link', href };
}

function finish(m: DrillManifest): DrillManifest {
  return drillManifestSchema.parse(m);
}

// ── Intelligence ──────────────────────────────────────────────────────────

const PROVENANCE_WORD: Record<ThreadGraphNode['provenance'], string> = {
  known: 'already in the graph',
  new: 'only this thread says so',
  thread: 'touched by the thread',
};

function conceptRow(n: ThreadGraphNode): DrillRow {
  return {
    id: n.id,
    label: n.name,
    meta: `${n.type} · ${n.mentions} mention${n.mentions === 1 ? '' : 's'}`,
    note: PROVENANCE_WORD[n.provenance],
    href: n.href ?? undefined,
    drill: entityIdOf(n) ? n.id : undefined,
    tone: n.provenance === 'new' ? 'warn' : n.provenance === 'known' ? 'good' : 'default',
  };
}

function entitiesManifest(graph: ThreadGraph, filter: 'all' | 'known' | 'new', target: string): DrillManifest {
  const concepts = graph.nodes.filter((n) => n.kind === 'concept');
  const rows = filter === 'all' ? concepts : concepts.filter((n) => n.provenance === filter);
  const known = concepts.filter((n) => n.provenance === 'known').length;
  const fresh = concepts.filter((n) => n.provenance === 'new').length;
  const title = filter === 'known' ? 'Entities the graph already knew' : filter === 'new' ? 'Entities first seen here' : 'Entities in this thread';
  return finish({
    target,
    kind: 'entities',
    eyebrow: 'Intelligence · knowledge footprint',
    title,
    subtitle: !graph.intelEnabled
      ? 'This thread is not feeding intelligence.'
      : !graph.conceptsReady
        ? 'Extraction is still catching up with the latest turn.'
        : `${graph.conceptTotal} in the record, ${concepts.length} drawn here.`,
    href: '/jkai/intel',
    facts: [
      { label: 'Entities', value: String(graph.conceptTotal) },
      { label: 'Relations', value: String(graph.edges.length) },
      { label: 'Known', value: String(known), tone: known ? 'good' : 'default' },
      { label: 'New here', value: String(fresh), tone: fresh ? 'warn' : 'default' },
    ],
    sections: [
      {
        kind: 'rows',
        id: 'entities',
        title: filter === 'all' ? 'Ranked by mentions' : `${rows.length} of ${concepts.length}`,
        rows: rows.map(conceptRow),
        empty:
          filter === 'new'
            ? 'Everything this thread mentions was already corroborated elsewhere.'
            : filter === 'known'
              ? 'Nothing here is corroborated outside this thread yet.'
              : 'Nothing has been extracted from this thread yet.',
      },
    ],
    actions: [
      link('intel', 'open intel →', '/jkai/intel'),
      ask(
        'What do these entities have in common?',
        `Entities in this thread: ${rows.slice(0, 12).map((n) => n.name).join(', ') || 'none yet'}`,
      ),
    ],
  });
}

function relationsManifest(graph: ThreadGraph, target: string): DrillManifest {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const typed = graph.edges.filter((e) => e.verb !== 'MENTIONED WITH');
  const cooc = graph.edges.length - typed.length;
  const rows: DrillRow[] = typed.map((e, i) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    return {
      id: `${i}:${e.source}:${e.target}`,
      label: `${a?.name ?? e.source} → ${b?.name ?? e.target}`,
      meta: e.verb,
      drill: a && entityIdOf(a) ? a.id : undefined,
      tone: 'accent',
    };
  });
  return finish({
    target,
    kind: 'relations',
    eyebrow: 'Intelligence · relations',
    title: 'How this thread’s entities connect',
    subtitle: 'Typed relations carry a verb; co-occurrence only says two things shared a turn.',
    href: '/jkai/intel',
    facts: [
      { label: 'Typed', value: String(typed.length), tone: typed.length ? 'accent' : 'default' },
      { label: 'Co-occurrence', value: String(cooc) },
      { label: 'Nodes', value: String(graph.nodes.length) },
    ],
    sections: [
      {
        kind: 'rows',
        id: 'typed',
        title: 'Named relationships',
        rows,
        empty: 'No typed relationship between this thread’s entities yet — only co-occurrence.',
      },
    ],
    actions: [link('intel', 'open intel →', '/jkai/intel')],
  });
}

async function entityManifest(conversationId: string, graph: ThreadGraph, nodeId: string): Promise<DrillManifest | null> {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const entityId = node ? entityIdOf(node) : nodeId.slice('entity:'.length);
  if (!entityId) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const relations: DrillRow[] = node
    ? graph.edges
        .filter((e) => e.source === node.id || e.target === node.id)
        .map((e, i) => {
          const otherId = e.source === node.id ? e.target : e.source;
          const other = byId.get(otherId);
          return other
            ? ({
                id: `${i}:${otherId}`,
                label: other.name,
                meta: e.verb,
                note: other.type,
                drill: entityIdOf(other) ? other.id : undefined,
                tone: e.verb === 'MENTIONED WITH' ? 'default' : 'accent',
              } as DrillRow)
            : null;
        })
        .filter((r): r is DrillRow => r !== null)
        .sort((a, b) => (a.tone === 'accent' ? -1 : 0) - (b.tone === 'accent' ? -1 : 0))
    : [];

  // Personal memories linked to this entity — intel and memory are one graph.
  const linked = await db
    .select({ id: jkaiMemories.id, content: jkaiMemories.content, category: jkaiMemories.category, updatedAt: jkaiMemories.updatedAt, supersededBy: jkaiMemories.supersededBy, provenance: jkaiMemories.provenance })
    .from(jkaiMemoryEntities)
    .innerJoin(jkaiMemories, eq(jkaiMemories.id, jkaiMemoryEntities.memoryId))
    .where(and(eq(jkaiMemoryEntities.entityId, entityId), isNull(jkaiMemories.supersededBy)))
    .orderBy(desc(jkaiMemories.updatedAt))
    .limit(12);

  const name = node?.name ?? 'Entity';
  return finish({
    target: `entity:${entityId}`,
    kind: 'entity',
    eyebrow: node ? `Intelligence · ${node.type}` : 'Intelligence · entity',
    title: name,
    subtitle: node ? PROVENANCE_WORD[node.provenance] : undefined,
    href: `/jkai/intel/entities/${entityId}`,
    entityId,
    facts: node
      ? [
          { label: 'Mentions here', value: String(node.mentions) },
          { label: 'Last seen', value: relativeStamp(node.lastSeen) || '—' },
          { label: 'Provenance', value: node.provenance, tone: node.provenance === 'new' ? 'warn' : node.provenance === 'known' ? 'good' : 'default' },
        ]
      : [],
    sections: [
      {
        kind: 'rows',
        id: 'thread',
        title: 'In this thread',
        rows: relations,
        empty: 'Nothing else in this thread connects to it yet.',
      },
      {
        kind: 'rows',
        id: 'memories',
        title: 'Personal memories about it',
        rows: linked.map((m) => ({
          id: m.id,
          label: m.content,
          meta: `${m.category} · ${MEMORY_STATE_LABEL[memoryState(m)]}`,
          note: relativeStamp(m.updatedAt.toISOString()),
          drill: drillKey({ kind: 'memory', id: m.id }),
        })),
        empty: 'No memory is linked to this entity.',
      },
    ],
    actions: [
      link('intel', 'open in intel →', `/jkai/intel/entities/${entityId}`),
      ask(`Tell me more about ${name}.`, `Entity from this thread: ${name}${node?.note ? ` — ${node.note}` : ''}`),
    ],
  });
}

// ── Research ──────────────────────────────────────────────────────────────

const TERMINAL = new Set(['complete', 'failed', 'cancelled', 'stopped']);

async function researchDeskManifest(filter: 'all' | 'active' | 'complete', target: string): Promise<DrillManifest> {
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
    .limit(30);
  const active = runs.filter((r) => !TERMINAL.has(r.status));
  const complete = runs.filter((r) => r.status === 'complete');
  const failed = runs.filter((r) => r.status === 'failed');
  const list = filter === 'active' ? active : filter === 'complete' ? complete : runs;
  return finish({
    target,
    kind: 'research-desk',
    eyebrow: 'Research · desk',
    title: filter === 'active' ? 'Runs still working' : filter === 'complete' ? 'Completed runs' : 'Recent research runs',
    subtitle: 'The thirty most recent runs, whatever thread started them.',
    href: '/research',
    facts: [
      { label: 'Active', value: String(active.length), tone: active.length ? 'warn' : 'default' },
      { label: 'Complete', value: String(complete.length), tone: complete.length ? 'good' : 'default' },
      { label: 'Failed', value: String(failed.length), tone: failed.length ? 'bad' : 'default' },
      { label: 'Listed', value: String(runs.length) },
    ],
    sections: [
      {
        kind: 'rows',
        id: 'runs',
        title: `${list.length} run${list.length === 1 ? '' : 's'}`,
        rows: list.map((r) => ({
          id: r.id,
          label: r.topic,
          meta: `${r.depth} · ${compactStatus(r.status)}`,
          note: r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : relativeStamp(r.createdAt.toISOString()),
          href: `/research/${r.id}`,
          drill: drillKey({ kind: 'research-run', id: r.id }),
          tone: r.status === 'failed' ? 'bad' : r.status === 'complete' ? 'good' : TERMINAL.has(r.status) ? 'default' : 'warn',
          when: r.createdAt.toISOString(),
        })),
        empty: filter === 'active' ? 'Nothing is running.' : 'No runs yet.',
      },
    ],
    actions: [link('desk', 'research desk →', '/research'), link('new', 'start a run →', '/research')],
  });
}

async function researchRunManifest(id: string, target: string): Promise<DrillManifest | null> {
  const [run] = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      depth: researchSessions.depth,
      grounding: researchSessions.grounding,
      goals: researchSessions.goals,
      report: researchSessions.report,
      createdAt: researchSessions.createdAt,
      completedAt: researchSessions.completedAt,
      durationMs: researchSessions.durationMs,
    })
    .from(researchSessions)
    .where(eq(researchSessions.id, id))
    .limit(1);
  if (!run) return null;
  const [[srcCount], [factCount], [spend], commit] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(sources).where(eq(sources.sessionId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(facts).where(eq(facts.sessionId, id)),
    db.select({ usd: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)` }).from(agentActions).where(eq(agentActions.sessionId, id)),
    commitState(id).catch(() => null),
  ]);
  const report = run.report as { executive_summary?: string; ranked_facts?: string[]; knowledge_gaps?: Array<{ question?: string; description?: string }> } | null;
  const goals = Array.isArray(run.goals) ? (run.goals as unknown[]).filter((g): g is string => typeof g === 'string') : [];
  const terminal = TERMINAL.has(run.status);
  const paused = run.status === 'paused';
  const control = `/api/research/${id}/control`;
  const committed = Boolean(commit?.committed);

  const actions: DrillAction[] = [link('open', 'open run →', `/research/${id}`)];
  if (!terminal) {
    actions.push(
      paused
        ? { id: 'resume', label: 'resume', kind: 'post', endpoint: control, body: { action: 'resume' } }
        : { id: 'pause', label: 'pause', kind: 'post', endpoint: control, body: { action: 'pause' } },
      { id: 'stop', label: 'stop and report', kind: 'confirm', endpoint: control, body: { action: 'stop' }, tone: 'danger', note: 'Winds down and writes the report from what has been gathered.' },
    );
  }
  if (run.status === 'complete') {
    actions.push(
      {
        id: 'to-intel',
        label: committed ? 'in the graph ✓' : 'send to intel',
        kind: 'post',
        endpoint: `/api/research/${id}/to-intel`,
        body: {},
        disabled: committed,
        note: committed ? 'This run’s entities are already merged into the knowledge graph.' : 'Merges the run’s entities and relations into the knowledge graph.',
        refresh: 'graph',
      },
      { id: 'to-drive', label: 'save sources to drive', kind: 'post', endpoint: `/api/research/${id}/to-drive`, body: {}, note: 'Copies the key sources under research/<topic>/ in Drive.' },
    );
  }
  actions.push(ask(`What did the research on "${run.topic}" conclude?`, `Research run: ${run.topic} (${run.depth}, ${compactStatus(run.status)})${report?.executive_summary ? `\n${report.executive_summary.slice(0, 600)}` : ''}`));

  const sections: DrillSection[] = [];
  if (report?.executive_summary) sections.push({ kind: 'prose', id: 'summary', title: 'Executive summary', body: report.executive_summary });
  if (goals.length) sections.push({ kind: 'list', id: 'goals', title: 'Goals', items: goals.slice(0, 12) });
  if (report?.ranked_facts?.length) sections.push({ kind: 'list', id: 'facts', title: 'Top facts', items: report.ranked_facts.slice(0, 10) });
  if (report?.knowledge_gaps?.length) {
    sections.push({
      kind: 'list',
      id: 'gaps',
      title: 'Knowledge gaps',
      items: report.knowledge_gaps.map((g) => g.question ?? g.description ?? '').filter(Boolean).slice(0, 8),
    });
  }

  return finish({
    target,
    kind: 'research-run',
    eyebrow: `Research · ${run.depth}`,
    title: run.topic,
    subtitle: `${compactStatus(run.status)} · started ${relativeStamp(run.createdAt.toISOString())}${run.completedAt ? `, finished ${relativeStamp(run.completedAt.toISOString())}` : ''}`,
    href: `/research/${id}`,
    facts: [
      { label: 'Status', value: compactStatus(run.status), tone: run.status === 'failed' ? 'bad' : run.status === 'complete' ? 'good' : terminal ? 'default' : 'warn' },
      { label: 'Sources', value: String(srcCount?.n ?? 0) },
      { label: 'Facts', value: String(factCount?.n ?? 0) },
      { label: 'Spend', value: `$${Number(spend?.usd ?? 0).toFixed(2)}` },
      { label: 'Took', value: run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : '—' },
      { label: 'Grounding', value: run.grounding },
    ],
    sections,
    actions: actions.slice(0, 8),
  });
}

// ── Daydream ──────────────────────────────────────────────────────────────

function thoughtTone(t: { status: string; reviewVerdict: string | null }): DrillRow['tone'] {
  if (t.reviewVerdict === 'refuted') return 'bad';
  if (t.reviewVerdict === 'verified') return 'good';
  if (t.status === 'new') return 'warn';
  return 'default';
}

async function thoughtsManifest(filter: 'all' | 'new' | 'reviewed', target: string): Promise<DrillManifest> {
  const where =
    filter === 'new'
      ? eq(daydreamThoughts.status, 'new')
      : filter === 'reviewed'
        ? sql`${daydreamThoughts.reviewVerdict} is not null`
        : undefined;
  const [rows, [counts]] = await Promise.all([
    db
      .select({ id: daydreamThoughts.id, title: daydreamThoughts.title, kind: daydreamThoughts.kind, status: daydreamThoughts.status, score: daydreamThoughts.score, reviewVerdict: daydreamThoughts.reviewVerdict, createdAt: daydreamThoughts.createdAt })
      .from(daydreamThoughts)
      .where(where)
      .orderBy(desc(daydreamThoughts.createdAt))
      .limit(20),
    db
      .select({
        fresh: sql<number>`count(*) filter (where ${daydreamThoughts.status} = 'new')`,
        reviewed: sql<number>`count(*) filter (where ${daydreamThoughts.reviewVerdict} is not null)`,
        refuted: sql<number>`count(*) filter (where ${daydreamThoughts.reviewVerdict} = 'refuted')`,
        total: sql<number>`count(*)`,
      })
      .from(daydreamThoughts),
  ]);
  return finish({
    target,
    kind: 'thoughts',
    eyebrow: 'Daydream · thoughts',
    title: filter === 'new' ? 'Thoughts waiting to be seen' : filter === 'reviewed' ? 'Thoughts a reviewer has ruled on' : 'Emerging thoughts',
    subtitle: 'What the engine noticed, newest first.',
    href: '/jkai/daydreams/feed',
    facts: [
      { label: 'New', value: String(Number(counts?.fresh ?? 0)), tone: Number(counts?.fresh ?? 0) ? 'warn' : 'default' },
      { label: 'Reviewed', value: String(Number(counts?.reviewed ?? 0)), tone: Number(counts?.reviewed ?? 0) ? 'good' : 'default' },
      { label: 'Refuted', value: String(Number(counts?.refuted ?? 0)), tone: Number(counts?.refuted ?? 0) ? 'bad' : 'default' },
      { label: 'All time', value: String(Number(counts?.total ?? 0)) },
    ],
    sections: [
      {
        kind: 'rows',
        id: 'thoughts',
        title: `${rows.length} shown`,
        rows: rows.map((t) => ({
          id: t.id,
          label: t.title,
          meta: `${t.kind} · ${compactStatus(t.status)}${t.reviewVerdict ? ` · ${t.reviewVerdict}` : ''}`,
          note: `${Math.round(t.score * 100)} score`,
          href: `/jkai/daydreams/feed?open=${t.id}`,
          drill: drillKey({ kind: 'thought', id: t.id }),
          tone: thoughtTone(t),
          when: t.createdAt.toISOString(),
        })),
        empty: 'Nothing here yet.',
      },
    ],
    actions: [link('feed', 'open the feed →', '/jkai/daydreams/feed')],
  });
}

async function thoughtManifest(id: string, target: string): Promise<DrillManifest | null> {
  const [t] = await db
    .select({
      id: daydreamThoughts.id,
      title: daydreamThoughts.title,
      kind: daydreamThoughts.kind,
      status: daydreamThoughts.status,
      score: daydreamThoughts.score,
      explanation: daydreamThoughts.explanation,
      narrative: daydreamThoughts.narrative,
      verified: daydreamThoughts.verified,
      reviewVerdict: daydreamThoughts.reviewVerdict,
      reviewLikelihood: daydreamThoughts.reviewLikelihood,
      reviewReasoning: daydreamThoughts.reviewReasoning,
      reviewSources: daydreamThoughts.reviewSources,
      reviewAt: daydreamThoughts.reviewAt,
      evidence: daydreamThoughts.evidence,
      feedback: daydreamThoughts.feedback,
      createdAt: daydreamThoughts.createdAt,
    })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, id))
    .limit(1);
  if (!t) return null;
  const evidence = await resolveEvidence(t.evidence ?? []).catch(() => []);
  const api = '/api/daydream/thoughts';
  const sections: DrillSection[] = [
    { kind: 'prose', id: 'why', title: 'Why it said this', body: t.explanation },
  ];
  if (t.narrative) sections.push({ kind: 'prose', id: 'narrative', title: t.verified ? 'Phrasing (checked)' : 'Phrasing (unchecked)', body: t.narrative, tone: t.verified ? 'default' : 'warn' });
  if (t.reviewReasoning) sections.push({ kind: 'prose', id: 'review', title: `Reviewer: ${t.reviewVerdict ?? 'ruled'}`, body: t.reviewReasoning, tone: t.reviewVerdict === 'refuted' ? 'bad' : t.reviewVerdict === 'verified' ? 'good' : 'default' });
  if (t.reviewSources?.length) sections.push({ kind: 'list', id: 'sources', title: 'What the reviewer looked at', items: t.reviewSources.slice(0, 10) });
  sections.push({
    kind: 'rows',
    id: 'evidence',
    title: 'Evidence',
    rows: evidence.slice(0, 20).map((e, i) => ({
      id: `${e.kind}:${e.id}:${i}`,
      label: e.title,
      meta: e.kind,
      note: e.lines[0] ?? e.note ?? undefined,
      href: e.href ?? undefined,
      drill: e.kind === 'memory' ? drillKey({ kind: 'memory', id: e.id }) : undefined,
      when: e.at ?? undefined,
    })),
    empty: 'No citations were recorded for this thought.',
  });
  return finish({
    target,
    kind: 'thought',
    eyebrow: `Daydream · ${t.kind.replaceAll('_', ' ')}`,
    title: t.title,
    subtitle: `${compactStatus(t.status)} · ${relativeStamp(t.createdAt.toISOString())}${t.feedback ? ` · you said ${t.feedback.replaceAll('_', ' ')}` : ''}`,
    href: `/jkai/daydreams/feed?open=${id}`,
    facts: [
      { label: 'Score', value: String(Math.round(t.score * 100)) },
      { label: 'Verdict', value: t.reviewVerdict ?? 'unreviewed', tone: t.reviewVerdict === 'refuted' ? 'bad' : t.reviewVerdict === 'verified' ? 'good' : 'default' },
      { label: 'Likelihood', value: t.reviewLikelihood === null ? '—' : `${Math.round(t.reviewLikelihood * 100)}%` },
      { label: 'Reviewed', value: t.reviewAt ? relativeStamp(t.reviewAt.toISOString()) : 'never' },
    ],
    sections,
    actions: [
      link('open', 'open in feed →', `/jkai/daydreams/feed?open=${id}`),
      { id: 'useful', label: 'useful', kind: 'post', endpoint: api, body: { action: 'feedback', id, verdict: 'useful' } },
      { id: 'not-useful', label: 'not useful', kind: 'post', endpoint: api, body: { action: 'feedback', id, verdict: 'not_useful' } },
      { id: 'review', label: 'review now', kind: 'post', endpoint: api, body: { action: 'review_now', id }, note: 'Sends a model to check the claim against the sources and remembers the ruling.' },
      { id: 'note', label: 'add a note', kind: 'prompt', endpoint: api, body: { action: 'add_note', thoughtId: id }, promptField: 'text', promptLabel: 'Your note on this thought', refresh: 'memory' },
      { id: 'snooze', label: 'snooze a week', kind: 'post', endpoint: api, body: { action: 'snooze', id, days: 7 } },
      { id: 'archive', label: 'archive', kind: 'confirm', endpoint: api, body: { action: 'archive', id }, tone: 'danger', note: 'Filed, not judged — it moves no kind weight.' },
      ask(`What do you make of this daydream: "${t.title}"?`, `Daydream thought (${t.kind}): ${t.title}\n${t.explanation}`),
    ],
  });
}

async function placesManifest(filter: 'all' | 'named', target: string): Promise<DrillManifest> {
  const rows = await db
    .select({ id: daydreamPlaces.id, label: daydreamPlaces.label, suggestedLabel: daydreamPlaces.suggestedLabel, kind: daydreamPlaces.kind, source: daydreamPlaces.source, visitCount: daydreamPlaces.visitCount, distinctDays: daydreamPlaces.distinctDays })
    .from(daydreamPlaces)
    .where(eq(daydreamPlaces.status, 'active'))
    .orderBy(desc(daydreamPlaces.distinctDays))
    .limit(30);
  const named = rows.filter((p) => p.label);
  const list = filter === 'named' ? named : rows;
  return finish({
    target,
    kind: 'places',
    eyebrow: 'Daydream · places',
    title: filter === 'named' ? 'Places you have named' : 'Repeated places',
    subtitle: 'Ranked by separate days anyone stayed there, not by household visit count.',
    href: '/jkai/daydreams/places',
    facts: [
      { label: 'Named', value: String(named.length), tone: named.length ? 'good' : 'default' },
      { label: 'Unnamed', value: String(rows.length - named.length), tone: rows.length - named.length ? 'warn' : 'default' },
      { label: 'Listed', value: String(rows.length) },
    ],
    sections: [
      {
        kind: 'rows',
        id: 'places',
        title: `${list.length} place${list.length === 1 ? '' : 's'}`,
        rows: list.map((p) => ({
          id: p.id,
          label: p.label ?? p.suggestedLabel ?? 'Unnamed place',
          meta: `${p.kind} · ${p.source}`,
          note: `${p.distinctDays} days · ${p.visitCount} visits`,
          drill: drillKey({ kind: 'place', id: p.id }),
          tone: p.label ? 'default' : 'warn',
        })),
        empty: 'No places yet.',
      },
    ],
    actions: [link('places', 'open places →', '/jkai/daydreams/places')],
  });
}

async function placeManifest(id: string, target: string): Promise<DrillManifest | null> {
  const [p] = await db
    .select({
      id: daydreamPlaces.id,
      label: daydreamPlaces.label,
      kind: daydreamPlaces.kind,
      source: daydreamPlaces.source,
      memoryId: daydreamPlaces.memoryId,
      suggestedLabel: daydreamPlaces.suggestedLabel,
      suggestedKind: daydreamPlaces.suggestedKind,
      suggestedAddress: daydreamPlaces.suggestedAddress,
      visitCount: daydreamPlaces.visitCount,
      distinctDays: daydreamPlaces.distinctDays,
      radiusM: daydreamPlaces.radiusM,
    })
    .from(daydreamPlaces)
    .where(eq(daydreamPlaces.id, id))
    .limit(1);
  if (!p) return null;
  const api = '/api/daydream/thoughts';
  const name = p.label ?? p.suggestedLabel ?? 'Unnamed place';
  const sections: DrillSection[] = [];
  if (!p.label && (p.suggestedLabel || p.suggestedAddress)) {
    sections.push({ kind: 'prose', id: 'suggestion', title: 'The geocoder thinks', body: [p.suggestedLabel, p.suggestedAddress].filter(Boolean).join(' — '), tone: 'warn' });
  }
  if (p.memoryId) {
    sections.push({
      kind: 'rows',
      id: 'memory',
      title: 'Remembered as',
      rows: [{ id: p.memoryId, label: 'The memory written when you named it', meta: 'memory', drill: drillKey({ kind: 'memory', id: p.memoryId }) }],
    });
  }
  const actions: DrillAction[] = [link('places', 'open places →', '/jkai/daydreams/places')];
  if (!p.label) {
    actions.push({
      id: 'name',
      label: 'name this place',
      kind: 'prompt',
      endpoint: api,
      body: { action: 'name_place', placeId: id, kind: p.suggestedKind ?? 'other' },
      promptField: 'label',
      promptLabel: 'What is this place called?',
      promptDefault: p.suggestedLabel ?? '',
      refresh: 'memory',
    });
    actions.push({ id: 'ignore', label: 'ignore', kind: 'confirm', endpoint: api, body: { action: 'ignore_place', placeId: id }, tone: 'danger', note: 'Stops asking about it.' });
  }
  actions.push(ask(`What do you know about ${name}?`, `Place: ${name} (${p.kind}, ${p.source}) — ${p.distinctDays} separate days, ${p.visitCount} visits`));
  return finish({
    target,
    kind: 'place',
    eyebrow: `Daydream · ${p.kind === 'unknown' ? 'place' : p.kind}`,
    title: name,
    subtitle: p.source === 'confirmed' ? 'You named it — quotable as fact.' : p.source === 'geocoded' ? 'A reverse lookup, not your word.' : 'Inferred from a pattern — only ever a question.',
    href: '/jkai/daydreams/places',
    facts: [
      { label: 'Days', value: String(p.distinctDays) },
      { label: 'Visits', value: String(p.visitCount) },
      { label: 'Source', value: p.source, tone: p.source === 'confirmed' ? 'good' : 'warn' },
      { label: 'Radius', value: `${Math.round(p.radiusM)} m` },
    ],
    sections,
    actions,
  });
}

// ── Memory ────────────────────────────────────────────────────────────────

function memoryRowOf(r: ThreadMemoryRow): DrillRow {
  const stateTone: DrillRow['tone'] =
    r.state === 'forgotten' || r.state === 'replaced' || r.state === 'expired' ? 'bad' : r.state === 'expiring' ? 'warn' : r.state === 'pinned' ? 'accent' : 'default';
  return {
    id: r.id,
    label: r.content,
    meta: `${r.category} · ${MEMORY_STATE_LABEL[r.state]}${r.use.servedTurns ? ` · served ${r.use.servedTurns}×` : ''}`,
    note: r.recalledBecause ?? undefined,
    drill: drillKey({ kind: 'memory', id: r.id }),
    tone: stateTone,
    when: r.updatedAt,
  };
}

async function memoriesManifest(conversationId: string, filter: 'served' | 'relevant' | 'thread' | 'changed', target: string): Promise<DrillManifest | null> {
  const payload = await composeThreadMemory(conversationId);
  if (!payload) return null;
  const titles = {
    served: 'What the last turn was given',
    relevant: 'What the next turn would most likely be given',
    thread: 'What this thread wrote, recalled or forgot',
    changed: 'What moved in the store lately',
  } as const;
  const list = filter === 'served' ? payload.served : filter === 'relevant' ? payload.relevant : filter === 'thread' ? payload.thread.rows : payload.changed;
  const sections: DrillSection[] = [
    { kind: 'rows', id: filter, title: `${list.length} memor${list.length === 1 ? 'y' : 'ies'}`, rows: list.map(memoryRowOf), empty: filter === 'served' && !payload.recorded ? 'No turn in this thread has recorded what it was given yet.' : 'Nothing here.' },
  ];
  if (filter === 'thread' && payload.thread.events.length) {
    sections.push({
      kind: 'rows',
      id: 'events',
      title: 'Tool events in this thread',
      rows: payload.thread.events.map((e) => ({
        id: e.id,
        label: e.summary ?? `${e.verb} via ${e.tool}`,
        meta: e.verb,
        note: e.memoryIds.length ? `${e.memoryIds.length} memor${e.memoryIds.length === 1 ? 'y' : 'ies'}` : undefined,
        href: `/jkai/trace/${e.traceId}`,
        when: e.at,
        tone: e.verb === 'forgotten' ? 'bad' : e.verb === 'written' ? 'accent' : 'default',
      })),
    });
  }
  return finish({
    target,
    kind: 'memories',
    eyebrow: 'Memory',
    title: titles[filter],
    subtitle: filter === 'relevant' ? `Retrieval over: “${payload.relevantQuery.slice(-160).replace(/\s+/g, ' ')}”` : undefined,
    href: '/jkai/intel/memory',
    facts: [
      { label: 'Live', value: String(payload.figures.live) },
      { label: 'Pinned', value: String(payload.figures.pinned), tone: payload.figures.pinned ? 'accent' : 'default' },
      { label: 'From here', value: String(payload.figures.writtenHere), tone: payload.figures.writtenHere ? 'good' : 'default' },
      { label: 'Stale 30d', value: String(payload.figures.stale30d), tone: payload.figures.stale30d ? 'warn' : 'default' },
    ],
    sections,
    actions: [link('page', 'memory page →', '/jkai/intel/memory')],
  });
}

async function memoryManifest(conversationId: string, id: string, target: string): Promise<DrillManifest | null> {
  const [m] = await db.select().from(jkaiMemories).where(eq(jkaiMemories.id, id)).limit(1);
  if (!m) return null;
  const now = Date.now();
  const state = memoryState(m, now);
  const personal = !m.daydreamOrigin && (m.provenance?.scope ?? 'personal') === 'personal';
  const [links, replacedBy, replaces, stamps, sourceConv] = await Promise.all([
    memoryLinks([id]),
    m.supersededBy && m.supersededBy !== 'forgotten'
      ? db.select({ id: jkaiMemories.id, content: jkaiMemories.content, updatedAt: jkaiMemories.updatedAt }).from(jkaiMemories).where(eq(jkaiMemories.id, m.supersededBy)).limit(1)
      : Promise.resolve([]),
    db.select({ id: jkaiMemories.id, content: jkaiMemories.content, updatedAt: jkaiMemories.updatedAt }).from(jkaiMemories).where(eq(jkaiMemories.supersededBy, id)).orderBy(desc(jkaiMemories.updatedAt)).limit(5),
    db
      .select({ id: orchestratorChats.id, createdAt: orchestratorChats.createdAt })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.conversationId, conversationId), eq(orchestratorChats.role, 'assistant'), sql`${orchestratorChats.metadata}->'memory'->'served' ? ${id}`))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(20),
    m.sourceConversationId
      ? db.select({ id: conversations.id, title: conversations.title }).from(conversations).where(eq(conversations.id, m.sourceConversationId)).limit(1)
      : Promise.resolve([] as Array<{ id: string; title: string | null }>),
  ]);
  const api = '/api/jkai/memory';
  const stateTone: DrillFact['tone'] = state === 'forgotten' || state === 'replaced' || state === 'expired' ? 'bad' : state === 'expiring' ? 'warn' : state === 'pinned' ? 'accent' : 'good';
  const sections: DrillSection[] = [
    { kind: 'prose', id: 'content', title: 'The memory', body: m.content },
  ];
  const lineage: DrillRow[] = [];
  for (const r of replacedBy) lineage.push({ id: r.id, label: r.content, meta: 'replaced by', note: relativeStamp(r.updatedAt.toISOString()), drill: drillKey({ kind: 'memory', id: r.id }), tone: 'accent' });
  for (const r of replaces) lineage.push({ id: r.id, label: r.content, meta: 'replaces', note: relativeStamp(r.updatedAt.toISOString()), drill: drillKey({ kind: 'memory', id: r.id }) });
  if (m.provenance?.sourceMemoryIds?.length) {
    for (const sid of m.provenance.sourceMemoryIds.slice(0, 5)) lineage.push({ id: sid, label: 'Derived from', meta: 'source', drill: drillKey({ kind: 'memory', id: sid }) });
  }
  sections.push({ kind: 'rows', id: 'lineage', title: 'Lineage', rows: lineage, empty: 'No earlier or later version.' });
  sections.push({
    kind: 'rows',
    id: 'entities',
    title: 'Linked entities',
    rows: links.map((l) => ({ id: l.id, label: l.name, meta: l.method, href: `/jkai/intel/entities/${l.id}`, drill: `entity:${l.id}` })),
    empty: 'Not linked to any intelligence entity.',
  });
  sections.push({
    kind: 'rows',
    id: 'use',
    title: 'Given to this thread',
    rows: stamps.map((s) => ({ id: s.id, label: `Turn ${relativeStamp(s.createdAt.toISOString())}`, meta: 'served', when: s.createdAt.toISOString() })),
    empty: 'No recorded turn in this thread was given this memory.',
  });

  const actions: DrillAction[] = [link('page', 'memory page →', '/jkai/intel/memory')];
  if (personal && !m.supersededBy) {
    actions.push(
      { id: 'pin', label: m.provenance?.pinned ? 'unpin' : 'pin as core context', kind: 'post', endpoint: api, body: { action: 'pin', id, pinned: !m.provenance?.pinned }, note: m.provenance?.pinned ? 'Drops it from the pinned profile every turn carries.' : 'Carried on every turn, ahead of relevance.', refresh: 'memory' },
      { id: 'correct', label: 'correct', kind: 'prompt', endpoint: api, body: { action: 'correct', id }, promptField: 'content', promptLabel: 'The corrected fact', promptDefault: m.content, refresh: 'memory' },
      { id: 'forget', label: 'forget', kind: 'confirm', endpoint: api, body: { action: 'forget', id }, tone: 'danger', note: 'Tombstones it and everything derived from it.', refresh: 'memory' },
    );
  }
  actions.push(ask('Is this still right?', `Memory (${m.category}): ${m.content}`));

  return finish({
    target,
    kind: 'memory',
    eyebrow: `Memory · ${m.category}`,
    title: m.content.length > 90 ? `${m.content.slice(0, 88)}…` : m.content,
    subtitle: `${m.provenance?.origin ?? (m.daydreamOrigin ? `daydream ${m.daydreamOrigin}` : 'legacy')} · ${m.provenance?.assertion ?? 'unverified'}${sourceConv[0] ? ` · from “${sourceConv[0].title ?? 'a thread'}”` : ''}`,
    href: '/jkai/intel/memory',
    facts: [
      { label: 'State', value: MEMORY_STATE_LABEL[state], tone: stateTone },
      { label: 'Confidence', value: m.confidence, tone: m.confidence === 'high' ? 'good' : 'default' },
      { label: 'Recorded', value: relativeStamp(m.createdAt.toISOString()) },
      { label: 'Updated', value: relativeStamp(m.updatedAt.toISOString()) },
      { label: 'Valid from', value: m.provenance?.validFrom ? m.provenance.validFrom.slice(0, 10) : 'always' },
      { label: 'Valid until', value: m.provenance?.validUntil ? m.provenance.validUntil.slice(0, 10) : 'open' },
    ],
    sections,
    actions: actions.slice(0, 8),
  });
}

// ── Generic card ──────────────────────────────────────────────────────────

async function cardManifest(conversationId: string, lens: string, cardId: string, metric: string | null, target: string): Promise<DrillManifest | null> {
  const panel = await composeContextPanel(conversationId, lens);
  const card = panel?.cards.find((c) => c.id === cardId);
  if (!panel || !card) return null;
  const facts: DrillFact[] = [];
  const sections: DrillSection[] = [];
  let title = card.title;
  if (card.type === 'metrics') {
    const chosen = metric ? card.metrics.find((x) => x.label === metric) : null;
    if (chosen) title = `${card.title} · ${chosen.label}`;
    for (const x of card.metrics) facts.push({ label: x.label, value: x.value, detail: x.detail, tone: x.tone === 'default' ? undefined : x.tone });
  } else if (card.type === 'bars') {
    sections.push({ kind: 'rows', id: 'rows', title: 'Rows', rows: card.rows.map((r) => ({ id: r.id, label: r.label, meta: r.display ?? String(r.value), href: r.href })) });
  } else if (card.type === 'links') {
    sections.push({ kind: 'rows', id: 'rows', title: 'Rows', rows: card.rows.map((r) => ({ id: r.id, label: r.label, meta: r.meta, note: r.note, href: r.href })) });
  } else if (card.type === 'series') {
    for (const s of card.series) {
      const ys = s.points.map((p) => p.y);
      if (!ys.length) continue;
      const latest = s.points[s.points.length - 1];
      facts.push({ label: `${s.label} latest`, value: `${latest.y}${card.unit ? ` ${card.unit}` : ''}`, detail: latest.x });
      facts.push({ label: `${s.label} range`, value: `${Math.min(...ys)}–${Math.max(...ys)}`, detail: `${ys.length} points` });
    }
    sections.push({
      kind: 'list',
      id: 'recent',
      title: 'Most recent points',
      items: card.series.flatMap((s) => s.points.slice(-5).map((p) => `${s.label} · ${p.x}: ${p.y}${card.unit ? ` ${card.unit}` : ''}`)).slice(0, 15),
    });
  } else {
    sections.push({ kind: 'prose', id: 'note', title: card.title, body: card.body, tone: card.tone === 'warn' ? 'warn' : undefined });
  }
  return finish({
    target,
    kind: 'card',
    eyebrow: `${lens} · ${card.title}`,
    title,
    subtitle: card.subtitle,
    href: card.href,
    facts: facts.slice(0, 8),
    sections,
    actions: [
      ...(card.href ? [link('open', 'open →', card.href)] : []),
      ask(`Tell me about ${title}.`, `${card.title}${card.subtitle ? ` — ${card.subtitle}` : ''}\n${facts.map((f) => `${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ''}`).join('\n')}`),
    ],
  });
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function composeDrill(conversationId: string, target: DrillTarget): Promise<DrillManifest | null> {
  const key = drillKey(target);
  switch (target.kind) {
    case 'entities':
      return entitiesManifest(await buildThreadGraph(conversationId), target.filter, key);
    case 'relations':
      return relationsManifest(await buildThreadGraph(conversationId), key);
    case 'entity':
      return entityManifest(conversationId, await buildThreadGraph(conversationId), key);
    case 'research-desk':
      return researchDeskManifest(target.filter, key);
    case 'research-run':
      return researchRunManifest(target.id, key);
    case 'thoughts':
      return thoughtsManifest(target.filter, key);
    case 'thought':
      return thoughtManifest(target.id, key);
    case 'places':
      return placesManifest(target.filter, key);
    case 'place':
      return placeManifest(target.id, key);
    case 'memories':
      return memoriesManifest(conversationId, target.filter, key);
    case 'memory':
      return memoryManifest(conversationId, target.id, key);
    case 'card':
      return cardManifest(conversationId, target.lens, target.cardId, target.metric, key);
  }
}
