// src/lib/daydream/destination.ts
//
// Where a feed card goes when you click through.
//
// ── The gap this fills ─────────────────────────────────────────────────────
//
// Every card on the feed is a claim ABOUT something that has a home elsewhere
// in jkai — a place with a rhythm and a map, an entity in the graph, an email,
// a run of spend, a question on the discoveries board. Until now the only thing
// a card could do was expand in place and print its components, so answering
// "yes but what IS this place / who IS this / what were the other charges" meant
// leaving the page, finding the right tab, and searching for it again.
//
// So each kind of thought names its destination. Deliberately PURE and
// deliberately data: this is a lookup over the kind and the evidence refs the
// thought already carries, with no fetch, no DOM and no database. The page maps
// it to an anchor; the tests assert the mapping rather than a screenshot.
//
// ── The one rule ───────────────────────────────────────────────────────────
//
// A destination is only returned when it is actually REACHABLE. A thought whose
// evidence names an intel entity gets the entity's page; one that merely smells
// like the graph gets the graph's index, and one with nothing behind it gets
// null — the card then renders no link at all. An affordance that leads to a
// 404 or to a page with nothing on it is worse than no affordance, because the
// second time you meet it you stop trusting the first.

/** The minimum a destination resolver needs to know about a thought. */
export interface DestinationInput {
  kind: string;
  placeId?: string | null;
  placeLabel?: string | null;
  evidence?: Array<{ kind: string; id: string }> | null;
  intelNoteId?: string | null;
}

export interface Destination {
  /** Where to go. Same-origin, always. */
  href: string;
  /** What the link says. Names the THING, not the tab — "Costa Coffee", not
   *  "Places", because the reader already knows they are on the feed. */
  label: string;
  /** True when it leaves this hub. The page marks those, so a click that
   *  loses your place on a 3,000px board is never a surprise. */
  external: boolean;
}

/** First evidence ref of a given kind, if any. */
export function refOf(
  evidence: Array<{ kind: string; id: string }> | null | undefined,
  kind: string,
): string | null {
  const hit = (evidence ?? []).find((e) => e.kind === kind && typeof e.id === 'string' && e.id.trim());
  return hit ? hit.id : null;
}

/**
 * Which tab of this hub answers a thought of this kind.
 *
 * Kept as prefix matching rather than an exhaustive map: detectors are added
 * regularly and a new `spend_something` should land on Money without anyone
 * remembering to edit this file. Anything unmatched returns null rather than
 * a guess — see the rule above.
 */
export function tabFor(kind: string): { tab: string; label: string } | null {
  if (kind.startsWith('spend') || kind.startsWith('offer') || kind.startsWith('renewal')) {
    return { tab: 'money', label: 'the money it came from' };
  }
  if (kind.startsWith('free_window') || kind.startsWith('calendar') || kind.startsWith('plans')) {
    return { tab: 'calendar', label: 'the diary behind it' };
  }
  if (kind.startsWith('correlation') || kind.startsWith('hypothesis') || kind.startsWith('musing_')) {
    return { tab: 'discoveries', label: 'what it was testing' };
  }
  if (kind.startsWith('family') || kind.startsWith('context_meets')) {
    return { tab: 'family', label: 'the household view' };
  }
  if (kind.startsWith('pattern_break') || kind.startsWith('rule_')) {
    return { tab: 'engine', label: 'the rule that fired it' };
  }
  return null;
}

/**
 * The one page that answers this card.
 *
 * Order matters, and it is most-specific-first: a place with a name is a better
 * destination than the tab that lists places, and a named entity is a better
 * destination than the graph's index. The first match wins.
 */
export function thoughtDestination(t: DestinationInput): Destination | null {
  // A place. The strongest destination on the hub — it has a map, a rhythm and
  // a visit history, and several detectors are inert until it is named.
  if (t.placeId) {
    return {
      href: `/jkai/daydreams?tab=places#place-${t.placeId}`,
      label: t.placeLabel ? `${t.placeLabel} in Places` : 'this place in Places',
      external: false,
    };
  }

  // An entity the graph already knows. `intel-bridge` writes these refs on
  // every bridged insight, and the extractor writes them on anything woven.
  const entity = refOf(t.evidence, 'intel-entity');
  if (entity) {
    return { href: `/jkai/intel/entities/${entity}`, label: 'this entity in Intel', external: true };
  }

  // Something the owner endorsed, which has since been read into the graph.
  if (t.intelNoteId) {
    return { href: `/jkai/intel/notes/${t.intelNoteId}`, label: 'what Intel made of it', external: true };
  }

  // The email it was read out of. `email` is the ref kind `resolveEvidence`
  // uses and `mail_read` takes verbatim — the same id, not a search term.
  const email = refOf(t.evidence, 'email');
  if (email) {
    return { href: `/jkai/intel/notes/${email}`, label: 'the message it read', external: true };
  }

  const bridged = refOf(t.evidence, 'intel');
  if (bridged) {
    return { href: `/jkai/intel`, label: 'the graph finding behind it', external: true };
  }

  const tab = tabFor(t.kind);
  if (tab) {
    return { href: `/jkai/daydreams?tab=${tab.tab}`, label: tab.label, external: false };
  }

  return null;
}

/** Does this card get a map? Only a thought pinned to a real place cluster. */
export function hasMap(t: DestinationInput): boolean {
  return Boolean(t.placeId);
}
