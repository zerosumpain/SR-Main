// src/lib/canvas/intelligence/desk/grouping.ts
//
// Pure multi-dimension grouping for the Research Desk's "synthesize" pile view.
//
// groupBy(dim, cards, edges, mentions, similarityMap) maps every card to a
// group KEY (memberOf) and returns the ordered set of non-empty groups
// (groups[], descending count then key for stable left→right pile placement).
//
// All six GroupDim axes are pure functions of their inputs:
//   cluster      — card.deskCategory (synthesis cluster id)
//   theme        — themeOf() (KIND/type)        [reuses ./themes]
//   entityType   — entities by fields.type; non-entities bucketed separately
//   sentiment    — facts/entities bucketed by the sentiment of relationships
//                  they participate in (relationships carry the only sentiment)
//   cooccurrence — entities/facts sharing ≥1 factId via entityMentions
//   similarity   — factId→clusterId from the server clusters endpoint (passed in)
//
// No global mutable state, no Date/Math.random — deterministic for reloads.

import { themeOf, THEMES, type ThemeArtefact } from './themes';

/** The six grouping axes the floating filter selector offers. */
export type GroupDim =
  | 'cluster'
  | 'theme'
  | 'entityType'
  | 'sentiment'
  | 'cooccurrence'
  | 'similarity';

/** Minimal card slice grouping consumes — a structural subset of DeskCard. */
export interface GroupCard {
  id: string;
  kind: string; // 'source' | 'fact' | 'entity'
  fields?: Record<string, unknown>;
  deskCategory?: string | null;
}

/** Minimal edge slice — a structural subset of DeskEdge. */
export interface GroupEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  sentiment?: string | null;
}

/** An entity↔fact mention (added to /data for co-occurrence). */
export interface EntityMention {
  entityId: string;
  factId: string;
}

/** One pile/group header descriptor. */
export interface Group {
  key: string;
  label: string;
  count: number;
}

/** Result of grouping: card id → group key, plus ordered non-empty groups. */
export interface GroupResult {
  memberOf: Map<string, string>;
  groups: Group[];
}

// ——— shared stable keys/labels ———

/** Group key for cards with no deskCategory. */
export const UNCATEGORISED_KEY = '__uncategorised__';
/** Group key for non-entity cards under the entityType axis. */
export const NON_ENTITY_KEY = '__non_entity__';
/** Group key for an entity with a missing/blank type. */
export const ENTITY_OTHER_KEY = '__entity_other__';
/** Group key for a card not touched by any relationship (sentiment axis). */
export const NO_SENTIMENT_KEY = '__no_sentiment__';
/** Group key for a card in no co-occurrence component (cooccurrence axis). */
export const ISOLATED_KEY = '__isolated__';
/** Group key for a fact absent from the similarity map. */
export const SIM_UNCLUSTERED_KEY = '__unclustered__';

const THEME_LABEL = new Map(THEMES.map((t) => [t.key as string, t.label]));

/** Normalise an entity `type` to a stable lowercase key; '' → ENTITY_OTHER_KEY. */
function entityTypeKey(type: unknown): string {
  const t = typeof type === 'string' ? type.toLowerCase().trim() : '';
  return t.length === 0 ? ENTITY_OTHER_KEY : t;
}

