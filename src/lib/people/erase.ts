// Delete an account from the iPhone app — App Store guideline 5.1.1(v): an app
// that creates accounts must let the person delete theirs, and its data, from
// inside the app.
//
// This is /admin/access/[person]'s Remove (`removePerson`: allow-list, phones
// on both lanes, household link) plus the DATA that Remove deliberately
// leaves behind. Order, and why:
//
//  1. The companion server FIRST (like link-email and delete-my-data): their
//     health, locations, alerts, Family view, credentials and account row go
//     there, and a failure stops everything before this site is touched, so a
//     retry from the same phone does both.
//  2. Their data here, in ONE transaction (`eraseRows`). A failure rolls it
//     back with the account still in place, so the phone can retry.
//  3. `removePerson` — the same path the owner's Remove button runs.
//  4. The account records themselves: every native credential row (not just
//     revoked), every access request, invites addressed to them.
//  5. Files on disk (chat attachments, drive files) — best effort, after the
//     rows that point at them are gone.
//  6. The owner is told.
//
// The OWNER is never deleted: refused here, in the route, and by the pilot.
//
// Family tasks are ANONYMISED, not deleted: a task someone else wrote, or a
// reward a parent already paid, is the family's record, not theirs. Tasks
// assigned to them or done by them are soft-deleted (the list's own
// `deleted` status, so they leave every list), and their address is scrubbed
// from every task column, in every row — nothing on the list still names them.
//
// `ACCOUNT_COLUMNS` below names what happens to every column that can hold
// their address or principal. `erase.test.ts` fails when the schema grows a
// new one that is not classified there.

import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import {
  accessInvite,
  accessRequest,
  accessUsage,
  activityPrincipals,
  allowedUser,
  appSettings,
  conversations,
  daydreamNotebook,
  driveFolderSettings,
  familyStepsDay,
  familyStepsEvent,
  familyTask,
  fileShareTokens,
  gmailAccounts,
  householdMember,
  jkaiAttachments,
  jkaiEvidenceResults,
  nativeCredentials,
  newsFavourites,
  newsReads,
  researchSessions,
  workflowFiles,
  workflowInteractions,
  workflows,
} from '$lib/db/schema';
import { isOwnerEmail } from '$lib/server/access';
import { asList } from '$lib/server/grants';
import { notifyOwner } from '$lib/server/notify';
import { enqueueIntelJob } from '$lib/intel-client/outbox';
import { deleteResearchSessionRows } from '$lib/deepdive/delete-session';
import { deleteByDiskPath } from '$lib/jkai/media/storage';
import { deleteFile } from '$lib/file-store/storage';
import {
  deletePilotData,
  deletePilotUser,
  pilotFailureText,
  type PilotDeleted,
  type PilotResult,
} from '$lib/home/presence/companion-accounts';
import { defaultDeleteDeps } from '$lib/home/presence/delete-my-data';
import { memberByEmail } from '$lib/home/presence/members';
import { removePerson, type RemoveReport } from './people.server';

/** What `created_by_email` becomes on a task they wrote for someone else. Not an address: it matches nobody. */
export const DELETED_ACCOUNT = 'deleted-account';

type Fate = 'erase' | 'scrub' | 'cascade' | 'kept';

/**
 * Every column that can hold a person's address or principal, and its fate:
 * `erase` — their rows are deleted; `scrub` — the value is nulled (or set to
 * DELETED_ACCOUNT) and the row stays; `cascade` — goes with a parent row that
 * is erased; `kept` — with the reason it is not theirs to delete.
 */
