// The one-pager: everything the graph holds about a subject, on a page you
// could hand to someone.
//
// The whole design constraint is TRACEABILITY. An LLM summary of a knowledge
// graph is indistinguishable from the model's own priors unless every claim
// points at the note it came from — and a brief you cannot trace is worthless,
// because the one question anybody asks of it is "says who?". So the evidence
// is NUMBERED before the model ever sees it, the prompt requires a [n] marker
// on each factual sentence, and `reconcileCitations` deletes any marker that
// points at nothing. What survives maps to a real note id the reader can open.
//
// `buildBriefPrompt` and the citation handling are PURE and unit-tested. The
// assembly and the LLM call import `$lib/db` and the LLM client dynamically,
// because both pull in `$env/dynamic/private`, which does not resolve under
// vitest — the same reason entity-query.ts and insight-store.ts do it.
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { voiceBlock } from '$lib/voice/block';
import {
  intelCommissions,
  intelDossierItems,
  intelDossiers,
  intelEntities,
  intelEntityTypes,
  intelNoteEntities,
  intelNotes,
  intelTimelineEvents,
  researchSessions,
} from '$lib/db/schema';

// ── Shape ────────────────────────────────────────────────────────────────────

export interface BriefSubject {
  id: string;
  name: string;
  typeName: string;
  icon: string;
  summary: string | null;
  confirmed: boolean;
  aliases: string[];
  /** Connections in the graph — the reason a thin entity reads as thin. */
  degree: number;
  noteCount: number;
  /** Trust, only when it has actually been graded. Never inferred. */
  sourceGrade: string | null;
  credibility: number | null;
  corroboration: number;
  confidenceScore: number | null;
}

export interface BriefNeighbour {
  id: string;
  name: string;
  typeName: string;
  /** Which subject this hangs off — a multi-subject brief needs to say. */
  viaId: string;
  relationship: string;
  degree: number;
  /** A neighbour in another cluster is the more interesting connection. */
  crossCommunity: boolean;
}

/** An edge between two subjects of the same brief. */
export interface BriefLink {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  relationship: string;
}

/** A numbered source note. `n` is the citation marker the model must use. */
export interface BriefSource {
  n: number;
  noteId: string;
  title: string;
  source: string;
  createdAt: string;
  excerpt: string | null;
  /** The graph's own copy — always resolvable, unlike an external URL. */
  href: string;
  sourceUrl: string | null;
  /** Subjects this note is evidence for. */
  entityIds: string[];
}

export interface BriefEvent {
  date: string;
  dateEnd: string | null;
  title: string;
  description: string | null;
  entityName: string | null;
  /** Citation number of the note this event came from, when it is in scope. */
  citation: number | null;
}

export interface BriefResearch {
  id: string;
  topic: string;
  status: string;
  url: string;
  createdAt: string;
}

/**
 * What a cluster is, as opposed to what its members are.
 *
 * A brief over a cluster's twelve most central entities describes those twelve
 * entities. It cannot, from the subjects alone, say that they sit in a body of
 * two hundred, that the evidence is four fifths files and one fifth chat, or
 * that it spans eleven weeks — and those are the facts that make it a
 * description of the CLUSTER rather than a description of a dozen things that
 * happen to be in one.
 */
export interface ClusterBriefFacts {
  label: string;
  /** Entities in the whole cluster, not just the ones written up. */
  size: number;
  /** How many of them are subjects of this brief. */
  subjectCount: number;
  types: Array<[string, number]>;
  sources: Array<[string, number]>;
  /** Members with no provenance at all. */
  sourceless: number;
  noteTotal: number;
  /** Normalised source-mix entropy, 0..1. */
  diversity: number;
  /** Observed span of the evidence, ISO dates. */
  span: { from: string; to: string } | null;
  /** Members holding this cluster to others, and which others. */
  bridges: Array<{ name: string; reaches: string[] }>;
}

export interface BriefContext {
  title: string;
  subjects: BriefSubject[];
  neighbours: BriefNeighbour[];
  links: BriefLink[];
  sources: BriefSource[];
  timeline: BriefEvent[];
  research: BriefResearch[];
  /** Analyst-set questions the brief should try to answer (dossier briefs). */
  openQuestions: string[];
  generatedAt: string;
  /** Set only for a cluster narrative. Absent for entity and dossier briefs. */
  cluster?: ClusterBriefFacts;
}

