// Duplicate-entity detection.
//
// The graph's worst quality problem is the same thing recorded twice. In
// production "IBCA" (119 connections) and "Infected Blood Compensation
// Authority (IBCA)" (12 connections) are the same organisation, and because
// they are two nodes, every measure derived from the graph is wrong: degree is
// split, the pair tops the missing-link predictor, and paths that should run
// through one organisation dead-end at the other.
//
// Extraction alone cannot fix this. The extractor sees one note at a time and
// is offered candidates by vector similarity, which is exactly the case where a
// bare acronym and its expansion look unalike. So resolution is a separate pass
// over the whole graph with signals the extractor never had.
//
// Pure functions only — no DB, so every rule is unit-testable. The merge itself
// lives in ./merge.ts.

/** Words that carry no identity and should not drive a name match. */
const NOISE_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'ltd', 'limited', 'plc', 'inc', 'llc', 'group', 'team',
]);

/** Lowercase, strip punctuation and possessives, collapse whitespace. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    // Possessives, in every apostrophe the wild produces: "IBCA's" → "ibca".
    // Must run before punctuation stripping, or the apostrophe becomes a space
    // and leaves a stray "s" token behind.
    .replace(/['‘’ʼ`]s\b/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Significant tokens of a name, noise words removed. */
export function significantTokens(name: string): string[] {
  return normaliseName(name)
    .split(' ')
    .filter((t) => t && !NOISE_WORDS.has(t));
}

/**
 * Acronyms a name could be known by:
 *   - anything in parentheses that looks like an acronym
 *   - the initials of its significant words
 * "Infected Blood Compensation Authority (IBCA)" yields both "ibca" (explicit)
 * and "ibca" (initials) — which is exactly why it resolves.
 */
export function acronymsOf(name: string): Set<string> {
  const out = new Set<string>();

  for (const m of name.matchAll(/\(([^)]{2,12})\)/g)) {
    const inner = m[1].trim();
    if (/^[A-Za-z][A-Za-z.&-]*$/.test(inner) && inner.replace(/[^A-Za-z]/g, '').length >= 2) {
      out.add(inner.replace(/[^A-Za-z]/g, '').toLowerCase());
    }
  }

  // Initials of the name with any parenthetical removed.
  const bare = name.replace(/\([^)]*\)/g, ' ');
  const tokens = significantTokens(bare);
  if (tokens.length >= 2 && tokens.length <= 8) {
    out.add(tokens.map((t) => t[0]).join(''));
  }

  return out;
}

/** True when `candidate` is a plausible acronym form of `full` (or vice versa). */
export function isAcronymPair(a: string, b: string): boolean {
  const na = normaliseName(a).replace(/\s/g, '');
  const nb = normaliseName(b).replace(/\s/g, '');
  if (!na || !nb || na === nb) return false;

  // An acronym is short and has no spaces; the expansion is multi-word.
  const shortSide = na.length <= nb.length ? na : nb;
  const longName = na.length <= nb.length ? b : a;
  if (shortSide.length < 2 || shortSide.length > 12) return false;
  if (significantTokens(longName).length < 2) return false;

  return acronymsOf(longName).has(shortSide);
}

/** Jaccard overlap of the two names' significant tokens. */
export function tokenOverlap(a: string, b: string): number {
  const sa = new Set(significantTokens(a));
  const sb = new Set(significantTokens(b));
  if (!sa.size || !sb.size) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  return shared / (sa.size + sb.size - shared);
}

/** True when one name's tokens are a subset of the other's, e.g. "AI Playbook" ⊂ "IBCA AI Playbook". */
export function isTokenSubset(a: string, b: string): boolean {
  const sa = significantTokens(a);
  const sb = significantTokens(b);
  if (!sa.length || !sb.length || sa.length === sb.length) return false;
  const [small, large] = sa.length < sb.length ? [sa, new Set(sb)] : [sb, new Set(sa)];
  // A single-token subset is too weak — "Strategy" ⊂ "Data Strategy" is not
  // evidence they are the same thing.
  if (small.length < 2) return false;
  return small.every((t) => large.has(t));
}

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

/**
 * Noise for CANONICAL comparison, which is stricter than NOISE_WORDS.
 *
 * `group` and `team` are absent on purpose. They are noise when weighing how
 * much two names overlap, and identity-bearing when asking whether two names
 * are the same thing: "Security" and "Security Team" are a concept and an
 * organisation, and canonical equality auto-merges, so it must not fire there.
 */
