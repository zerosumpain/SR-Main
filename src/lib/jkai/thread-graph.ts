// The knowledge graph beside a /jkai thread.
//
// Answers "what does this conversation know about, and what does that connect
// to?" from two sources, deliberately kept separate:
//
//  1. STRUCTURAL nodes — free, always present, derived from what the thread
//     demonstrably touched: the models that answered, the attachments it
//     carried, the /drive files it cited (@files), the canvases it built, the
//     research sessions it drew on. No LLM call, no latency, no spend.
//
//  2. CONCEPT nodes — the entities the intel pipeline extracted from the
//     thread's own text (auto-extract kind 'chat'). These are what make the
//     rail read like a graph rather than a file list, and they arrive on the
//     same extract → persist → embed path every other intel source uses, so a
//     concept surfaced here is the same row /jkai/intel already knows about.
//
// Edges are either real intel relationships (typed verbs — SUPERSEDES, CAUSES)
// between concept nodes, or co-occurrence between things that appeared in the
// same turn (MENTIONED WITH). Co-occurrence is labelled honestly rather than
// dressed up as a semantic relation.
//
// THIS HALF IS PURE — types and the maths, no `$lib/db`. The builder lives in
// `thread-graph.server.ts`. The split is not tidiness: the rail is a client
// component, and anything it can reach drags the WHOLE import graph into the
// browser bundle, so one runtime import from here used to pull in drizzle, `pg`
// and `$env/dynamic/private` and fail the build. The `.server` suffix is the
// guard — SvelteKit makes importing it from client code an error, which a naming
// convention cannot do. Same fix as entity-query/lenses (#34).


import { acronymsOf } from './intel/resolve/match';

export type ThreadNodeKind =
  | 'concept'
  | 'model'
  | 'artefact'
  | 'doc'
  | 'image'
  | 'run'
  | 'intel';

/**
 * Whether a node is knowledge the graph ALREADY held, or something this
 * conversation is the only witness to.
 *
 * Note that "does it have an embedding" is NOT the test — every intel entity is
 * embedded on write, so that flag is true for all of them and separates nothing.
 * The signal that actually discriminates is note provenance: an entity
 * referenced by some note other than this thread's own derived note existed
 * before this conversation (it came from a /drive file, a deep dive, or another
 * thread); one referenced only by this thread's note is a claim this chat made
 * and nothing has corroborated yet.
 */
export type NodeProvenance =
  /** Corroborated outside this conversation — already in the knowledge base. */
  | 'known'
  /** First seen here; this thread is its only source so far. */
  | 'new'
  /** Not a knowledge claim: a model, file, canvas or attachment the thread touched. */
  | 'thread';

export interface ThreadGraphNode {
  id: string;
  kind: ThreadNodeKind;
  /** Type label shown in the detail panel — `CONCEPT`, `FAILURE MODE`, `DOC`… */
  type: string;
  /** Full name. The rail shortens it for the chip and shows this in detail. */
  name: string;
  note: string | null;
  /** Deep link, when the node points at something with a page. */
  href: string | null;
  /** Drives the rail/modal colour — see NodeProvenance. */
  provenance: NodeProvenance;
  /** ISO timestamp of the turn this node was last seen in. */
  lastSeen: string | null;
  /** Index of the turn(s) this node appeared in — drives co-occurrence edges. */
  turns: number[];
  /**
   * How many messages in this thread actually talk about it.
   *
   * The rail ranks by this, and it is the one number on the topic list. Degree
   * cannot do that job: co-occurrence joins every node extracted from one turn
   * to every other, so a twelve-concept reply gives all twelve a degree of
   * eleven and the ranking says nothing. For structural nodes it is the number
   * of turns that carried them, which is the same claim.
   */
  mentions: number;
}

export interface ThreadGraphEdge {
  source: string;
  target: string;
  /** ER verb: `SUPERSEDES`, `CAUSES`, `MENTIONED WITH`… */
  verb: string;
  /** True for a real intel relationship rather than co-occurrence. */
  typed: boolean;
}

export interface ThreadGraph {
  /** Ranked: index 0 is what the thread talks about most. See rankAndTrim. */
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  /** True once the concept-extraction pass has produced a derived note. */
  conceptsReady: boolean;
  /** Whether this thread feeds /jkai/intel at all — the rail's toggle. */
  intelEnabled: boolean;
  /** Entities this thread has put into intel, BEFORE the twelve-node trim. It
   *  is what "forget what this thread added" would remove, so it has to count
   *  the record rather than the picture. */
  conceptTotal: number;
}

/** Verb used when two things merely showed up in the same turn. */
export const CO_OCCURRENCE_VERB = 'MENTIONED WITH';

/** A node the rail can plausibly draw. More than this and the 324px canvas
 *  turns to soup, so the least-ranked are dropped (see rankAndTrim). */
export const MAX_NODES = 12;

export function pushTurn(node: ThreadGraphNode, turn: number): void {
  if (!node.turns.includes(turn)) node.turns.push(turn);
}

