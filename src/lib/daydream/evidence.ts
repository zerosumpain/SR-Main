// src/lib/daydream/evidence.ts
//
// Turning a citation into something you can actually read.
//
// Every thought carries `evidence: [{ kind, id, note? }]`, and until now the
// page rendered those two strings verbatim. A card would say
//
//     email    5e2f11c4-…-9a
//     calendar today
//     health   readiness
//
// which is a receipt, not an explanation. The facts behind a suggestion were
// all recorded and none of them were legible, so "why did it say that?" could
// only be answered by opening a database.
//
// This resolves each reference to its actual source: the email's subject,
// sender and date; the place's name and rhythm; the tested hypothesis and its
// verdict; the transaction; the memory. Where a real page exists for the
// thing — an intel note, a graph entity — it returns the link.
//
// ── Two kinds of reference, and the difference matters ──────────────────────
//
// Some refs are ROWS (`email` → intel_notes.id, `place` → daydream_places.id).
// Those resolve to a record, and if the record has since been deleted, saying
// so is the honest answer — a thought that cites something no longer there is
// a thought whose reasoning cannot be checked, and hiding that would be worse
// than showing it.
//
// Others are SYMBOLIC. The ponder pack cites `{kind:'health', id:'readiness'}`
// meaning "the readiness figure in the snapshot at the time", not a row. Those
// resolve to a description of what was looked at, and carry no link. They are
// marked `symbolic` so the page never offers a drill-through that goes
// nowhere.
//
// ── The graph ──────────────────────────────────────────────────────────────
//
// Where an evidence item touches the knowledge graph, the entities come back
// with it. That is the wire John asked for in the other direction: the intel
// bridge already turns graph insights INTO thoughts, and this turns a
// thought's own sources back into graph entities you can open.

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamHypotheses,
  daydreamMemoryThemes,
  daydreamMemoryThemeSources,
  daydreamPlaces,
  daydreamSpend,
  daydreamTrail,
  intelEntities,
  intelEntityTypes,
  intelInsights,
  intelNoteEntities,
  intelNotes,
  jkaiMemories,
} from '$lib/db/schema';
import type { EvidenceRef } from './snapshot-types';

export interface GraphEntity {
  id: string;
  name: string;
  type: string | null;
  href: string;
}

export interface ResolvedEvidence {
  kind: string;
  id: string;
  /** The citation note the detector wrote, kept verbatim. */
  note: string | null;

  /** One line naming the thing. Always present. */
  title: string;
  /** Supporting detail, one string per line. */
  lines: string[];
  /** ISO instant this evidence is about, when it has one. */
  at: string | null;
  /** A real page for this source, or null. */
  href: string | null;
  /** Graph entities this source touches. */
  entities: GraphEntity[];

  /** True when the reference names a view of the snapshot rather than a row —
   *  no link exists and none should be offered. */
  symbolic: boolean;
  /** True when the reference names a row that is no longer there. */
  missing: boolean;
}

const MAX_ENTITIES_PER_ITEM = 6;

function base(ref: EvidenceRef): ResolvedEvidence {
  return {
    kind: ref.kind,
    id: ref.id,
    note: ref.note ?? null,
    title: ref.note ?? `${ref.kind} ${ref.id}`,
    lines: [],
    at: null,
    href: null,
    entities: [],
    symbolic: false,
    missing: false,
  };
}

/** What the snapshot's symbolic handles were looking at. Descriptions rather
 *  than lookups, because there is no row to look up. */
const SYMBOLIC: Record<string, { title: string; line: string }> = {
  'trail:current': {
    title: 'Where you were at the time',
    line: 'The most recent position fix when the thought was formed, with its age. Positions are never carried in a page payload.',
  },
  'health:readiness': {
    title: 'Your readiness score',
    line: 'The Whoop recovery figure at the time, gated on there being real recovery data behind it rather than the default 50s.',
  },
  'health:sleep': {
    title: "Last night's sleep",
    line: 'Sleep performance and duration, compared against your own baseline rather than a population one.',
  },
  'health:workout': {
    title: 'Days since your last workout',
    line: 'Counted from the workout log, not inferred from movement.',
  },
  'calendar:today': {
    title: "Today's diary",
    line: 'What the calendar held for today and tomorrow, after any events you have chosen to ignore were removed.',
  },
  'calendar:week': {
    title: 'The week ahead',
    line: 'The next seven days of the diary, after your exclusions.',
  },
  'spend:total': {
    title: 'Evidenced spend, last 30 days',
    line: 'Receipts and bank rows only. It understates the real figure, because cash leaves no trace here.',
  },
};