/** Title-case a raw key for display (e.g. 'organisation' → 'Organisation'). */
function titleCase(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Assemble the ordered groups[] from a memberOf map and a per-key label
 * resolver. Groups are ordered by DESCENDING count, then ASCENDING key, so the
 * order is total and deterministic (the pile packer reads it left→right).
 */
function buildGroups(
  memberOf: Map<string, string>,
  labelOf: (key: string) => string,
): Group[] {
  const counts = new Map<string, number>();
  for (const key of memberOf.values()) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups: Group[] = [];
  for (const [key, count] of counts) {
    groups.push({ key, label: labelOf(key), count });
  }
  groups.sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return groups;
}

// ——— per-dimension memberOf builders ———

function groupByCluster(cards: GroupCard[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const cat = c.deskCategory;
    memberOf.set(c.id, cat != null && cat.length > 0 ? cat : UNCATEGORISED_KEY);
  }
  const groups = buildGroups(memberOf, (key) =>
    key === UNCATEGORISED_KEY ? 'Uncategorised' : key,
  );
  return { memberOf, groups };
}

function groupByTheme(cards: GroupCard[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const artefact: ThemeArtefact = { id: c.id, kind: c.kind, fields: c.fields };
    memberOf.set(c.id, themeOf(artefact));
  }
  const groups = buildGroups(memberOf, (key) => THEME_LABEL.get(key) ?? titleCase(key));
  return { memberOf, groups };
}

function groupByEntityType(cards: GroupCard[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) {
    if (c.kind === 'entity') {
      memberOf.set(c.id, entityTypeKey(c.fields?.type));
    } else {
      memberOf.set(c.id, NON_ENTITY_KEY);
    }
  }
  const groups = buildGroups(memberOf, (key) =>
    key === NON_ENTITY_KEY
      ? 'Other artefacts'
      : key === ENTITY_OTHER_KEY
        ? 'Other entities'
        : titleCase(key),
  );
  return { memberOf, groups };
}

/**
 * Group cards along one of six dimensions.
 *
 * Every card receives a group key (memberOf covers all input ids); groups[]
 * lists the non-empty groups in descending-count, then ascending-key order.
 * Pure + deterministic.
 */
export function groupBy(
  dim: GroupDim,
  cards: GroupCard[],
  edges: GroupEdge[],
  mentions: EntityMention[],
  similarityMap: Map<string, string>,
): GroupResult {
  switch (dim) {
    case 'cluster':
      return groupByCluster(cards);
    case 'theme':
      return groupByTheme(cards);
    case 'entityType':
      return groupByEntityType(cards);
    case 'sentiment':
      return groupBySentiment(cards, edges);
    case 'cooccurrence':
      return groupByCooccurrence(cards, mentions);
    case 'similarity':
      return groupBySimilarity(cards, similarityMap);
    default: {
      // Exhaustiveness guard — every GroupDim must be handled above.
      const _never: never = dim;
      return { memberOf: new Map(), groups: [] };
    }
  }
}

// ——— sentiment ———
//
// Relationships carry the only sentiment we store (per entity-pair). A card is
// bucketed by the sentiment(s) of the relationships it participates in:
//   - an ENTITY participates via from/toEntityId
//   - a card touched by relationships of ONE sentiment → that sentiment bucket
//   - a card touched by relationships of DIFFERING sentiments → "mixed"
//   - a card touched by NO relationship → NO_SENTIMENT_KEY
// null/blank relationship sentiment is normalised to "neutral".

const SENTIMENT_PREFIX = 'sentiment:';
const MIXED_SENTIMENT = `${SENTIMENT_PREFIX}mixed`;

function normaliseSentiment(s: unknown): string {
  const v = typeof s === 'string' ? s.toLowerCase().trim() : '';
  return v.length === 0 ? 'neutral' : v;
}

function groupBySentiment(cards: GroupCard[], edges: GroupEdge[]): GroupResult {
  // Collect the set of distinct sentiments each card id participates in.
  const seen = new Map<string, Set<string>>();
  const note = (id: string, sentiment: string) => {
    let s = seen.get(id);
    if (!s) {
      s = new Set<string>();
      seen.set(id, s);
    }
    s.add(sentiment);
  };
  for (const e of edges) {
    const sentiment = normaliseSentiment(e.sentiment);
    note(e.fromEntityId, sentiment);
    note(e.toEntityId, sentiment);
  }

  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const s = seen.get(c.id);
    if (!s || s.size === 0) {
      memberOf.set(c.id, NO_SENTIMENT_KEY);
    } else if (s.size === 1) {
      memberOf.set(c.id, SENTIMENT_PREFIX + [...s][0]);
    } else {
      memberOf.set(c.id, MIXED_SENTIMENT);
    }
  }

  const groups = buildGroups(memberOf, (key) => {
    if (key === NO_SENTIMENT_KEY) return 'No sentiment';
    if (key === MIXED_SENTIMENT) return 'Mixed sentiment';
    return titleCase(key.slice(SENTIMENT_PREFIX.length)) + ' (relationship)';
  });
  return { memberOf, groups };
}

// ——— cooccurrence ———
//
// Bipartite graph: entityMentions link an entity to a fact. Entities/facts that
// are connected (transitively, through shared facts/entities) form one
// co-occurrence component. Only ids that are LOADED as cards participate; a
// mention to an absent id is ignored. A card in no component (or whose only
// links are to absent ids) → ISOLATED_KEY. Each component's group key is the
// lexicographically-smallest member id, so the key is order-independent.

class UnionFind {
  private parent = new Map<string, string>();
  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Attach the lexicographically-larger root under the smaller, so find()
    // converges toward the smallest id (deterministic component keys).
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

function groupByCooccurrence(cards: GroupCard[], mentions: EntityMention[]): GroupResult {
  const present = new Set(cards.map((c) => c.id));
  const uf = new UnionFind();
  // Only union pairs where BOTH ids are loaded cards.
  const touched = new Set<string>();
  for (const m of mentions) {
    if (!present.has(m.entityId) || !present.has(m.factId)) continue;
    uf.add(m.entityId);
    uf.add(m.factId);
    uf.union(m.entityId, m.factId);
    touched.add(m.entityId);
    touched.add(m.factId);
  }

  // Resolve component roots; the root IS the smallest id by union policy.
  const rootOf = new Map<string, string>();
  for (const id of touched) rootOf.set(id, uf.find(id));

  // A singleton (touched only via absent partners) is effectively isolated.
  const componentSize = new Map<string, number>();
  for (const root of rootOf.values()) {
    componentSize.set(root, (componentSize.get(root) ?? 0) + 1);
  }

  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const root = rootOf.get(c.id);
    if (root !== undefined && (componentSize.get(root) ?? 0) > 1) {
      memberOf.set(c.id, root);
    } else {
      memberOf.set(c.id, ISOLATED_KEY);
    }
  }

  const groups = buildGroups(memberOf, (key) =>
    key === ISOLATED_KEY ? 'Isolated' : `Cluster ${key}`,
  );
  return { memberOf, groups };
}

// ——— TEMPORARY STUBS (replaced in Task 4) ———
function groupBySimilarity(cards: GroupCard[], _sim: Map<string, string>): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) memberOf.set(c.id, SIM_UNCLUSTERED_KEY);
  return { memberOf, groups: buildGroups(memberOf, () => 'Unclustered') };
}