/** A source plus whether the finished brief actually leant on it. */
export interface BriefCitation extends BriefSource {
  used: boolean;
}

export interface BriefResult {
  markdown: string;
  citations: BriefCitation[];
  /** Markers the model invented; removed from the markdown before display. */
  droppedMarkers: number[];
  context: BriefContext;
}

// ── Limits ───────────────────────────────────────────────────────────────────

export const MAX_SUBJECTS = 12;
export const MAX_NEIGHBOURS_PER_SUBJECT = 10;
export const MAX_NEIGHBOURS_TOTAL = 40;
export const MAX_SOURCES = 16;
export const MAX_TIMELINE = 12;
export const MAX_EXCERPT_CHARS = 320;

// ── Prompt (pure) ────────────────────────────────────────────────────────────

export interface BriefPrompt {
  system: string;
  user: string;
}

// Built lazily rather than as a module-level constant: voiceBlock() reads the
// Voice Card off disk, and doing that at import time would run a filesystem read
// on module load and freeze the card until the next restart.
function systemBase(): string {
  return `You write single-page intelligence briefs from a knowledge graph.

Rules:
- Every factual sentence ends with a citation marker such as [1], naming the SOURCE it came from. Use several — [1][3] — when a claim rests on more than one.
- Use ONLY the CONTEXT supplied. If the context does not support a claim, do not make it.
- Anything you infer rather than read is prefixed "Assessment:" and carries no marker.
- Never invent a source number. Only the numbers listed under SOURCES exist.
- No preamble, no sign-off, no meta-commentary.
${voiceBlock('explanatory', { exemplars: 0 })}

Use these headings, in this order, omitting any the context cannot fill:
## Bottom line
## What we know
## Connections
## Timeline
## Gaps

Keep the whole brief under 500 words.`;
}

/**
 * Appended for a cluster narrative.
 *
 * The subjects are a SAMPLE of the cluster, not the cluster, and a narrative
 * that quietly treats twelve entities as the whole of two hundred is wrong in
 * the way that is hardest to notice. Saying so in the prompt is cheaper than
 * detecting it afterwards.
 */
const SYSTEM_CLUSTER = `

THIS IS A CLUSTER NARRATIVE, not a brief about one subject.

The cluster is a group the graph detected on its own; nobody chose its members. The SUBJECTS below are its most connected members, NOT all of it — the CLUSTER section gives the real size and shape. Write about the cluster as a whole:

- "Bottom line" says what this cluster IS, in one or two sentences, from the material itself. Do NOT guess whether it matters to the reader or how it was acquired — the CLUSTER section states how its evidence arrived, and that is the only basis for saying so.
- "What we know" describes the material, and must state where the evidence came from and over what period — the source mix and span are given to you.
- "Connections" covers what holds this cluster to the rest of the graph.
- "Gaps" must name the weaknesses in the CLUSTER, including members with no evidence at all, a source mix resting on one channel, and any period the evidence does not cover.

Never imply the sample is the whole. Where a claim only holds for the members listed, say so.`;

/** Appended when there is no evidence at all — see the note in `buildBriefPrompt`. */
const SYSTEM_UNSOURCED = `

THIS BRIEF HAS NO SOURCES. Write from the graph structure alone, use no citation markers at all, and open the brief with a single line warning that none of it is sourced.`;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function renderSubject(subject: BriefSubject): string {
  const lines = [`### ${subject.name} — ${subject.typeName}`];
  if (subject.aliases.length) lines.push(`Also known as: ${subject.aliases.join(', ')}`);
  if (subject.summary) lines.push(`Summary on file: ${subject.summary}`);

  // Trust is stated rather than implied. A brief that reads as confident about
  // a single-source, ungraded entity is the failure mode worth designing out.
  const trust: string[] = [
    `${subject.degree} connection${subject.degree === 1 ? '' : 's'}`,
    `${subject.noteCount} note${subject.noteCount === 1 ? '' : 's'}`,
    `corroborated by ${subject.corroboration} independent source${subject.corroboration === 1 ? '' : 's'}`,
    subject.confirmed ? 'analyst-confirmed' : 'NOT analyst-confirmed',
  ];
  if (subject.sourceGrade) trust.push(`source grade ${subject.sourceGrade}`);
  if (subject.credibility != null) trust.push(`credibility ${subject.credibility}`);
  if (subject.confidenceScore != null) trust.push(`confidence ${subject.confidenceScore.toFixed(2)}`);
  lines.push(`Standing: ${trust.join('; ')}.`);

  return lines.join('\n');
}