/**
 * Resolve a thought's citations.
 *
 * Batched by kind — one query per source table rather than one per reference,
 * because a clustered mail thought can carry a dozen email refs and a card
 * that costs twelve round trips is a card nobody opens twice.
 */
export async function resolveEvidence(refs: EvidenceRef[]): Promise<ResolvedEvidence[]> {
  const out = refs.map(base);
  const idsOf = (kind: string) =>
    [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))].filter(Boolean);
  const fill = (kind: string, id: string, patch: Partial<ResolvedEvidence>) => {
    for (const r of out) if (r.kind === kind && r.id === id) Object.assign(r, patch);
  };

  // ── Symbolic handles first; they need no query at all ──
  for (const r of out) {
    const sym = SYMBOLIC[`${r.kind}:${r.id}`];
    if (sym) {
      r.title = sym.title;
      r.lines = [sym.line];
      r.symbolic = true;
    }
  }

  await Promise.all([
    resolveEmails(idsOf('email'), fill),
    resolvePlaces(idsOf('place'), fill),
    resolveSpend(idsOf('spend'), fill),
    resolveMemories(idsOf('memory'), fill),
    resolveMemoryThemes(idsOf('memory-theme'), fill),
    resolveHypotheses(idsOf('hypothesis'), fill),
    resolveInsights(idsOf('intel'), fill),
    resolveEntities(idsOf('intel-entity'), fill),
    resolveInterests(idsOf('interest'), fill),
    resolveFamily(idsOf('family'), fill),
  ]);

  // Anything left with no title beyond the fallback, and no note, is a
  // reference to a table this function does not know about. Saying "not
  // resolved" is better than rendering a uuid and calling it evidence.
  for (const r of out) {
    if (!r.symbolic && !r.missing && r.lines.length === 0 && !r.note) {
      r.lines = ['No detail stored for this reference.'];
    }
  }
  return out;
}

type Fill = (kind: string, id: string, patch: Partial<ResolvedEvidence>) => void;

async function resolveEmails(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      metadata: intelNotes.metadata,
      observedAt: intelNotes.observedAt,
      createdAt: intelNotes.createdAt,
      graphState: intelNotes.graphState,
    })
    .from(intelNotes)
    .where(inArray(intelNotes.id, ids));

  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!found.has(id)) fill('email', id, { missing: true, title: 'This email is no longer in the corpus', lines: ['It was cited when the thought was formed and has since been pruned.'] });

  // Graph entities per note, in one query for the whole batch.
  const links = rows.length
    ? await db
        .select({
          noteId: intelNoteEntities.noteId,
          entityId: intelEntities.id,
          name: intelEntities.name,
          type: intelEntityTypes.name,
        })
        .from(intelNoteEntities)
        .innerJoin(intelEntities, eq(intelEntities.id, intelNoteEntities.entityId))
        .leftJoin(intelEntityTypes, eq(intelEntityTypes.id, intelEntities.typeId))
        .where(
          and(
            inArray(intelNoteEntities.noteId, rows.map((r) => r.id)),
            sql`${intelEntities.mergedIntoId} is null`,
          ),
        )
    : [];

  const byNote = new Map<string, GraphEntity[]>();
  for (const l of links) {
    const list = byNote.get(l.noteId) ?? [];
    if (list.length < MAX_ENTITIES_PER_ITEM) {
      list.push({ id: l.entityId, name: l.name, type: l.type, href: `/jkai/intel/entities/${l.entityId}` });
    }
    byNote.set(l.noteId, list);
  }

  for (const r of rows) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const sender = typeof meta.senderDomain === 'string' ? meta.senderDomain : null;
    const kind = typeof meta.emailKind === 'string' ? meta.emailKind : null;
    const at = r.observedAt ?? r.createdAt;
    fill('email', r.id, {
      title: r.title ?? '(no subject)',
      lines: [
        sender ? `From ${sender}` : 'Sender not recorded',
        kind ? `Filed as ${kind}` : '',
        // Whether it reached the graph explains why entities may be absent.
        r.graphState ? `Graph: ${r.graphState}` : '',
      ].filter(Boolean),
      at: at?.toISOString() ?? null,
      href: `/jkai/intel/notes/${r.id}`,
      entities: byNote.get(r.id) ?? [],
    });
  }
}