const CANONICAL_NOISE = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'ltd', 'limited', 'plc', 'inc', 'llc', 'llp', 'gmbh', 'bv', 'nv', 'ag', 'co',
]);

/**
 * Extensions a name carries when it arrived as a FILE rather than a title.
 *
 * A closed list rather than "anything after the last dot", because that rule
 * turns "Node.js" into "node" and every version string into a truncation.
 */
const FILE_EXTENSIONS = new Set([
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'csv', 'tsv', 'txt', 'rtf',
  'md', 'json', 'yaml', 'yml', 'sql', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'py', 'sh',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'zip',
]);

/**
 * Strip a namespace prefix: `z-ai/glm-5-turbo`, `zerosumpain/SR-Main`,
 * `canvas:morning-briefing`.
 *
 * Two conditions, both learned from names this got wrong:
 *
 *   - the WHOLE name carries no whitespace. "M62/A1 corridor" is two roads and
 *     a noun, not a namespace and a name, and stripping it merged the entity
 *     into "A1 corridor". "Church Lane / Preston Park area" is the same shape.
 *   - what remains is slug-shaped (contains `-` or `_`). "Web/Dashboard" has no
 *     whitespace either, and "Dashboard" is not a slug — it is the second half
 *     of a phrase.
 *
 * The cost is recall: `Z.AI/zai provider` no longer unwraps, because its
 * remainder is prose. Precision is the priority — this signal auto-merges.
 */
function stripNamespace(name: string): string {
  const trimmed = name.trim();
  if (/\s/.test(trimmed)) return name;
  const m = /^([\p{L}\p{N}._-]+)[/:](.+)$/u.exec(trimmed);
  if (!m) return name;
  const rest = m[2].trim();
  if (!rest || rest.startsWith('/')) return name;
  if (!/[-_]/.test(rest)) return name;
  return rest;
}

/** Strip a known file extension, provided something nameable is left. */
function stripFileExtension(name: string): string {
  const m = /^(.*)\.([\p{L}\p{N}]{1,5})$/u.exec(name.trim());
  if (!m) return name;
  if (!FILE_EXTENSIONS.has(m[2].toLowerCase())) return name;
  // "Node.js" would otherwise become "Node" and match a concept of that name.
  // A real filename has more than one word left once the extension goes.
  const base = m[1].trim();
  return significantTokens(base).length >= 2 ? base : name;
}

/**
 * The form of a name to test for EQUALITY, once the packaging is removed.
 *
 * Names reach the graph wearing three kinds of packaging that say nothing about
 * identity: a file extension (`…Data Strategy.docx`), a namespace prefix
 * (`z-ai/glm-5-turbo`), and a legal suffix (`Google LLC`). `normaliseName`
 * already handles case and separators, so `sr-design-system` and
 * `SR design system` meet without help — these three do not.
 *
 * Word ORDER is preserved. Sorting would make "Data Strategy" and "Strategy
 * Data" equal, and nothing in the corpus needs that; person-name reordering is
 * `isNameReordering`'s job and is gated to people.
 */
export function canonicalName(name: string): string {
  const stripped = stripFileExtension(stripNamespace(name));
  return normaliseName(stripped)
    .split(' ')
    .filter((t) => t && !CANONICAL_NOISE.has(t))
    .join(' ');
}

/** True when two names are the same once packaging is removed. */
export function isCanonicalMatch(a: string, b: string): boolean {
  // Identical names are `identical_name`'s business; this rule is for the ones
  // that only meet after unwrapping.
  if (normaliseName(a) === normaliseName(b)) return false;
  const ca = canonicalName(a);
  return Boolean(ca) && ca === canonicalName(b);
}

// ---------------------------------------------------------------------------
// Person names
// ---------------------------------------------------------------------------

/**
 * Titles and suffixes that are not part of anybody's identity. Stripped before
 * person-name comparison so "Dr Jane Okafor" and "Jane Okafor" meet.
 */
const NAME_AFFIXES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'professor', 'sir', 'dame', 'lord', 'lady',
  'rt', 'hon', 'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'obe', 'mbe', 'cbe',
]);

/** Person-name tokens: normalised, affixes removed. */
export function personTokens(name: string): string[] {
  return normaliseName(name)
    .split(' ')
    .filter((t) => t && !NAME_AFFIXES.has(t));
}