function renderNeighbours(context: BriefContext): string {
  if (!context.neighbours.length) return 'No connections recorded in the graph.';

  const nameById = new Map(context.subjects.map((s) => [s.id, s.name]));
  const grouped = new Map<string, BriefNeighbour[]>();
  for (const n of context.neighbours) {
    const list = grouped.get(n.viaId);
    if (list) list.push(n);
    else grouped.set(n.viaId, [n]);
  }

  const blocks: string[] = [];
  for (const [viaId, list] of grouped) {
    const header = nameById.get(viaId) ?? viaId;
    const rows = list.map(
      (n) =>
        `- ${header} —[${n.relationship}]→ ${n.name} (${n.typeName}, ${n.degree} connections` +
        `${n.crossCommunity ? ', different cluster' : ''})`,
    );
    blocks.push(rows.join('\n'));
  }
  return blocks.join('\n');
}

function renderSources(sources: readonly BriefSource[]): string {
  if (!sources.length) {
    return 'NO SOURCES. Nothing in the graph carries evidence for this subject.';
  }
  return sources
    .map((s) => {
      const head = `[${s.n}] ${s.title} — ${s.source}, ${s.createdAt.slice(0, 10)}`;
      return s.excerpt ? `${head}\n    "${truncate(s.excerpt, MAX_EXCERPT_CHARS)}"` : head;
    })
    .join('\n');
}

function renderTimeline(events: readonly BriefEvent[]): string {
  if (!events.length) return 'No dated events recorded.';
  return events
    .map((e) => {
      const range = e.dateEnd ? `${e.date} → ${e.dateEnd}` : e.date;
      const who = e.entityName ? ` (${e.entityName})` : '';
      const cite = e.citation ? ` [${e.citation}]` : '';
      const detail = e.description ? ` — ${truncate(e.description, 200)}` : '';
      return `- ${range}: ${e.title}${who}${detail}${cite}`;
    })
    .join('\n');
}

/**
 * The cluster's own shape, stated as facts the subjects cannot carry.
 *
 * The source mix is spelled out per channel rather than summarised, because
 * "80% email" and "file 140, chat 63, research 19" invite different sentences —
 * and the second is what lets the narrative say which material the cluster
 * actually rests on.
 */
/**
 * Below this, a cluster's evidence is effectively all from one channel.
 *
 * Matches what the real graph does at the extremes — Brakeburn 0.04, Zavvi 0.04,
 * CMaxOwnersClub 0.00 are single-mailbox feeds; IBCA 0.70 and DfE 0.72 are
 * corroborated bodies of work.
 */
const SINGLE_SOURCE_DIVERSITY = 0.1;

function renderCluster(cluster: ClusterBriefFacts): string {
  const lines = [
    `${cluster.label} — ${cluster.size} entities, of which the ${cluster.subjectCount} most connected are written up below.`,
    `Composition: ${cluster.types.map(([t, n]) => `${t} ${n}`).join(', ') || 'unknown'}.`,
    `Evidence: ${cluster.sources.map(([s, n]) => `${s} ${n}`).join(', ') || 'none'} — ${cluster.noteTotal} note links in total.`,
  ];

  // The subject/feed call is made HERE, from the source mix, and handed to the
  // model as a fact. Asking the model to judge it instead produced a confident
  // wrong answer on the first real run: it labelled a cluster of hand-written
  // policy documents "a feed arriving on its own", because nothing in a list of
  // entities tells you how they were acquired. The data does.
  lines.push(
    cluster.diversity < SINGLE_SOURCE_DIVERSITY
      ? `Every member of this cluster came from ONE kind of source (${cluster.sources[0]?.[0] ?? 'unknown'}). It is a feed arriving on its own, not material gathered deliberately — say so in the bottom line.`
      : `Corroborated across ${cluster.sources.length} kinds of source (diversity ${cluster.diversity.toFixed(2)}), which is material engaged with deliberately rather than a feed — say so in the bottom line.`,
  );

  if (cluster.span) {
    lines.push(`Observed span: ${cluster.span.from.slice(0, 10)} to ${cluster.span.to.slice(0, 10)}.`);
  }
  if (cluster.sourceless > 0) {
    lines.push(
      `${cluster.sourceless} member${cluster.sourceless === 1 ? '' : 's'} carry NO evidence at all — name this under Gaps.`,
    );
  }
  if (cluster.bridges.length) {
    lines.push(
      `Held to the rest of the graph by: ${cluster.bridges
        .map((b) => `${b.name} (reaches ${b.reaches.length} other cluster${b.reaches.length === 1 ? '' : 's'})`)
        .join(', ')}.`,
    );
  }
  return lines.join('\n');
}