export const ACCOUNT_COLUMNS: Record<string, Record<string, Fate | `kept: ${string}`>> = {
  allowed_user: { email: 'erase', added_by: 'scrub' },
  access_invite: { email: 'erase', used_by_email: 'scrub', created_by: 'scrub' },
  access_request: { email: 'erase', decided_by: 'scrub' },
  native_credentials: { owner_email: 'erase' },
  household_member: { email: 'scrub' },
  news_favourites: { owner_key: 'erase' },
  news_reads: { owner_key: 'erase' },
  family_steps_day: { email: 'erase' },
  family_steps_event: { email: 'erase' },
  family_task: {
    assignee_email: 'scrub',
    created_by_email: 'scrub',
    done_by_email: 'scrub',
    confirmed_by_email: 'scrub',
    reward_paid_by_email: 'scrub',
  },
  gmail_accounts: { email: 'erase', principal_id: 'erase' },
  activity_principals: { external_ref: 'erase' },
  jkai_conversations: { principal_id: 'erase' },
  jkai_attachments: { principal_id: 'erase' },
  research_session: { principal_id: 'erase' },
  daydream_notebook: { principal_id: 'erase' },
  workflows: { principal_id: 'erase' },
  workflow_files: { principal_id: 'erase', uploaded_by: 'scrub' },
  workflow_interactions: { resolved_by: 'scrub' },
  file_share_token: { created_by: 'erase' },
  drive_folder_settings: { space_id: 'erase' },
  access_usage: { principal_id: 'erase' },
  // Every activity_* table references activity_principals ON DELETE CASCADE.
  activity_connections: { principal_id: 'cascade' },
  activity_consumer_grants: { principal_id: 'cascade' },
  activity_daily_projections: { principal_id: 'cascade' },
  activity_events: { principal_id: 'cascade' },
  activity_imports: { principal_id: 'cascade' },
  activity_oauth_transactions: { principal_id: 'cascade' },
  activity_onboarding_sessions: { principal_id: 'cascade' },
  activity_outbox: { principal_id: 'cascade' },
  activity_source_objects: { principal_id: 'cascade' },
  activity_sync_cursors: { principal_id: 'cascade' },
  activity_sync_jobs: { principal_id: 'cascade' },
  // Intel rows are SR-Jkai-Core's to write (Main only queues jobs): their
  // mailboxes go by a `mail-purge` job each, their drive files by `file-deleted`.
  intel_notes: { space_id: 'kept: Core-owned; purged by the mail-purge / file-deleted jobs queued here' },
  intel_entities: { space_id: 'kept: Core-owned; purged by the mail-purge / file-deleted jobs queued here' },
  intel_relationships: { space_id: 'kept: Core-owned; purged by the mail-purge / file-deleted jobs queued here' },
  intel_timeline_events: { space_id: 'kept: Core-owned; purged by the mail-purge / file-deleted jobs queued here' },
  // Owner-only surfaces: a member can never write these, so the value is always the owner or an agent tag.
  activity_share_token: { created_by: 'kept: owner-only (health sharing)' },
  project_share: { created_by: 'kept: owner-only (projects)' },
  deck_share: { created_by: 'kept: owner-only (decks)' },
  policy_share: { created_by: 'kept: owner-only (policy analysis)' },
  policy_analyses: { owner: 'kept: owner-only (policy analysis)' },
  policy_personas: { owner: 'kept: owner-only (policy analysis)' },
  rag_collections: { owner: 'kept: owner-only (the whole authed area)' },
  datastore_collections: { created_by: 'kept: owner-only (datastore)' },
  datastore_records: { created_by: 'kept: owner-only (datastore)' },
  custom_tools: { created_by: 'kept: agent tag, never a person' },
  daydream_capabilities: { decided_by: 'kept: owner-only (daydream)' },
};

export interface EraseTarget {
  /** Their address now, and every alias (an Apple relay they registered with). */
  addresses: string[];
  /** Their `u_…` principal, when they ever held a grant. */
  principalId: string | null;
  /** Their household row, whose Life360 trail stays but whose phone trail goes. */
  householdSubject: string | null;
}

export interface ErasedRows {
  conversations: number;
  researchRuns: number;
  notes: number;
  workflows: number;
  driveFiles: number;
  mailboxes: number;
  tasksRemoved: number;
  tasksAnonymised: number;
  stepDays: number;
  newsRows: number;
  /** On-disk files to remove once the rows are gone. */
  attachmentPaths: string[];
  drivePaths: string[];
}

/**
 * Everything of theirs on this site, in one transaction. Leaves the account
 * records (allow-list, phones, requests) for `removePerson` and
 * `eraseAccountRecords`, so a failure here leaves a phone that can retry.
 */
