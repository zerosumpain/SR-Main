// Every admit and reject, kept — because it is the training data.
//
// The rule engine cannot learn from the graph: the graph only contains what was
// admitted, so it can tell you what you said yes to and nothing at all about
// what you said no to. A rule proposed from admissions alone would be a rule
// that admits everything, and it would backtest perfectly. The rejections are
// the half that makes a backtest mean something.
//
// Datastore-backed, per the house rule the other engines follow (see
// ./email-domain-rules, $lib/daydream/rules, $lib/selfimprove/types): engine
// state lives in the datastore, so there is no schema change, no
// `drizzle-kit push`, and no CI TTY-prompt risk on deploy.
//
// The facts are snapshotted ONTO the decision rather than re-derived later.
// That is deliberate: `emailKind` changes when a domain rule is added, and
// `ageDays` changes every night. A backtest that re-derived them would score a
// rule against facts the owner never actually saw when they decided, which is
// not a backtest of anything.
import { ensureCollection, upsertRecord, queryRecords } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';
import { factsFor, type MailFacts, type NoteForFacts } from './mail-facts';

export const SYSTEM_ACTOR = 'system';

/** Pinned — renaming this discards every decision the owner has made. */
export const MAIL_DECISIONS_COLLECTION = 'intel_mail_decisions';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

const PAGE = 200;

export type MailDecisionKind = 'admit' | 'reject';

export interface MailDecision {
  noteId: string;
  decision: MailDecisionKind;
  /** 'owner' | 'rule' | 'seed' — a rule must never learn from its own output. */
  actor: string;
  ruleKey?: string;
  reason?: string;
  subject: string;
  /** The facts AS THEY WERE when the decision was made. */
  facts: MailFacts;
  at: string;
}

export async function ensureMailDecisions(): Promise<void> {
  await ensureCollection(
    MAIL_DECISIONS_COLLECTION,
    {
      name: 'Intel Mail Decisions',
      description:
        'Which email threads were admitted to the knowledge graph and which were refused — the training set for admission rules.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

export interface RecordDecisionInput {
  noteId: string;
  decision: MailDecisionKind;
  actor: string;
  ruleKey?: string;
  reason?: string;
  subject: string;
  /** The note's stored metadata; facts are derived from it here. */
  metadata: Record<string, unknown>;
  /** Full note, when the caller has it — gives richer facts than metadata alone. */
  note?: NoteForFacts;
}

/**
 * Write one decision. Keyed on the note id, so changing your mind REPLACES the
 * previous answer rather than leaving the engine to learn from both.
 */
export async function recordMailDecision(input: RecordDecisionInput): Promise<void> {
  try {
    await ensureMailDecisions();
    const now = Date.now();
    const note: NoteForFacts = input.note ?? {
      title: input.subject,
      rawContent: null,
      metadata: input.metadata,
      observedAt: null,
      createdAt: new Date(now),
    };
    const decision: MailDecision = {
      noteId: input.noteId,
      decision: input.decision,
      actor: input.actor,
      ...(input.ruleKey ? { ruleKey: input.ruleKey } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      subject: input.subject.slice(0, 300),
      facts: factsFor(note, now),
      at: new Date(now).toISOString(),
    };
    await upsertRecord(
      MAIL_DECISIONS_COLLECTION,
      { key: input.noteId, data: decision as unknown as Record<string, unknown> },
      SYSTEM_ACTOR,
    );
  } catch (err) {
    // Losing the training signal is bad; failing an admission the owner asked
    // for because the ledger was busy is worse. Loud, not fatal.
    console.error('[intel:mail] could not record decision:', err instanceof Error ? err.message : err);
  }
}

export async function listMailDecisions(): Promise<MailDecision[]> {
  await ensureMailDecisions();
  const out: MailDecision[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records } = await queryRecords(
      MAIL_DECISIONS_COLLECTION,
      { limit: PAGE, offset, sort: { path: 'at', dir: 'desc' } },
      SYSTEM_ACTOR,
    );
    for (const record of records) out.push(record.data as unknown as MailDecision);
    if (records.length < PAGE) break;
  }
  return out;
}

/**
 * The decisions a rule may be judged against.
 *
 * Only the owner's own. A rule scored against admissions another rule made
 * would be scoring itself: rule A admits a hundred newsletters, rule B is
 * proposed, and B backtests brilliantly because it agrees with A. Seeds are
 * excluded for the same reason.
 */
export async function ownerDecisions(): Promise<MailDecision[]> {
  return (await listMailDecisions()).filter((d) => d.actor === 'owner');
}

export interface DecisionTally {
  total: number;
  admitted: number;
  rejected: number;
  byOwner: number;
}

export async function tallyMailDecisions(): Promise<DecisionTally> {
  const all = await listMailDecisions();
  return {
    total: all.length,
    admitted: all.filter((d) => d.decision === 'admit').length,
    rejected: all.filter((d) => d.decision === 'reject').length,
    byOwner: all.filter((d) => d.actor === 'owner').length,
  };
}