/**
 * The prompt for one brief. PURE — no clock, no DB, no randomness, so the same
 * context always produces the same instructions and the citation contract can
 * be tested without a model.
 *
 * Degrades on purpose rather than by accident: with no neighbours or no
 * evidence the sections still render, saying plainly that there is nothing
 * there. An empty section would invite the model to fill the silence.
 */
export function buildBriefPrompt(context: BriefContext): BriefPrompt {
  const hasSources = context.sources.length > 0;

  const parts: string[] = [
    `BRIEF: ${context.title}`,
    `Generated: ${context.generatedAt.slice(0, 10)}`,
  ];

  if (context.cluster) parts.push('', '## CLUSTER', renderCluster(context.cluster));

  parts.push(
    '',
    '## SUBJECTS',
    context.subjects.length
      ? context.subjects.map(renderSubject).join('\n\n')
      : 'No subject resolved — say so and stop.',
    '',
    '## CONNECTIONS',
    renderNeighbours(context),
  );

  if (context.links.length) {
    parts.push(
      '',
      '## LINKS BETWEEN SUBJECTS',
      context.links.map((l) => `- ${l.fromName} —[${l.relationship}]→ ${l.toName}`).join('\n'),
    );
  }

  parts.push('', '## TIMELINE', renderTimeline(context.timeline));

  if (context.research.length) {
    parts.push(
      '',
      '## COMMISSIONED RESEARCH',
      context.research.map((r) => `- ${r.topic} (${r.status}) — ${r.url}`).join('\n'),
    );
  }

  if (context.openQuestions.length) {
    parts.push(
      '',
      '## OPEN QUESTIONS THE ANALYST WANTS ANSWERED',
      context.openQuestions.map((q) => `- ${q}`).join('\n'),
      'Address each one under "Gaps" — including, explicitly, the ones the evidence cannot answer.',
    );
  }

  parts.push('', '## SOURCES', renderSources(context.sources));

  const system =
    (context.cluster ? systemBase() + SYSTEM_CLUSTER : systemBase()) +
    (hasSources ? '' : SYSTEM_UNSOURCED);

  return { system, user: parts.join('\n') };
}

// ── Citations (pure) ─────────────────────────────────────────────────────────

/** `[1]`, `[1][2]`, `[1, 2]` — every number the model cited, in order of use. */
export function extractCitationMarkers(markdown: string): number[] {
  const out: number[] = [];
  for (const match of markdown.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const piece of match[1].split(',')) {
      const n = Number(piece.trim());
      if (Number.isInteger(n)) out.push(n);
    }
  }
  return out;
}

/**
 * Bind the finished markdown to the evidence it was given.
 *
 * A marker pointing at a source that does not exist is worse than no marker —
 * it looks like provenance and isn't — so invented numbers are stripped out of
 * the prose entirely. Real markers keep their original number so they still
 * line up with the returned citation list.
 */
export function reconcileCitations(
  markdown: string,
  sources: readonly BriefSource[],
): { markdown: string; citations: BriefCitation[]; droppedMarkers: number[] } {
  const valid = new Set(sources.map((s) => s.n));
  const used = new Set<number>();
  const dropped = new Set<number>();

  const cleaned = markdown.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (whole, group: string) => {
    const numbers = group
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isInteger(n));
    const keep = numbers.filter((n) => valid.has(n));
    for (const n of numbers) (valid.has(n) ? used : dropped).add(n);
    if (!keep.length) return '';
    return keep.map((n) => `[${n}]`).join('');
  });

  return {
    // Removing a marker can leave " ." or a double space behind.
    markdown: cleaned.replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' '),
    citations: sources.map((s) => ({ ...s, used: used.has(s.n) })),
    droppedMarkers: [...dropped].sort((a, b) => a - b),
  };
}

/**
 * The downloadable document: the brief plus its evidence, so the file is
 * self-contained once it leaves the site.
 */