async function resolvePlaces(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: daydreamPlaces.id,
      label: daydreamPlaces.label,
      suggestedLabel: daydreamPlaces.suggestedLabel,
      suggestedAddress: daydreamPlaces.suggestedAddress,
      kind: daydreamPlaces.kind,
      visitCount: daydreamPlaces.visitCount,
      medianDwellMins: daydreamPlaces.medianDwellMins,
      lastSeenAt: daydreamPlaces.lastSeenAt,
      status: daydreamPlaces.status,
    })
    .from(daydreamPlaces)
    .where(inArray(daydreamPlaces.id, ids));

  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!found.has(id)) fill('place', id, { missing: true, title: 'This place no longer exists', lines: ['Places are retired rather than deleted, so this is unusual.'] });

  for (const r of rows) {
    fill('place', r.id, {
      title: r.label ?? r.suggestedLabel ?? 'An unnamed place',
      lines: [
        r.label ? 'You named this' : r.suggestedLabel ? `Geocoder suggests "${r.suggestedLabel}" — not confirmed` : 'Never named',
        r.suggestedAddress ?? '',
        `${r.visitCount} household visits, median stay ${r.medianDwellMins} min`,
        `Kind: ${r.kind} · status: ${r.status}`,
      ].filter(Boolean),
      at: r.lastSeenAt?.toISOString() ?? null,
      // Coordinates are deliberately NOT here. The Places tab has an
      // owner-gated map action for that; a lat/lon must not ride a payload
      // just because a card wanted to be informative.
      href: `/jkai/daydreams/places`,
    });
  }
}

async function resolveSpend(ids: string[], fill: Fill): Promise<void> {
  const real = ids.filter((i) => i !== 'total');
  if (real.length === 0) return;
  const rows = await db
    .select({
      id: daydreamSpend.id,
      day: daydreamSpend.day,
      merchant: daydreamSpend.merchant,
      amountMinor: daydreamSpend.amountMinor,
      currency: daydreamSpend.currency,
      sourceNoteId: daydreamSpend.sourceNoteId,
      verified: daydreamSpend.verified,
    })
    .from(daydreamSpend)
    .where(inArray(daydreamSpend.id, real));

  const found = new Set(rows.map((r) => r.id));
  for (const id of real) if (!found.has(id)) fill('spend', id, { missing: true, title: 'This transaction is no longer stored' });

  for (const r of rows) {
    const source = r.sourceNoteId.startsWith('truelayer:')
      ? 'bank'
      : r.sourceNoteId.startsWith('paypal:')
        ? 'PayPal'
        : 'email receipt';
    fill('spend', r.id, {
      title: `£${(r.amountMinor / 100).toFixed(2)} to ${r.merchant}`,
      lines: [
        `${r.day} · from ${source}`,
        r.verified ? 'Verified at source — no model read this number' : 'Extracted, not verified',
        r.currency !== 'GBP' ? `Currency: ${r.currency}` : '',
      ].filter(Boolean),
      at: `${r.day}T12:00:00Z`,
      href: '/jkai/daydreams/money',
    });
  }
}