/**
 * True when two person names differ only by initials — "J Kelly" vs "John
 * Kelly", "John R Kelly" vs "John Kelly".
 *
 * Requires the FAMILY name (last token) to match exactly and at least one
 * initial to line up. Without the family-name anchor this would marry every
 * "J" in the graph to every "John".
 */
export function isInitialExpansion(a: string, b: string): boolean {
  const ta = personTokens(a);
  const tb = personTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;

  const familyA = ta[ta.length - 1];
  const familyB = tb[tb.length - 1];
  if (familyA !== familyB) return false;

  const givenA = ta.slice(0, -1);
  const givenB = tb.slice(0, -1);
  if (!givenA.length || !givenB.length) return false;
  // Identical given names are `identical_name`'s business, not this rule's.
  if (givenA.join(' ') === givenB.join(' ')) return false;

  // Walk the shorter given-name list; every one of its parts must either match
  // outright or be the initial of the corresponding part on the other side.
  const [short, long] = givenA.length <= givenB.length ? [givenA, givenB] : [givenB, givenA];
  for (let i = 0; i < short.length; i++) {
    const s = short[i];
    const l = long[i];
    if (!l) return false;
    if (s === l) continue;
    if (s.length === 1 && l.startsWith(s)) continue;
    if (l.length === 1 && s.startsWith(l)) continue;
    return false;
  }
  return true;
}

/**
 * True when two person names are the same words in a different order —
 * "Kelly, John" (which arrives from address headers) vs "John Kelly".
 *
 * Requires at least two tokens on each side and the same multiset, so it cannot
 * fire on a partial name.
 */
export function isNameReordering(a: string, b: string): boolean {
  const ta = personTokens(a);
  const tb = personTokens(b);
  if (ta.length < 2 || tb.length !== ta.length) return false;
  const sortedA = [...ta].sort().join(' ');
  const sortedB = [...tb].sort().join(' ');
  if (sortedA !== sortedB) return false;
  // Same order is `identical_name`; this rule is only about reordering.
  return ta.join(' ') !== tb.join(' ');
}

/**
 * The email address recorded on an entity, lowercased.
 *
 * Gmail's structural pass writes `properties.email` on every person it creates,
 * which makes this the highest-precision identity key in the whole graph — and
 * until now nothing in the matcher read it.
 */
export function emailOf(
  entity: ResolvableEntity,
  sharedSenders?: ReadonlySet<string>,
): string | null {
  const raw = entity.properties?.email;
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email.includes('@')) return null;
  // An address that sends on behalf of many different people is a CHANNEL, not
  // an identity. See findSharedSenderAddresses.
  return sharedSenders?.has(email) ? null : email;
}

// ---------------------------------------------------------------------------
// Shared sender addresses
// ---------------------------------------------------------------------------

/**
 * Squashed to letters and digits, so "John Kelly", "john.kelly" and
 * "JohnKelly" all reduce to the same string.
 */
function squashName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when two display names plausibly belong to the SAME person — the same
 * name written differently, rather than two different people.
 *
 * Deliberately generous: this decides whether a set of names is EVIDENCE of a
 * shared mailbox, so over-grouping merely leaves an address trusted, while
 * under-grouping would strip the address signal from a real person who happens
 * to appear under a couple of spellings.
 */
export function isNameVariant(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (normaliseName(a) === normaliseName(b)) return true;

  const tokensA = new Set(significantTokens(a));
  for (const t of significantTokens(b)) if (tokensA.has(t)) return true;

  // "johnkellymain" vs "Johnkelly Main" share no token — one is the other with
  // the spaces taken out, which is what mail clients do to addresses.
  const sa = squashName(a);
  const sb = squashName(b);
  if (sa.length >= 6 && sb.length >= 6 && (sa.includes(sb) || sb.includes(sa))) return true;

  return isInitialExpansion(a, b) || isNameReordering(a, b);
}

/** How many distinct people the display names under one address suggest. */
export function countNameGroups(names: Iterable<string>): number {
  const list = [...new Set([...names].map((n) => n.trim()).filter(Boolean))];
  if (list.length < 2) return list.length;

  // Union-find over "is a variant of", so "J Kelly", "John Kelly" and
  // "johnkelly" collapse to one group however they pair up.
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (isNameVariant(list[i], list[j])) parent[find(i)] = find(j);
    }
  }
  return new Set(list.map((_, i) => find(i))).size;
}