export async function eraseRows(target: EraseTarget, executor: typeof db = db): Promise<ErasedRows> {
  const addrs = target.addresses;
  const pid = target.principalId;
  return executor.transaction(async (tx) => {
    const out: ErasedRows = {
      conversations: 0,
      researchRuns: 0,
      notes: 0,
      workflows: 0,
      driveFiles: 0,
      mailboxes: 0,
      tasksRemoved: 0,
      tasksAnonymised: 0,
      stepDays: 0,
      newsRows: 0,
      attachmentPaths: [],
      drivePaths: [],
    };

    // ── by address ──────────────────────────────────────────────────────────
    const favs = await tx.delete(newsFavourites).where(inArray(newsFavourites.ownerKey, addrs)).returning({ k: newsFavourites.newsKey });
    const reads = await tx.delete(newsReads).where(inArray(newsReads.ownerKey, addrs)).returning({ k: newsReads.newsKey });
    await tx.delete(appSettings).where(inArray(appSettings.key, addrs.map((a) => `news.lastVisit.${a}`)));
    out.newsRows = favs.length + reads.length;

    const days = await tx.delete(familyStepsDay).where(inArray(familyStepsDay.email, addrs)).returning({ d: familyStepsDay.day });
    await tx.delete(familyStepsEvent).where(inArray(familyStepsEvent.email, addrs));
    out.stepDays = days.length;

    const removed = await tx
      .update(familyTask)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(
        and(
          ne(familyTask.status, 'deleted'),
          or(inArray(familyTask.assigneeEmail, addrs), inArray(familyTask.doneByEmail, addrs)),
        ),
      )
      .returning({ id: familyTask.id });
    out.tasksRemoved = removed.length;
    const touched = new Set<string>();
    const scrub = async (
      column:
        | typeof familyTask.assigneeEmail
        | typeof familyTask.doneByEmail
        | typeof familyTask.confirmedByEmail
        | typeof familyTask.rewardPaidByEmail,
      key: 'assigneeEmail' | 'doneByEmail' | 'confirmedByEmail' | 'rewardPaidByEmail',
    ) => {
      const rows = await tx.update(familyTask).set({ [key]: null }).where(inArray(column, addrs)).returning({ id: familyTask.id });
      for (const r of rows) touched.add(r.id);
    };
    await scrub(familyTask.assigneeEmail, 'assigneeEmail');
    await scrub(familyTask.doneByEmail, 'doneByEmail');
    await scrub(familyTask.confirmedByEmail, 'confirmedByEmail');
    await scrub(familyTask.rewardPaidByEmail, 'rewardPaidByEmail');
    const created = await tx
      .update(familyTask)
      .set({ createdByEmail: DELETED_ACCOUNT })
      .where(inArray(familyTask.createdByEmail, addrs))
      .returning({ id: familyTask.id });
    for (const r of created) touched.add(r.id);
    out.tasksAnonymised = touched.size;

    await tx.update(accessInvite).set({ usedByEmail: null }).where(inArray(accessInvite.usedByEmail, addrs));
    await tx.update(accessInvite).set({ createdBy: null }).where(inArray(accessInvite.createdBy, addrs));
    await tx.update(accessRequest).set({ decidedBy: null }).where(inArray(accessRequest.decidedBy, addrs));
    await tx.update(allowedUser).set({ addedBy: null }).where(inArray(allowedUser.addedBy, addrs));
    await tx.update(workflowInteractions).set({ resolvedBy: null }).where(inArray(workflowInteractions.resolvedBy, addrs));
    await tx.update(workflowFiles).set({ uploadedBy: null }).where(inArray(workflowFiles.uploadedBy, addrs));
    await tx.delete(fileShareTokens).where(inArray(fileShareTokens.createdBy, addrs));

    // Their phone's copy of their movement on /home/people. The household row
    // and its Life360 / Home Assistant trail are the owner's and stay.
    if (target.householdSubject) {
      await defaultDeleteDeps.deleteCompanionTrail(target.householdSubject, tx);
    }

    // ── by principal (only someone who ever held a grant has one) ───────────
    if (pid) {
      // Chat: messages, traces and attachment rows cascade from the thread.
      const threads = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.principalId, pid));
      const threadIds = threads.map((t) => t.id);
      const files = await tx
        .select({ diskPath: jkaiAttachments.diskPath })
        .from(jkaiAttachments)
        .where(
          threadIds.length
            ? or(eq(jkaiAttachments.principalId, pid), inArray(jkaiAttachments.conversationId, threadIds))
            : eq(jkaiAttachments.principalId, pid),
        );
      out.attachmentPaths = files.map((f) => f.diskPath);
      if (threadIds.length) await tx.delete(jkaiEvidenceResults).where(inArray(jkaiEvidenceResults.conversationId, threadIds));
      await tx.delete(jkaiAttachments).where(eq(jkaiAttachments.principalId, pid));
      out.conversations = (await tx.delete(conversations).where(eq(conversations.principalId, pid)).returning({ id: conversations.id })).length;

      const runs = await tx.select({ id: researchSessions.id }).from(researchSessions).where(eq(researchSessions.principalId, pid));
      // Explore-further children of theirs point at their runs; unhook first.
      if (runs.length) {
        await tx
          .update(researchSessions)
          .set({ parentSessionId: null })
          .where(inArray(researchSessions.parentSessionId, runs.map((r) => r.id)));
      }
      for (const r of runs) await deleteResearchSessionRows(tx, r.id);
      out.researchRuns = runs.length;

      out.notes = (await tx.delete(daydreamNotebook).where(eq(daydreamNotebook.principalId, pid)).returning({ id: daydreamNotebook.id })).length;
      out.workflows = (await tx.delete(workflows).where(eq(workflows.principalId, pid)).returning({ id: workflows.id })).length;

      // Their Drive folder. Core is told per file so anything it read from
      // one leaves the intel graph too, in the same transaction as the row.
      const drive = await tx.delete(workflowFiles).where(eq(workflowFiles.principalId, pid)).returning({ id: workflowFiles.id, diskPath: workflowFiles.diskPath });
      for (const f of drive) await enqueueIntelJob('file-deleted', f.id, undefined, tx);
      out.driveFiles = drive.length;
      out.drivePaths = drive.map((f) => f.diskPath);
      await tx.delete(driveFolderSettings).where(eq(driveFolderSettings.spaceId, pid));

      // Their mailboxes, and (by Core) what was read from them — exactly the
      // disconnect button's job (/api/gmail/accounts DELETE).
      const boxes = await tx.delete(gmailAccounts).where(eq(gmailAccounts.principalId, pid)).returning({ id: gmailAccounts.id, email: gmailAccounts.email });
      for (const b of boxes) await enqueueIntelJob('mail-purge', String(b.id), { email: b.email, spaceId: pid }, tx);
      out.mailboxes = boxes.length;

      await tx.delete(accessUsage).where(eq(accessUsage.principalId, pid));
      // Last: every activity_* row cascades from the principal.
      await tx.delete(activityPrincipals).where(eq(activityPrincipals.id, pid));
    }
    return out;
  });
}