async function resolveMemories(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: jkaiMemories.id,
      category: jkaiMemories.category,
      content: jkaiMemories.content,
      confidence: jkaiMemories.confidence,
      createdAt: jkaiMemories.createdAt,
      supersededBy: jkaiMemories.supersededBy,
    })
    .from(jkaiMemories)
    .where(inArray(jkaiMemories.id, ids));

  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!found.has(id)) fill('memory', id, { missing: true, title: 'This memory has been forgotten' });

  for (const r of rows) {
    fill('memory', r.id, {
      title: r.content,
      lines: [
        `Category: ${r.category} · confidence ${r.confidence}`,
        // A superseded memory that is still being cited is worth seeing.
        r.supersededBy ? 'SUPERSEDED — a newer memory replaced this one' : '',
      ].filter(Boolean),
      at: r.createdAt.toISOString(),
      // The Memory room's source archive anchors every raw memory.
      href: `/jkai/daydreams/memory#memory-${r.id}`,
    });
  }
}

async function resolveMemoryThemes(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: daydreamMemoryThemes.id,
      kind: daydreamMemoryThemes.kind,
      title: daydreamMemoryThemes.title,
      statement: daydreamMemoryThemes.statement,
      guidance: daydreamMemoryThemes.guidance,
      confidence: daydreamMemoryThemes.confidence,
      sourceCount: daydreamMemoryThemes.sourceCount,
      status: daydreamMemoryThemes.status,
      updatedAt: daydreamMemoryThemes.updatedAt,
    })
    .from(daydreamMemoryThemes)
    .where(inArray(daydreamMemoryThemes.id, ids));

  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) {
      fill('memory-theme', id, {
        missing: true,
        title: 'This memory theme is no longer stored',
        lines: ['The thought cited it when it was formed, so its influence can no longer be inspected.'],
      });
    }
  }

  const sources = rows.length
    ? await db
        .select({
          themeId: daydreamMemoryThemeSources.themeId,
          content: jkaiMemories.content,
          category: jkaiMemories.category,
          supersededBy: jkaiMemories.supersededBy,
        })
        .from(daydreamMemoryThemeSources)
        .innerJoin(jkaiMemories, eq(jkaiMemories.id, daydreamMemoryThemeSources.memoryId))
        .where(inArray(daydreamMemoryThemeSources.themeId, rows.map((r) => r.id)))
    : [];
  const byTheme = new Map<string, typeof sources>();
  for (const source of sources) {
    byTheme.set(source.themeId, [...(byTheme.get(source.themeId) ?? []), source]);
  }

  for (const row of rows) {
    const sourceLines = (byTheme.get(row.id) ?? [])
      .slice(0, 5)
      .map((s) => `Source memory (${s.category}): ${s.content.slice(0, 240)}${s.supersededBy ? ' [later superseded]' : ''}`);
    fill('memory-theme', row.id, {
      title: `${row.kind === 'value' ? 'Value' : 'Lesson'}: ${row.title}`,
      lines: [
        row.statement,
        `How it shaped this: ${row.guidance}`,
        `Rolled up from ${row.sourceCount} raw ${row.sourceCount === 1 ? 'memory' : 'memories'} · ${row.confidence} confidence${row.status === 'active' ? '' : ` · ${row.status}`}`,
        ...sourceLines,
        row.sourceCount > sourceLines.length ? `${row.sourceCount - sourceLines.length} more source memories are shown on the Memory tab.` : '',
      ].filter(Boolean),
      at: row.updatedAt.toISOString(),
      href: `/jkai/daydreams/memory#memory-theme-${row.id}`,
    });
  }
}

async function resolveHypotheses(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: daydreamHypotheses.id,
      question: daydreamHypotheses.question,
      verdict: daydreamHypotheses.verdict,
      summary: daydreamHypotheses.summary,
      subject: daydreamHypotheses.subject,
      proposedAt: daydreamHypotheses.proposedAt,
    })
    .from(daydreamHypotheses)
    .where(inArray(daydreamHypotheses.id, ids));

  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!found.has(id)) fill('hypothesis', id, { missing: true, title: 'This question is no longer on the board' });

  for (const r of rows) {
    fill('hypothesis', r.id, {
      title: r.question,
      lines: [
        `Verdict: ${r.verdict ?? 'still open'}`,
        r.summary ?? '',
        `About: ${r.subject}`,
      ].filter(Boolean),
      at: r.proposedAt?.toISOString() ?? null,
      href: '/jkai/daydreams/discoveries',
    });
  }
}