/**
 * The number of unrelated identities an address must appear under before it
 * stops counting as one.
 *
 * Three, from the production distribution: the owner's own address carried ten
 * display names that collapse to TWO groups (their own aliases), while
 * `invitations@linkedin.com` carried thirty-eight names in TWENTY-FIVE groups.
 * Two would have punished the owner for having aliases; three separates a
 * person with spelling variants from a mailbox that writes as everybody.
 */
export const SHARED_SENDER_MIN_GROUPS = 3;

/**
 * Addresses that behave like a SENDER rather than a person.
 *
 * An email address is normally the strongest identity evidence there is, which
 * is why `same_email` outranks every name rule. That reasoning holds for a
 * personal mailbox and fails completely for a notification service:
 * `invitations@linkedin.com` appears in the From line of every invitation
 * LinkedIn has ever sent, whoever it is about. Trusting it fused forty-one
 * unrelated people into one entity in production.
 *
 * Detected from the data rather than from a list of known offenders, so the
 * next `notifications@some-service.io` is caught the first time it misbehaves
 * and nothing has to be maintained.
 *
 * IMPORTANT: feed this every name ever recorded against an address, INCLUDING
 * entities already merged away. Counting only survivors destroys the evidence
 * one merge at a time — two names merge to one, the third arrives and again
 * sees only two, and the count never reaches the threshold that would have
 * stopped it.
 */
export function findSharedSenderAddresses(
  namesByAddress: Map<string, Iterable<string>>,
  opts: { minGroups?: number } = {},
): Set<string> {
  const minGroups = opts.minGroups ?? SHARED_SENDER_MIN_GROUPS;
  const shared = new Set<string>();
  for (const [address, names] of namesByAddress) {
    const email = address.trim().toLowerCase();
    if (!email.includes('@')) continue;
    if (countNameGroups(names) >= minGroups) shared.add(email);
  }
  return shared;
}

export type MatchSignal =
  | 'identical_name'
  | 'same_email'
  | 'canonical_name'
  | 'acronym'
  | 'token_subset'
  | 'high_token_overlap'
  | 'initial_expansion'
  | 'name_reordering'
  | 'semantic';

export interface MatchCandidate {
  aId: string;
  bId: string;
  /** 0..1 — how confident we are these are the same entity. */
  confidence: number;
  signals: MatchSignal[];
  reason: string;
}

export interface ResolvableEntity {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
  degree: number;
  noteCount: number;
  embedding?: number[] | null;
  /** `intel_entities.properties`. Carries `email` for anyone Gmail created. */
  properties?: Record<string, unknown> | null;
}

/**
 * True when both sides are people, so the person-name rules may fire.
 *
 * Gated because those rules are wrong for organisations: "Kelly, John" logic
 * applied to "Systems, Acme" or initials applied to "B Corp" vs "Bravo Corp"
 * would merge unrelated bodies. A missing type on either side means "not
 * proven", and the rules stay off.
 */
