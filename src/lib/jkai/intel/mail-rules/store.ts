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

/** Put the seed proposal in place if it has never been offered. Returns whether
 *  it was created — an owner who declined it must not be asked again. */
export async function seedMailRules(): Promise<boolean> {
  const existing = await listMailRules();
  if (existing.some((r) => r.key === SEED_RULE.key)) return false;
  const result = await proposeRule(SEED_RULE);
  return result.ok;
}