/**
 * Which turn concept nodes attach to for co-occurrence.
 *
 * Concepts are thread-scoped — the extractor reads the whole transcript, not one
 * turn — but co-occurrence pairs nodes *within* a turn, so they still need one
 * to sit on. Using the last message index looks right and is wrong: the last
 * message is nearly always a user turn or a heartbeat note, and neither carries
 * a structural node. The concepts therefore formed a clique among themselves
 * while the model that produced them, and any file or canvas the thread cited,
 * sat unconnected on an earlier turn.
 *
 * Anchoring to the last turn that actually HAS structure fixes that without
 * inventing edges: the newest structural moment is the one "what is this thread
 * about" is really describing. Falls back to the last message when a thread has
 * no structural nodes at all, which preserves the old behaviour for the only
 * case where it was harmless.
 */
export function conceptAnchorTurn(
  structuralTurns: readonly number[],
  messageCount: number,
): number {
  if (structuralTurns.length === 0) return Math.max(0, messageCount - 1);
  return Math.max(...structuralTurns);
}

/** A fresh object each time — a shared literal hands every caller the same
 *  arrays to push into. */
export function emptyThreadGraph(): ThreadGraph {
  return { nodes: [], edges: [], conceptsReady: false, intelEnabled: true, conceptTotal: 0 };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * How many messages each node is actually talked about in.
 *
 * Messages, not raw occurrences: a fenced code block that repeats a name forty
 * times says no more about the thread's subject than a sentence that names it
 * once, and counting occurrences let one such block own the whole ranking.
 *
 * Concept nodes match on their name; structural nodes have nothing to match
 * against in the prose (a file is referenced through metadata, not by name), so
 * they take the number of turns that carried them, which is the same claim.
 */
export function countMentions(nodes: ThreadGraphNode[], contents: readonly string[]): void {
  const haystacks = contents.map((c) => c.toLowerCase());
  for (const node of nodes) {
    if (node.kind !== 'concept') {
      node.mentions = node.turns.length;
      continue;
    }
    const name = node.name.trim().toLowerCase();
    if (!name) {
      node.mentions = node.turns.length;
      continue;
    }
    /**
     * The name, plus the acronyms it resolves to.
     *
     * Without them a thread that says "DfE" throughout scores "Department for
     * Education (DfE)" at zero and buries the entity it is mostly about — which
     * is the exact failure the ranking exists to prevent. `acronymsOf` is the
     * resolver's, not a second copy: bare-acronym-vs-expansion is the case it
     * was written for, and two definitions of it would drift.
     *
     * Bounded 3–8 characters, as the mention index bounds it: two-letter
     * initials match far too much prose to mean anything.
     */
    const forms = [name];
    for (const a of acronymsOf(node.name)) {
      if (a.length >= 3 && a.length <= 8) forms.push(a.toLowerCase());
    }
    // Word boundaries, so "EES" does not match "fees" and a one-character
    // entity does not match every token in the thread.
    const re = new RegExp(
      `(?:^|[^a-z0-9])(?:${forms.map(escapeRe).join('|')})(?:[^a-z0-9]|$)`,
      'i',
    );
    node.mentions = haystacks.reduce((n, h) => (re.test(h) ? n + 1 : n), 0);
  }
}

/**
 * How many of the MAX_NODES slots structural nodes may hold.
 *
 * Concepts are what the rail is for, but a graph of pure concepts loses the
 * "this thread read file X / ran on model Y" reading entirely. Unused slots on
 * either side go to the other, so a thread with no concepts still fills up.
 */
const STRUCTURAL_SLOTS = 3;

/**
 * Rank every node and keep the top MAX_NODES, dropping edges that lose an
 * endpoint. Order matters beyond the trim: the rail draws node 0 in the centre
 * of the radial layout and lists the concepts in this order under it, so this
 * function decides what the thread is presented as being about.
 *
 * Ordering is [concepts first, then mentions, then typed degree, then name] —
 * NOT total degree, which the old version used. Co-occurrence makes every node
 * extracted from one turn adjacent to every other, so total degree gave all
 * twelve concepts of a single reply the identical score of eleven and the
 * "ranking" was really insertion order. Typed degree survives as a tiebreak
 * because an `intel_relationships` row is a real claim.
 */
export function rankAndTrim(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
  /** Node ceiling. `Infinity` ranks without trimming — the 3D entity map wants
   *  every concept the thread produced, in the same order the rail ranks them. */
  limit: number = MAX_NODES,
): { nodes: ThreadGraphNode[]; edges: ThreadGraphEdge[] } {
  const typedDegree = new Map<string, number>();
  for (const e of edges) {
    if (!e.typed) continue;
    typedDegree.set(e.source, (typedDegree.get(e.source) ?? 0) + 1);
    typedDegree.set(e.target, (typedDegree.get(e.target) ?? 0) + 1);
  }
  const byImportance = (a: ThreadGraphNode, b: ThreadGraphNode) =>
    b.mentions - a.mentions ||
    (typedDegree.get(b.id) ?? 0) - (typedDegree.get(a.id) ?? 0) ||
    a.name.localeCompare(b.name);

  const concepts = nodes.filter((n) => n.kind === 'concept').sort(byImportance);
  const structural = nodes.filter((n) => n.kind !== 'concept').sort(byImportance);

  if (!Number.isFinite(limit)) {
    return { nodes: [...concepts, ...structural], edges };
  }
  const structuralRoom = Math.min(
    structural.length,
    Math.max(STRUCTURAL_SLOTS, limit - concepts.length),
  );
  const kept = [
    ...concepts.slice(0, limit - structuralRoom),
    ...structural.slice(0, structuralRoom),
  ];
  const keptIds = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
  };
}
