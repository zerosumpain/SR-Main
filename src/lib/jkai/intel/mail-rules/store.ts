// Where admission rules live, and the one rule that ships with the feature.
//
// Datastore-backed like every other engine's state (see ../email-domain-rules,
// $lib/daydream/rules/store): no schema change, no `drizzle-kit push`, and the
// owner can edit a rule without a deploy.
//
// The invariant this module exists to hold: **nothing here ever creates an
// active rule.** `proposeRule` writes `status: 'proposed'` and that is the only
// status a write path can produce; `activateRule` is a separate call, reachable
// only from an owner-authenticated route, and it refuses a rule whose backtest
// was never run. A model can fill the queue with proposals and cannot admit a
// single email by doing so.
import { ensureCollection, upsertRecord, queryRecords, deleteRecord } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';
import { validateRule, type MailRule, type MailRuleBacktest } from './spec';

export const SYSTEM_ACTOR = 'system';

/** Pinned — renaming this discards every rule the owner has approved. */
export const MAIL_RULES_COLLECTION = 'intel_mail_rules';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

const PAGE = 200;

/**
 * The one rule that ships proposed, so the graph does not start from nothing.
 *
 * It is the narrowest defensible statement of "this is a conversation, not
 * post": you and at least one other human both sent messages, the sender
 * classifies as an ordinary correspondent, and there is enough text to be worth
 * reading. It arrives PROPOSED with its backtest attached, like any other —
 * shipping it active would break the promise on the first run.
 */
export const SEED_RULE: Omit<MailRule, 'proposedAt'> = {
  key: 'two-way-human-correspondence',
  label: 'Admit threads where you and another person both wrote',
  action: 'admit',
  origin: 'seed',
  status: 'proposed',
  rationale:
    'A thread you replied to, with a human counterparty and real text in it, is the clearest evidence there is ' +
    'that a conversation mattered. It is narrow on purpose: it admits nothing that only arrived.',
  condition: {
    all: [
      { fact: 'twoWay', op: 'eq', value: true },
      { fact: 'ownerReplied', op: 'eq', value: true },
      { fact: 'emailKind', op: 'eq', value: 'correspondence' },
      // Below the extractor's own floor there is nothing to read, and admitting
      // it would spend a model call to learn nothing.
      { fact: 'bodyChars', op: 'gte', value: 200 },
    ],
  },
};

/**
 * The topical seed: mail that is about what the graph already knows.
 *
 * The other seed rule describes a thread's SHAPE — you and a person both wrote.
 * This one describes what it is ABOUT, which is the axis the gate could not see
 * until ../mail-relevance existed. It catches the case the shape rule cannot:
 * an update from a supplier you never reply to, naming a project the graph
 * already knows about, is exactly the mail the graph should have and reads as a
 * broadcast from every angle except its subject matter.
 *
 * Narrow on three counts at once, because a topical rule is the one with the
 * most room to be wrong:
 *
 *   - `graphTopHitWeight >= 3` — at least one entity is in the owner's own
 *     FOREGROUND: watched, lensed, or in a dossier.
 *
 *     This was briefly relaxed to `>= 2` (merely well-corroborated) on the
 *     grounds that the foreground is empty and a rule matching nothing is a
 *     silent no-op. Measuring it on the live mailbox settled the argument the
 *     other way: at `>= 2` the rule matched 2,527 of 3,776 threads — 67%, twice
 *     the auto-refusal ceiling — and its samples were "play our latest trivia
 *     to win a cruise to Alaska" and "Simplify finances with a homeowner loan".
 *     Tightening the frequency cut-off to 0.5% and demanding multi-word names
 *     still left newsletters and receipts, because the graph holds the same
 *     brands, places and technologies that marketing mail is about. Naming a
 *     graph entity is simply not evidence that a thread matters.
 *
 *     A watchlist IS that evidence. Simulated against four plausible watched
 *     entities, this rule matched 9 threads in 3,764 and every one was on
 *     topic. So the empty foreground is not a reason to weaken the rule; it is
 *     the thing to fix, and the label, the rationale and the queue page all say
 *     so rather than leaving a rule that quietly does nothing.
 *   - `graphEntityHits >= 2` — one hit is a coincidence. Two anchored entities
 *     in the same thread is a subject.
 *   - `bodyChars >= 400` — twice the extractor's floor. A notification naming a
 *     known project has nothing in it to extract beyond the name.
 *
 * The relevance facts are 0 on a thread nobody has scored, so this rule admits
 * nothing at all until the scorer has run — which is the correct failure.
 */
export const RELEVANCE_SEED_RULE: Omit<MailRule, 'proposedAt'> = {
  key: 'names-what-you-track',
  label: 'Admit threads naming something on your watchlist (needs a watchlist)',
  action: 'admit',
  origin: 'seed',
  status: 'proposed',
  rationale:
    'REQUIRES A WATCHLIST: it matches nothing until you watch, lens or dossier some entities, and the graph ' +
    'currently has none. Measured on the live mailbox, a rule keyed on merely well-corroborated entities matched ' +
    '67% of the queue and offered marketing mail, because the graph holds the same brands and topics newsletters ' +
    'are about. Keyed on your foreground instead, a simulated four-entity watchlist matched 9 threads in 3,764 ' +
    'and every one was on topic. The signal is the watchlist, not the graph at large.',
  condition: {
    all: [
      { fact: 'graphTopHitWeight', op: 'gte', value: 3 },
      { fact: 'graphEntityHits', op: 'gte', value: 2 },
      { fact: 'bodyChars', op: 'gte', value: 400 },
    ],
  },
};