export function formatBriefDocument(
  markdown: string,
  context: BriefContext,
  citations: readonly BriefCitation[],
): string {
  const lines = [
    `# ${context.title}`,
    '',
    `_Brief generated ${context.generatedAt.slice(0, 10)} from ${context.sources.length} source${
      context.sources.length === 1 ? '' : 's'
    } and ${context.neighbours.length} graph connection${context.neighbours.length === 1 ? '' : 's'}._`,
    '',
    markdown.trim(),
  ];

  if (citations.length) {
    lines.push('', '## Sources', '');
    for (const c of citations) {
      const where = c.sourceUrl ? `${c.href} (${c.sourceUrl})` : c.href;
      lines.push(`${c.n}. ${c.title} — ${c.source}, ${c.createdAt.slice(0, 10)} — ${where}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

// ── Assembly (DB) ────────────────────────────────────────────────────────────

export interface AssembleOptions {
  /** Heading for the brief; defaults to the subject names. */
  title?: string;
  openQuestions?: string[];
}

function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))].slice(0, MAX_SUBJECTS);
}

/**
 * Gather everything a brief is allowed to draw on: the subjects themselves,
 * their neighbourhood, the notes that evidence them (with the excerpt the claim
 * was actually made in), the dated events, and any research already
 * commissioned off them.
 *
 * Returns a context with no subjects when nothing resolves, rather than
 * throwing — the caller decides whether that is a 404 or an empty dossier.
 */
export async function assembleBriefContext(
  entityIds: readonly string[],
  options: AssembleOptions = {},
): Promise<BriefContext> {
  const ids = normalizeIds(entityIds);
  const generatedAt = new Date().toISOString();
  const empty: BriefContext = {
    title: options.title ?? 'Brief',
    subjects: [],
    neighbours: [],
    links: [],
    sources: [],
    timeline: [],
    research: [],
    openQuestions: options.openQuestions ?? [],
    generatedAt,
  };
  if (!ids.length) return empty;

  const { db } = await import('$lib/db');
  const { getGraphAnalysis } = await import('./analytics/load');
  const { pairKey } = await import('./analytics/model');

  const rows = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      summary: intelEntities.summary,
      confirmed: intelEntities.confirmed,
      aliases: intelEntities.aliases,
      sourceGrade: intelEntities.sourceGrade,
      credibility: intelEntities.credibility,
      corroboration: intelEntities.corroboration,
      confidenceScore: intelEntities.confidenceScore,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      noteCount: sql<number>`(
        select count(*) from intel_note_entities
        where intel_note_entities.entity_id = intel_entities.id
      )::int`.as('note_count'),
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(inArray(intelEntities.id, ids));

  if (!rows.length) return empty;

  const analysis = await getGraphAnalysis();
  const { index, community } = analysis;

  // Keep the caller's order — a dossier's pin order is a deliberate ordering.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const subjects: BriefSubject[] = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      name: r.name,
      typeName: r.typeName,
      icon: r.typeIcon,
      summary: r.summary,
      confirmed: r.confirmed,
      aliases: Array.isArray(r.aliases) ? r.aliases.map(String).slice(0, 8) : [],
      degree: index.degree.get(r.id) ?? 0,
      noteCount: Number(r.noteCount ?? 0),
      sourceGrade: r.sourceGrade,
      credibility: r.credibility,
      corroboration: r.corroboration ?? 0,
      confidenceScore: r.confidenceScore,
    }));

  const subjectIds = new Set(subjects.map((s) => s.id));

  const relationshipBetween = (a: string, b: string): string => {
    const edges = index.edgesBetween.get(pairKey(a, b)) ?? [];
    const edge = edges[0];
    return edge?.label ?? edge?.type?.replace(/_/g, ' ') ?? 'related to';
  };

  const neighbours: BriefNeighbour[] = [];
  const seenNeighbour = new Set<string>();
  for (const subject of subjects) {
    const picked = [...(index.neighbours.get(subject.id) ?? [])]
      .filter((nid) => !subjectIds.has(nid))
      .map((nid) => index.byId.get(nid))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .sort((a, b) => (index.degree.get(b.id) ?? 0) - (index.degree.get(a.id) ?? 0))
      .slice(0, MAX_NEIGHBOURS_PER_SUBJECT);

    for (const n of picked) {
      // One row per (subject, neighbour): the same neighbour reached from two
      // subjects is two different facts about the case.
      const key = `${subject.id}|${n.id}`;
      if (seenNeighbour.has(key)) continue;
      seenNeighbour.add(key);
      neighbours.push({
        id: n.id,
        name: n.name,
        typeName: n.typeName,
        viaId: subject.id,
        relationship: relationshipBetween(subject.id, n.id),
        degree: index.degree.get(n.id) ?? 0,
        crossCommunity:
          community.membership.get(subject.id) !== community.membership.get(n.id),
      });
    }
  }
  neighbours.splice(MAX_NEIGHBOURS_TOTAL);

  const links: BriefLink[] = [];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const a = subjects[i];
      const b = subjects[j];
      if (!index.neighbours.get(a.id)?.has(b.id)) continue;
      links.push({
        fromId: a.id,
        toId: b.id,
        fromName: a.name,
        toName: b.name,
        relationship: relationshipBetween(a.id, b.id),
      });
    }
  }

  const resolvedIds = subjects.map((s) => s.id);

  const noteRows = await db
    .select({
      noteId: intelNotes.id,
      title: intelNotes.title,
      source: intelNotes.source,
      createdAt: intelNotes.createdAt,
      metadata: intelNotes.metadata,
      entityId: intelNoteEntities.entityId,
      // The excerpt is the sentence the claim was actually made in; without one
      // the head of the note is still better evidence than a bare title.
      excerpt: sql<string | null>`coalesce(
        ${intelNoteEntities.excerpt},
        substring(${intelNotes.processedContent} from 1 for 400)
      )`.as('excerpt'),
    })
    .from(intelNoteEntities)
    .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
    .where(inArray(intelNoteEntities.entityId, resolvedIds))
    .orderBy(desc(intelNotes.createdAt))
    .limit(MAX_SOURCES * 4);

  const sources: BriefSource[] = [];
  const sourceByNote = new Map<string, BriefSource>();
  for (const row of noteRows) {
    const existing = sourceByNote.get(row.noteId);
    if (existing) {
      if (!existing.entityIds.includes(row.entityId)) existing.entityIds.push(row.entityId);
      if (!existing.excerpt && row.excerpt) existing.excerpt = truncate(row.excerpt, MAX_EXCERPT_CHARS);
      continue;
    }
    if (sources.length >= MAX_SOURCES) continue;
    const meta = (row.metadata ?? null) as Record<string, unknown> | null;
    const entry: BriefSource = {
      n: sources.length + 1,
      noteId: row.noteId,
      title: row.title ?? 'Untitled note',
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      excerpt: row.excerpt ? truncate(row.excerpt, MAX_EXCERPT_CHARS) : null,
      href: `/jkai/intel/notes/${row.noteId}`,
      sourceUrl: meta?.sourceUrl == null ? null : String(meta.sourceUrl),
      entityIds: [row.entityId],
    };
    sources.push(entry);
    sourceByNote.set(row.noteId, entry);
  }

  const eventRows = await db
    .select({
      date: intelTimelineEvents.date,
      dateEnd: intelTimelineEvents.dateEnd,
      title: intelTimelineEvents.title,
      description: intelTimelineEvents.description,
      noteId: intelTimelineEvents.noteId,
      entityId: intelTimelineEvents.entityId,
    })
    .from(intelTimelineEvents)
    .where(inArray(intelTimelineEvents.entityId, resolvedIds))
    .orderBy(desc(intelTimelineEvents.date))
    .limit(MAX_TIMELINE);

  const subjectNames = new Map(subjects.map((s) => [s.id, s.name]));
  const timeline: BriefEvent[] = eventRows.map((e) => ({
    date: e.date,
    dateEnd: e.dateEnd,
    title: e.title,
    description: e.description,
    entityName: e.entityId ? (subjectNames.get(e.entityId) ?? null) : null,
    citation: sourceByNote.get(e.noteId)?.n ?? null,
  }));

  // Research already commissioned off these entities — so a brief does not
  // recommend a deep dive that is already running.
  const researchRows = await db
    .select({
      commissionId: intelCommissions.id,
      externalId: intelCommissions.externalId,
      externalUrl: intelCommissions.externalUrl,
      payload: intelCommissions.payload,
      status: intelCommissions.status,
      createdAt: intelCommissions.createdAt,
      topic: researchSessions.topic,
      sessionStatus: researchSessions.status,
    })
    .from(intelCommissions)
    .leftJoin(researchSessions, eq(intelCommissions.externalId, researchSessions.id))
    .where(and(eq(intelCommissions.kind, 'research'), inArray(intelCommissions.entityId, resolvedIds)))
    .orderBy(desc(intelCommissions.createdAt))
    .limit(6);

  const research: BriefResearch[] = researchRows.map((r) => ({
    id: r.externalId ?? r.commissionId,
    topic: truncate(r.topic ?? r.payload, 160),
    status: r.sessionStatus ?? r.status,
    url: r.externalUrl ?? (r.externalId ? `/deepdive/${r.externalId}` : '/research'),
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    title: options.title ?? subjects.map((s) => s.name).join(', '),
    subjects,
    neighbours,
    links,
    sources,
    timeline,
    research,
    openQuestions: options.openQuestions ?? [],
    generatedAt,
  };
}

/**
 * A narrative describing one detected cluster.
 *
 * Reuses the brief pipeline rather than growing a second one, which is the whole
 * point: `assembleBriefContext` already gathers subjects, their neighbours, the
 * links between them and — the part that matters here — the actual NOTES behind
 * them as numbered sources, and `reconcileCitations` already strips markers the
 * model invents. A cluster narrative that could not be traced back to real notes
 * would not be worth generating.
 *
 * Only the most connected members are written up; the rest of the cluster is
 * described by `facts` instead. Twelve is `MAX_SUBJECTS` — a two-hundred-entity
 * cluster cannot be rendered entity by entity into any usable context window,
 * and the central ones are the ones the others hang off.
 */
export async function assembleClusterBriefContext(
  memberIds: readonly string[],
  facts: Omit<ClusterBriefFacts, 'subjectCount'>,
): Promise<BriefContext> {
  const subjects = memberIds.slice(0, MAX_SUBJECTS);
  const context = await assembleBriefContext(subjects, { title: facts.label });
  return {
    ...context,
    cluster: { ...facts, subjectCount: context.subjects.length },
  };
}

/**
 * A brief across everything pinned to a dossier — the case file summarised in
 * one pass, rather than one entity at a time. Returns null when the dossier
 * does not exist.
 */
export async function assembleDossierBriefContext(dossierId: string): Promise<BriefContext | null> {
  const { db } = await import('$lib/db');

  const [dossier] = await db
    .select()
    .from(intelDossiers)
    .where(eq(intelDossiers.id, dossierId))
    .limit(1);
  if (!dossier) return null;

  const items = await db
    .select({ refId: intelDossierItems.refId, position: intelDossierItems.position })
    .from(intelDossierItems)
    .where(
      and(
        eq(intelDossierItems.dossierId, dossierId),
        eq(intelDossierItems.kind, 'entity'),
        isNotNull(intelDossierItems.refId),
      ),
    )
    .orderBy(asc(intelDossierItems.position), asc(intelDossierItems.pinnedAt));

  return assembleBriefContext(
    items.map((i) => String(i.refId)),
    { title: dossier.title, openQuestions: dossier.openQuestions ?? [] },
  );
}

// ── Generation (LLM) ─────────────────────────────────────────────────────────

/**
 * Reasoning models spend `max_tokens` on thinking before a single output token
 * appears, so a budget sized for the prose alone returns an empty string.
 * See reference_reasoning_token_floor.
 */
const BRIEF_MAX_TOKENS = 3200;

export async function generateBrief(context: BriefContext): Promise<BriefResult> {
  if (!context.subjects.length) {
    throw new Error('a brief needs at least one resolvable subject');
  }

  const { resolveIntelAnalysisModel } = await import('$lib/server/models/workload-settings');
  const { getLLMClient } = await import('$lib/llm/client');
  const { withActivity } = await import('$lib/context/activity');

  const modelCtx = await resolveIntelAnalysisModel();
  const { client, model } = await getLLMClient(modelCtx);
  const prompt = buildBriefPrompt(context);

  const response = await withActivity('intel-analysis', () =>
    client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: BRIEF_MAX_TOKENS,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  );

  const raw = (response.choices[0]?.message?.content ?? '').trim();
  if (!raw) throw new Error('the model returned an empty brief');

  const fenced = raw.replace(/^```(?:markdown|md)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const { markdown, citations, droppedMarkers } = reconcileCitations(fenced, context.sources);

  if (droppedMarkers.length) {
    console.warn(
      `[intel/brief] dropped invented citation markers: ${droppedMarkers.join(', ')} (had ${context.sources.length} sources)`,
    );
  }

  return { markdown, citations, droppedMarkers, context };
}