/**
 * The account records `removePerson` revokes rather than deletes: every
 * phone credential row (both lanes' site half), every request, every invite
 * addressed to them, any allow-list row under an alias, the household link
 * under an alias.
 */
export async function eraseAccountRecords(addresses: string[], executor: DbExecutor = db): Promise<number> {
  const creds = await executor.delete(nativeCredentials).where(inArray(nativeCredentials.ownerEmail, addresses)).returning({ id: nativeCredentials.id });
  await executor.delete(accessRequest).where(inArray(accessRequest.email, addresses));
  await executor.delete(accessInvite).where(inArray(accessInvite.email, addresses));
  await executor.delete(allowedUser).where(inArray(allowedUser.email, addresses));
  await executor
    .update(householdMember)
    .set({ email: null, updatedAt: new Date() })
    .where(sql`lower(${householdMember.email}) in (${sql.join(addresses.map((a) => sql`${a}`), sql`, `)})`);
  return creds.length;
}

// ── the whole deletion ───────────────────────────────────────────────────────

export interface EraseDeps {
  isOwner: (email: string) => boolean;
  /** Who this is, or null when there is no account and no request under that address (unless `anyway`). */
  resolve: (email: string, anyway: boolean) => Promise<(EraseTarget & { name: string }) | null>;
  pilotDeleteUser: (email: string) => Promise<PilotResult<PilotDeleted>>;
  pilotDeleteData: (email: string) => Promise<PilotResult<PilotDeleted>>;
  eraseRows: (target: EraseTarget) => Promise<ErasedRows>;
  removePerson: (email: string) => Promise<RemoveReport>;
  eraseAccountRecords: (addresses: string[]) => Promise<number>;
  deleteFiles: (attachmentPaths: string[], drivePaths: string[]) => Promise<number>;
  notify: (name: string, email: string) => Promise<void>;
}