function isPersonPair(a: ResolvableEntity, b: ResolvableEntity): boolean {
  const pa = (a.typeName || '').toLowerCase();
  const pb = (b.typeName || '').toLowerCase();
  return pa === 'person' && pb === 'person';
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Score one pair. Returns null when there is no case to answer.
 *
 * Names alone decide it when they are identical or one is the other's acronym.
 * Weaker name evidence (subset, high overlap) must be corroborated by embedding
 * similarity before it reaches the auto-merge threshold — otherwise "IBCA Data
 * Strategy" and "IBCA AI Strategy" would collapse into one.
 */
export function scorePair(
  a: ResolvableEntity,
  b: ResolvableEntity,
  opts: { sharedSenders?: ReadonlySet<string> } = {},
): MatchCandidate | null {
  if (a.id === b.id) return null;

  const signals: MatchSignal[] = [];
  let confidence = 0;

  const na = normaliseName(a.name);
  const nb = normaliseName(b.name);

  // An exact email match settles it. Two entities carrying the same address are
  // the same person — that is what an address IS — so this outranks every name
  // rule below and is scored above the auto-merge threshold on its own. It is
  // also the one signal a display-name comparison can never reach: "J. Kelly"
  // and "John Kelly (IBCA)" look unalike and are provably one person.
  const emailA = emailOf(a, opts.sharedSenders);
  const emailB = emailOf(b, opts.sharedSenders);
  const sameEmail = Boolean(emailA && emailB && emailA === emailB);

  if (sameEmail) {
    signals.push('same_email');
    confidence = 0.98;
  } else if (na && na === nb) {
    signals.push('identical_name');
    confidence = 0.97;
  } else if (isCanonicalMatch(a.name, b.name)) {
    // Same name in different packaging — a filename, a slug with its namespace,
    // a company with its legal suffix. Scored just below identical, because the
    // packaging is the only thing that differed.
    signals.push('canonical_name');
    confidence = 0.93;
  } else if (isAcronymPair(a.name, b.name)) {
    signals.push('acronym');
    confidence = 0.9;
  } else if (isPersonPair(a, b) && isNameReordering(a.name, b.name)) {
    // "Kelly, John" vs "John Kelly" — the same name, and address headers
    // produce the reversed form constantly.
    signals.push('name_reordering');
    confidence = 0.93;
  } else if (isPersonPair(a, b) && isInitialExpansion(a.name, b.name)) {
    signals.push('initial_expansion');
    confidence = 0.7;
  } else if (isTokenSubset(a.name, b.name)) {
    signals.push('token_subset');
    confidence = 0.55;
  } else {
    const overlap = tokenOverlap(a.name, b.name);
    if (overlap >= 0.7) {
      signals.push('high_token_overlap');
      confidence = 0.5 + (overlap - 0.7) * 0.8;
    }
  }

  // Two DIFFERENT addresses on two entities is positive evidence they are not
  // the same person, and it is strong enough to overrule a name similarity —
  // two real people do share a name. Not applied when only one side has an
  // address, which says nothing.
  const conflictingEmail = Boolean(emailA && emailB && emailA !== emailB);

  if (conflictingEmail) {
    // Held below the auto-merge threshold rather than dropped: it may still be
    // one person with two addresses, but that is a decision for a human.
    confidence = Math.min(confidence * 0.4, 0.5);
  }

  // Semantic corroboration, when both sides have an embedding.
  let similarity: number | null = null;
  if (a.embedding && b.embedding) {
    similarity = cosine(a.embedding, b.embedding);
    if (similarity >= 0.9 && signals.length) {
      signals.push('semantic');
      confidence = Math.min(0.95, confidence + 0.2);
    } else if (similarity >= 0.94 && !signals.length) {
      // Near-identical meaning with unlike names — worth review, never automatic.
      signals.push('semantic');
      confidence = 0.45;
    } else if (similarity < 0.55 && signals.length && confidence < 0.9) {
      // Names look alike but the entities mean different things. Back off.
      confidence *= 0.5;
    }
  }

  if (!signals.length || confidence < 0.35) return null;

  // A type mismatch is a real objection: a person and an organisation sharing a
  // name are usually two different things. An exact email match is exempt —
  // there the disagreement is about the TYPE, not the identity, and penalising
  // it would leave a provable duplicate sitting in the review queue forever.
  //
  // Canonical equality is exempt for the same reason, and `upsertEntity` has
  // always taken that view at write time: one name is one thing, and a
  // disagreement about its type is a typing question rather than grounds for a
  // second node. Without the exemption, `canvas:broads-speed-reporter-2` and
  // `broads-speed-reporter-2` stay apart forever because the extractor called
  // one a project and the other a process step.
  const exemptFromTypePenalty = sameEmail || signals.includes('canonical_name');
  if (a.typeId !== b.typeId && !exemptFromTypePenalty) confidence *= 0.7;

  if (confidence < 0.35) return null;

  const reason = describeSignals(a, b, signals, similarity);
  // Order is stable so the same pair always produces the same candidate id.
  const [x, y] = a.id < b.id ? [a, b] : [b, a];
  return { aId: x.id, bId: y.id, confidence: Math.min(1, confidence), signals, reason };
}

function describeSignals(
  a: ResolvableEntity,
  b: ResolvableEntity,
  signals: MatchSignal[],
  similarity: number | null,
): string {
  const parts: string[] = [];
  if (signals.includes('same_email')) parts.push(`both use ${emailOf(a) ?? 'the same address'}`);
  if (signals.includes('identical_name')) parts.push('identical names');
  if (signals.includes('canonical_name')) parts.push(`the same name once "${shorter(a, b).name}" is unwrapped`);
  if (signals.includes('name_reordering')) parts.push('the same name in a different order');
  if (signals.includes('initial_expansion')) parts.push('one name is the other with initials');
  if (signals.includes('acronym')) parts.push(`"${shorter(a, b).name}" is the acronym of "${longer(a, b).name}"`);
  if (signals.includes('token_subset')) parts.push('one name contains the other');
  if (signals.includes('high_token_overlap')) parts.push('names share most of their words');
  if (signals.includes('semantic') && similarity !== null) {
    parts.push(`summaries are ${Math.round(similarity * 100)}% similar`);
  }
  if (a.typeId !== b.typeId) parts.push(`but typed differently (${a.typeName} vs ${b.typeName})`);
  return parts.join('; ');
}

const shorter = (a: ResolvableEntity, b: ResolvableEntity) => (a.name.length <= b.name.length ? a : b);
const longer = (a: ResolvableEntity, b: ResolvableEntity) => (a.name.length > b.name.length ? a : b);

/**
 * Which of a matched pair should survive.
 *
 * The better-connected entity wins, because every relationship pointing at the
 * loser has to be rewritten and fewer rewrites means less to go wrong. Evidence
 * count breaks ties, then the longer (more specific) name, then id for
 * determinism.
 */
export function pickSurvivor(a: ResolvableEntity, b: ResolvableEntity): { keep: ResolvableEntity; merge: ResolvableEntity } {
  const order = [a, b].sort((x, y) => {
    if (y.degree !== x.degree) return y.degree - x.degree;
    if (y.noteCount !== x.noteCount) return y.noteCount - x.noteCount;
    if (y.name.length !== x.name.length) return y.name.length - x.name.length;
    return x.id < y.id ? -1 : 1;
  });
  return { keep: order[0], merge: order[1] };
}

/**
 * All duplicate candidates in a set of entities.
 *
 * Blocked on the first significant token and on acronym forms so this stays
 * near-linear instead of comparing all n² pairs — at 500 entities n² is fine,
 * but this pass is also meant to survive the graph growing.
 */
export function findDuplicateCandidates(
  entities: ResolvableEntity[],
  opts: { minConfidence?: number; sharedSenders?: ReadonlySet<string> } = {},
): MatchCandidate[] {
  const minConfidence = opts.minConfidence ?? 0.35;
  const sharedSenders = opts.sharedSenders;
  const blocks = new Map<string, ResolvableEntity[]>();

  const addTo = (key: string, e: ResolvableEntity) => {
    if (!key) return;
    const list = blocks.get(key);
    if (list) list.push(e);
    else blocks.set(key, [e]);
  };

  for (const e of entities) {
    // Block on the address as well as the name. Without this the `same_email`
    // signal could never fire on the case it exists for: two entities for one
    // person under unlike display names share no token to meet in.
    // Guarded, so the hundreds of people a notification service writes as do
    // not meet in a block at all.
    const email = emailOf(e, sharedSenders);
    if (email) addTo(`email:${email}`, e);

    const tokens = significantTokens(e.name);
    // Block on every significant token: "IBCA Data Strategy" and "IBCA's Data
    // Strategy" meet in the `ibca`, `data` and `strategy` blocks.
    for (const t of tokens) addTo(t, e);
    for (const acr of acronymsOf(e.name)) addTo(`acr:${acr}`, e);
    // A short, single-token name is itself a potential acronym.
    if (tokens.length === 1 && tokens[0].length <= 12) addTo(`acr:${tokens[0]}`, e);
  }

  const best = new Map<string, MatchCandidate>();
  for (const group of blocks.values()) {
    // A block containing most of the graph is a stop-word in disguise; skip it.
    if (group.length < 2 || group.length > 60) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const cand = scorePair(group[i], group[j], { sharedSenders });
        if (!cand || cand.confidence < minConfidence) continue;
        const key = `${cand.aId}|${cand.bId}`;
        const prev = best.get(key);
        if (!prev || cand.confidence > prev.confidence) best.set(key, cand);
      }
    }
  }

  return [...best.values()].sort((x, y) => y.confidence - x.confidence);
}

/** Confidence at or above which a merge is safe to apply without review. */
export const AUTO_MERGE_THRESHOLD = 0.85;