async function resolveInsights(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: intelInsights.id,
      kind: intelInsights.kind,
      title: intelInsights.title,
      explanation: intelInsights.explanation,
      score: intelInsights.score,
      entityIds: intelInsights.entityIds,
      createdAt: intelInsights.createdAt,
    })
    .from(intelInsights)
    .where(inArray(intelInsights.id, ids));

  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!found.has(id)) fill('intel', id, { missing: true, title: 'This graph finding has been superseded' });

  const allEntityIds = [...new Set(rows.flatMap((r) => (r.entityIds ?? []).slice(0, MAX_ENTITIES_PER_ITEM)))];
  const named = await namedEntities(allEntityIds);

  for (const r of rows) {
    fill('intel', r.id, {
      title: r.title,
      lines: [r.explanation, `Graph finding (${r.kind}), scored ${r.score.toFixed(2)}`],
      at: r.createdAt.toISOString(),
      href: '/jkai/intel',
      entities: (r.entityIds ?? [])
        .slice(0, MAX_ENTITIES_PER_ITEM)
        .map((id) => named.get(id))
        .filter((e): e is GraphEntity => !!e),
    });
  }
}

async function resolveEntities(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  const named = await namedEntities(ids);
  for (const id of ids) {
    const e = named.get(id);
    if (!e) {
      fill('intel-entity', id, { missing: true, title: 'This entity has been merged or removed' });
      continue;
    }
    fill('intel-entity', id, {
      title: e.name,
      lines: [e.type ? `Type: ${e.type}` : 'Untyped'],
      href: e.href,
      entities: [e],
    });
  }
}

async function resolveInterests(ids: string[], fill: Fill): Promise<void> {
  if (ids.length === 0) return;
  // An interest ref points at whichever row produced the term — a research
  // session or an intel note. Only the note is resolvable here; a research
  // session gets its own line rather than a wrong link.
  const rows = await db
    .select({ id: intelNotes.id, title: intelNotes.title, source: intelNotes.source })
    .from(intelNotes)
    .where(inArray(intelNotes.id, ids));
  for (const r of rows) {
    fill('interest', r.id, {
      title: r.title ?? 'Something you were reading',
      lines: [`From a ${r.source} note`],
      href: `/jkai/intel/notes/${r.id}`,
    });
  }
  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (found.has(id)) continue;
    fill('interest', id, {
      lines: ['A research session — see the research surface for the full trail.'],
      href: '/research',
    });
  }
}

async function resolveFamily(subjects: string[], fill: Fill): Promise<void> {
  if (subjects.length === 0) return;
  for (const subject of subjects) {
    const [latest] = await db
      .select({ ts: daydreamTrail.ts, isHome: daydreamTrail.isHome })
      .from(daydreamTrail)
      .where(eq(daydreamTrail.subject, subject))
      .orderBy(desc(daydreamTrail.ts))
      .limit(1);
    fill('family', subject, {
      title: subject.charAt(0).toUpperCase() + subject.slice(1),
      lines: [
        latest
          ? `Last position fix ${latest.ts.toISOString().slice(0, 16).replace('T', ' ')}Z${latest.isHome === true ? ', at home' : latest.isHome === false ? ', out' : ''}`
          : 'No position fixes recorded',
      ],
      at: latest?.ts.toISOString() ?? null,
      href: '/jkai/daydreams/family',
      symbolic: true,
    });
  }
}

/** Batch entity lookup, skipping anything merged away. */
async function namedEntities(ids: string[]): Promise<Map<string, GraphEntity>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      type: intelEntityTypes.name,
      mergedIntoId: intelEntities.mergedIntoId,
    })
    .from(intelEntities)
    .leftJoin(intelEntityTypes, eq(intelEntityTypes.id, intelEntities.typeId))
    .where(inArray(intelEntities.id, ids));
  return new Map(
    rows
      .filter((r) => !r.mergedIntoId)
      .map((r) => [
        r.id,
        { id: r.id, name: r.name, type: r.type, href: `/jkai/intel/entities/${r.id}` } as GraphEntity,
      ]),
  );
}