export type EraseOutcome =
  | { ok: true; email: string; rows: Omit<ErasedRows, 'attachmentPaths' | 'drivePaths'>; pilot: Record<string, number>; warnings: string[] }
  | { ok: false; status: 403 | 404 | 500 | 502; error: string };

export const OWNER_REFUSAL = 'The owner account is managed on the website, not from the app.';

export interface EraseOptions {
  /**
   * The companion server vouches this person exists (they asked from a phone
   * paired to it alone): go ahead even when this site holds no account or
   * request for them — their household link and trail are still theirs.
   */
  pilotConfirmed?: boolean;
}

export async function eraseAccount(
  emailRaw: string,
  deps: EraseDeps = defaultEraseDeps,
  options: EraseOptions = {},
): Promise<EraseOutcome> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || deps.isOwner(email)) return { ok: false, status: 403, error: OWNER_REFUSAL };

  const target = await deps.resolve(email, options.pilotConfirmed === true);
  if (!target) return { ok: false, status: 404, error: 'There is no account here to delete.' };
  if (target.addresses.some((a) => deps.isOwner(a))) return { ok: false, status: 403, error: OWNER_REFUSAL };
  const canonical = target.addresses[0];
  const warnings: string[] = [];

  // 1. The companion server. Any address they are known by there.
  const pilot: Record<string, number> = {};
  for (const address of target.addresses) {
    let r = await deps.pilotDeleteUser(address);
    if (!r.ok && r.reason === 'not-found') {
      // Not in the family — or a pilot without the delete route yet. The data
      // wipe is older (Contract F), so a stale pilot still loses everything
      // they uploaded; only its account row outlives this.
      const data = await deps.pilotDeleteData(address);
      if (data.ok) warnings.push('The app server kept an empty account row: it needs updating.');
      r = data.ok || data.reason === 'not-found' ? { ok: true, value: data.ok ? data.value : { counts: {} } } : data;
    }
    if (!r.ok && r.reason === 'unconfigured') continue;
    if (!r.ok) {
      return { ok: false, status: 502, error: `Nothing was deleted. ${pilotFailureText(r.reason)} Try again in a minute.` };
    }
    for (const [k, v] of Object.entries(r.value.counts)) pilot[k] = (pilot[k] ?? 0) + v;
  }

  // 2. Their data here, all or nothing.
  let rows: ErasedRows;
  try {
    rows = await deps.eraseRows(target);
  } catch (err) {
    console.error('[account] erase failed:', err);
    return { ok: false, status: 500, error: 'Your data could not be deleted. Nothing on this site changed — try again.' };
  }

  // 3. The owner's Remove, then 4. the records it only revokes.
  try {
    const report = await deps.removePerson(canonical);
    if (report.appError) warnings.push(report.appError);
    await deps.eraseAccountRecords(target.addresses);
  } catch (err) {
    console.error('[account] account removal failed:', err);
    return { ok: false, status: 500, error: 'Your data was deleted, but the account could not be closed. Try again.' };
  }

  // 5. Files, best effort: the rows that named them are already gone.
  const { attachmentPaths, drivePaths, ...counts } = rows;
  const failedFiles = await deps.deleteFiles(attachmentPaths, drivePaths).catch(() => attachmentPaths.length + drivePaths.length);
  if (failedFiles) warnings.push(`${failedFiles} stored file(s) could not be removed from disk.`);

  // 6. Tell the owner. Never throws.
  await deps.notify(target.name, canonical).catch(() => {});
  return { ok: true, email: canonical, rows: counts, pilot, warnings };
}