export async function ensureMailRules(): Promise<void> {
  await ensureCollection(
    MAIL_RULES_COLLECTION,
    {
      name: 'Intel Mail Admission Rules',
      description:
        'Rules that decide which email threads reach the knowledge graph. Proposed by the model as data, activated only by the owner.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

export async function listMailRules(): Promise<MailRule[]> {
  await ensureMailRules();
  const out: MailRule[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records } = await queryRecords(
      MAIL_RULES_COLLECTION,
      { limit: PAGE, offset, sort: { path: 'proposedAt', dir: 'desc' } },
      SYSTEM_ACTOR,
    );
    for (const record of records) out.push(record.data as unknown as MailRule);
    if (records.length < PAGE) break;
  }
  return out;
}

/** Only the rules that actually decide anything. */
export async function activeMailRules(): Promise<MailRule[]> {
  return (await listMailRules()).filter((r) => r.status === 'active');
}

export interface ProposeResult {
  ok: boolean;
  errors: string[];
  rule?: MailRule;
}

/**
 * Store a proposal. Validated first, and always at `status: 'proposed'`.
 *
 * The status is FORCED rather than trusted, even though `validateRule` already
 * refuses a proposal that asked to be active. Two independent guards on the one
 * promise the feature makes, because a validator is a check and this is an
 * invariant.
 */
export async function proposeRule(
  candidate: Omit<MailRule, 'proposedAt' | 'status'> & { status?: string },
  backtest?: MailRuleBacktest,
): Promise<ProposeResult> {
  const validation = validateRule({ ...candidate, status: 'proposed' });
  if (!validation.ok) return { ok: false, errors: validation.errors };

  await ensureMailRules();
  const rule: MailRule = {
    ...(candidate as Omit<MailRule, 'proposedAt' | 'status'>),
    status: 'proposed',
    proposedAt: new Date().toISOString(),
    ...(backtest ? { backtest } : {}),
  };
  await upsertRecord(
    MAIL_RULES_COLLECTION,
    { key: rule.key, data: rule as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
  return { ok: true, errors: [], rule };
}

/**
 * Turn a proposal on. The only path to an active rule, and it refuses a rule
 * that was never replayed — approving a rule without its numbers is exactly the
 * decision this whole apparatus exists to prevent anybody making.
 */
export async function activateRule(key: string): Promise<{ ok: boolean; error?: string; rule?: MailRule }> {
  const rules = await listMailRules();
  const rule = rules.find((r) => r.key === key);
  if (!rule) return { ok: false, error: `No rule called "${key}".` };
  if (!rule.backtest) {
    return { ok: false, error: 'This rule has no backtest. Run it against the mailbox before switching it on.' };
  }
  const next: MailRule = { ...rule, status: 'active', decidedAt: new Date().toISOString() };
  await upsertRecord(
    MAIL_RULES_COLLECTION,
    { key, data: next as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
  return { ok: true, rule: next };
}

/** Turn a rule off, or decline a proposal. Kept rather than deleted, so the
 *  proposer can see it has already been asked and answered. */
export async function setRuleStatus(
  key: string,
  status: 'proposed' | 'active' | 'declined',
): Promise<{ ok: boolean; error?: string }> {
  const rules = await listMailRules();
  const rule = rules.find((r) => r.key === key);
  if (!rule) return { ok: false, error: `No rule called "${key}".` };
  await upsertRecord(
    MAIL_RULES_COLLECTION,
    {
      key,
      data: { ...rule, status, decidedAt: new Date().toISOString() } as unknown as Record<string, unknown>,
    },
    SYSTEM_ACTOR,
  );
  return { ok: true };
}

export async function deleteRule(key: string): Promise<void> {
  await ensureMailRules();
  await deleteRecord(MAIL_RULES_COLLECTION, { key }, SYSTEM_ACTOR);
}

/** Attach a fresh backtest to a stored rule. */
export async function saveBacktest(key: string, backtest: MailRuleBacktest): Promise<void> {
  const rules = await listMailRules();
  const rule = rules.find((r) => r.key === key);
  if (!rule) return;
  await upsertRecord(
    MAIL_RULES_COLLECTION,
    { key, data: { ...rule, backtest } as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
}

/** Put the seed proposals in place if they have never been offered. Returns how
 *  many were created — an owner who declined one must not be asked again. */
export async function seedMailRules(): Promise<number> {
  const existing = await listMailRules();
  const keys = new Set(existing.map((r) => r.key));
  let created = 0;
  for (const seed of [SEED_RULE, RELEVANCE_SEED_RULE]) {
    if (keys.has(seed.key)) continue;
    if ((await proposeRule(seed)).ok) created++;
  }
  return created;
}