// ── deletions asked for on the companion server ─────────────────────────────

/** Addresses finished recently, so a users list cached before the pilot dropped them does not run them twice. */
const recentlySwept = new Map<string, number>();
const SWEEP_MEMORY_MS = 15 * 60_000;

export interface SweepResult {
  deleted: number;
  failed: number;
}

/**
 * A phone paired to the companion server alone deletes its account THERE
 * (`POST /api/apple/account/delete`): the pilot wipes what it uploaded and
 * flags the row. Every household pull (`household-live`) hands this the
 * users it just read; each flagged one is deleted here exactly as the site
 * route would, pilot row last-of-all included. The owner is never touched.
 */
export async function sweepAccountDeletions(
  users: ReadonlyArray<{ email: string; deleteRequested?: string | null }> | null,
  erase: (email: string) => Promise<EraseOutcome> = (email) => eraseAccount(email, defaultEraseDeps, { pilotConfirmed: true }),
  now = Date.now(),
  isOwner: (email: string) => boolean = isOwnerEmail,
): Promise<SweepResult> {
  const result: SweepResult = { deleted: 0, failed: 0 };
  for (const [email, at] of recentlySwept) if (now - at > SWEEP_MEMORY_MS) recentlySwept.delete(email);
  for (const u of users ?? []) {
    const email = String(u.email ?? '').trim().toLowerCase();
    if (!email || !u.deleteRequested || recentlySwept.has(email) || isOwner(email)) continue;
    const r = await erase(email).catch((err) => {
      console.error('[account] sweep failed:', err);
      return null;
    });
    if (r?.ok) {
      recentlySwept.set(email, now);
      result.deleted++;
    } else {
      result.failed++;
    }
  }
  return result;
}

/** Reset between tests. */
export function resetSweepMemory(): void {
  recentlySwept.clear();
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

async function resolveTarget(email: string, anyway: boolean): Promise<(EraseTarget & { name: string }) | null> {
  const [account] = await db
    .select()
    .from(allowedUser)
    .where(sql`${allowedUser.email} = ${email} OR ${allowedUser.aliases} ? ${email}`)
    .limit(1);
  const canonical = account?.email ?? email;
  const aliases = account ? asList(account.aliases).filter((a): a is string => typeof a === 'string') : [];
  const addresses = [...new Set([canonical, email, ...aliases.map((a) => a.toLowerCase())])];
  const [request] = await db
    .select({ name: accessRequest.name })
    .from(accessRequest)
    .where(inArray(accessRequest.email, addresses))
    .limit(1);
  if (!account && !request && !anyway) return null;
  const [principal] = await db
    .select({ id: activityPrincipals.id })
    .from(activityPrincipals)
    .where(and(eq(activityPrincipals.kind, 'user'), inArray(activityPrincipals.externalRef, addresses)))
    .limit(1);
  const household = await memberByEmail(canonical);
  return {
    addresses,
    principalId: principal?.id ?? null,
    householdSubject: household?.subject ?? null,
    name: household?.displayName || account?.note || request?.name || nameFromEmail(canonical),
  };
}

async function deleteFiles(attachmentPaths: string[], drivePaths: string[]): Promise<number> {
  let failed = 0;
  for (const p of attachmentPaths) await deleteByDiskPath(p).catch(() => failed++);
  for (const p of drivePaths) await deleteFile(p).catch(() => failed++);
  return failed;
}

export const defaultEraseDeps: EraseDeps = {
  isOwner: (email) => isOwnerEmail(email),
  resolve: resolveTarget,
  pilotDeleteUser: (email) => deletePilotUser(email),
  pilotDeleteData: (email) => deletePilotData(email),
  eraseRows: (target) => eraseRows(target),
  removePerson: (email) => removePerson(email),
  eraseAccountRecords: (addresses) => eraseAccountRecords(addresses),
  deleteFiles,
  notify: async (name, email) => {
    await notifyOwner({
      category: 'access',
      title: `${name} deleted their account`,
      body: `${email} deleted their account from the iPhone app. Their access, phones and data are gone.`,
      url: '/admin/access',
      severity: 'info',
      dedupeKey: `account-deleted:${email}`,
    });
  },
};
