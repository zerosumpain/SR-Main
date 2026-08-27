// Letting one thread into the graph — the other half of the gate.
//
// A sweep now captures and stops (see ./gmail-ingest). This is what happens
// when the owner, or a rule the owner approved, says yes to a thread. It is the
// only path that writes email-derived rows into the graph, and it does four
// things a sweep never did:
//
//   1. the header half — participants and `corresponded_with`, free, from the
//      thread's own headers rather than a model's reading of prose;
//   2. the body half — the existing extractor, forced past the content-hash
//      gate because the text has not changed, the DECISION has;
//   3. the attachments are KEPT. Bytes into /drive under `mail/`, where they
//      get previews, citations and the @files index for nothing. Every previous
//      version of this code read an attachment once and threw the file away;
//   4. the thread is chunked into `mail_embeddings`, so a question can be
//      answered from a sentence in the middle of it rather than from a single
//      vector over two thousand words.
//
// Cost lives here now, and that is the design: a gated sweep of a whole mailbox
// costs an embedding per new thread, and the model calls are spent only on mail
// somebody asked for.
//
// Nothing here throws for one bad thread. Admitting fifty and having the
// fortieth fail must leave thirty-nine admitted and one reported, because the
// alternative is an all-or-nothing button nobody can trust.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes, workflowFiles, driveFolderSettings, type WorkflowFilePermissions } from '$lib/db/schema';
import { newDiskPath, saveBuffer, deleteFile } from '$lib/file-store/storage';
import { reindexFileInBackground } from '$lib/file-index/store';
import { indexMail, removeMail, type MailAttachmentText } from '$lib/mail-index/store';
import { extractIntoIntel } from './auto-extract';
import { persistExtraction } from './graph';
import {
  fetchThread,
  resolveAccount,
  refIdForThread,
  structuralEdges,
  threadAttachments,
  threadIsImportant,
  threadSubject,
  threadTimestamp,
  threadToNoteText,
  threadContentHash,
} from './gmail-ingest';
import { recencyOf } from './staleness';
import { recordMailDecision } from './mail-decisions';

/** Attachments are evidence, not scratch — read-only to every workflow. */
const PERMISSIONS: WorkflowFilePermissions = { read: true, write: false, append: false, delete: false };

/**
 * Where an admitted thread's attachments live.
 *
 * A real folder in /drive rather than a hidden store, because the point is that
 * you can open the thing. The folder is created with `intelMode: 'exclude'` the
 * first time it is used, and that is not optional: a Drive file that feeds the
 * graph would extract the SAME document a second time, through a second door,
 * as a second set of entities — after all this work to have exactly one gate.
 */
export const MAIL_DRIVE_FOLDER = 'mail';

export type AdmitStatus = 'admitted' | 'already' | 'unchanged' | 'not-found' | 'failed';

export interface AdmitOutcome {
  noteId: string;
  subject: string;
  status: AdmitStatus;
  entityCount?: number;
  edges?: number;
  attachmentsSaved?: number;
  chunks?: number;
  reason?: string;
}

export interface AdmitResult {
  admitted: number;
  failed: number;
  entities: number;
  edges: number;
  attachmentsSaved: number;
  chunks: number;
  items: AdmitOutcome[];
}

/** Who asked. Recorded on the decision so the rule engine can tell a rule's
 *  own admissions apart from the owner's — a rule must never learn from itself. */
export type AdmitActor = 'owner' | 'rule' | 'seed';

export interface AdmitOptions {
  actor?: AdmitActor;
  /** Rule key when `actor` is 'rule', so a bad rule's work can be found again. */
  ruleKey?: string;
  /** Why, in the owner's words. Stored on the decision. */
  reason?: string;
}

function slugForFile(text: string, max = 60): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return s || 'attachment';
}

/** Create the mail folder's exclude rule once. Idempotent, and cheap enough to
 *  call on every admission that has an attachment. */
async function ensureMailFolderExcluded(): Promise<void> {
  const existing = await db
    .select({ id: driveFolderSettings.id })
    .from(driveFolderSettings)
    .where(eq(driveFolderSettings.path, MAIL_DRIVE_FOLDER))
    .limit(1);
  if (existing.length) return;
  await db
    .insert(driveFolderSettings)
    .values({ path: MAIL_DRIVE_FOLDER, intelMode: 'exclude', categoryIds: [] })
    .onConflictDoNothing();
}

/**
 * Save one attachment into /drive and hand back its text for the mail index.
 *
 * A name collision means the same attachment from the same thread is already
 * there — re-admitting is not an error, so the existing file is left alone and
 * its text still goes into the index.
 */
async function saveAttachment(
  threadId: string,
  subject: string,
  att: { filename: string; mimeType: string; bytes: Buffer },
): Promise<{ saved: boolean; name: string }> {
  const name = `${MAIL_DRIVE_FOLDER}/${threadId}/${slugForFile(att.filename, 80)}`;
  const existing = await db
    .select({ id: workflowFiles.id })
    .from(workflowFiles)
    .where(eq(workflowFiles.name, name))
    .limit(1);
  if (existing.length) return { saved: false, name };

  const diskPath = newDiskPath(name);
  await saveBuffer(diskPath, att.bytes);
  try {
    const [inserted] = await db
      .insert(workflowFiles)
      .values({
        name,
        description: `Email attachment — ${subject}`.slice(0, 500),
        mimeType: att.mimeType,
        sizeBytes: att.bytes.byteLength,
        diskPath,
        permissions: PERMISSIONS,
        uploadedBy: 'intel-mail',
      })
      .returning({ id: workflowFiles.id });
    if (!inserted) {
      await deleteFile(diskPath).catch(() => {});
      return { saved: false, name };
    }
    // Embeds into the @files index. The folder's exclude rule is what stops it
    // also queueing a second entity extraction of the same document.
    reindexFileInBackground(inserted.id);
    return { saved: true, name };
  } catch (err) {
    // The existence check above is not atomic. Losing the race means the file
    // is there, which is what was wanted — but the blob just written is now an
    // orphan and has to go.
    await deleteFile(diskPath).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    if (/workflow_files_name_idx|unique|duplicate key|23505/i.test(msg)) {
      return { saved: false, name };
    }
    throw err;
  }
}

/**
 * Admit threads into the graph.
 *
 * Sequential, deliberately. Each thread is a Gmail round trip plus a model call
 * plus an embedding batch; running fifty concurrently buys a little wall clock
 * and risks rate-limiting the gateway mid-run, which would leave the queue in a
 * state nobody could reason about.
 */
export async function admitMailNotes(noteIds: string[], opts: AdmitOptions = {}): Promise<AdmitResult> {
  const result: AdmitResult = {
    admitted: 0,
    failed: 0,
    entities: 0,
    edges: 0,
    attachmentsSaved: 0,
    chunks: 0,
    items: [],
  };
  if (!noteIds.length) return result;

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      metadata: intelNotes.metadata,
      graphState: intelNotes.graphState,
      rawContent: intelNotes.rawContent,
    })
    .from(intelNotes)
    .where(and(inArray(intelNotes.id, noteIds), eq(intelNotes.source, 'email')));

  const found = new Map(notes.map((n) => [n.id, n]));
  for (const id of noteIds) {
    if (!found.has(id)) {
      result.items.push({ noteId: id, subject: '', status: 'not-found', reason: 'No email note with that id.' });
      result.failed++;
    }
  }

  for (const note of notes) {
    const meta = (note.metadata ?? {}) as Record<string, unknown>;
    const threadId = typeof meta.gmailThreadId === 'string' ? meta.gmailThreadId : null;
    const item: AdmitOutcome = { noteId: note.id, subject: note.title ?? '', status: 'failed' };

    if (note.graphState === 'admitted') {
      item.status = 'already';
      result.items.push(item);
      continue;
    }

    // Changing your mind has to work.
    //
    // `extractIntoIntel` refuses a rejected note outright — that guard exists so
    // a nightly sweep cannot re-ask a question already answered. Admission is
    // the owner answering it differently, and without this the extractor would
    // return 'skipped' and the thread would report a failure it did not have.
    // Cleared first so the extractor sees an ordinary pending note; the original
    // rejection stays in the decision ledger, because a reversal is a fact about
    // the training data rather than a reason to pretend it never happened.
    if (note.graphState === 'rejected') {
      await db
        .update(intelNotes)
        .set({ graphState: 'pending', updatedAt: new Date() })
        .where(eq(intelNotes.id, note.id));
    }
    if (!threadId) {
      item.reason = 'No Gmail thread id on the note — nothing to re-read.';
      result.items.push(item);
      result.failed++;
      continue;
    }

    try {
      const accountEmail = typeof meta.gmailAccount === 'string' ? meta.gmailAccount : undefined;
      const acct = await resolveAccount();
      if (accountEmail && acct.email !== accountEmail) {
        // Not fatal — one mailbox is the norm — but say so, because reading a
        // thread id against the wrong account silently returns nothing.
        console.warn(
          `[intel:mail-admit] note ${note.id} was swept from ${accountEmail}; admitting against ${acct.email}`,
        );
      }

      const thread = await fetchThread(acct, threadId);
      if (!thread.messages.length) {
        item.reason = 'The thread is no longer readable in Gmail.';
        result.items.push(item);
        result.failed++;
        continue;
      }

      const subject = threadSubject(thread) || note.title || `Gmail thread ${threadId}`;
      item.subject = subject;
      const observedMs = threadTimestamp(thread);
      const observedAt = observedMs ? new Date(observedMs) : undefined;
      const recency = recencyOf(observedMs);
      const hash = threadContentHash(thread);

      // Attachments first: their text joins the body BEFORE extraction, so the
      // model reads the covering note and the document as one conversation —
      // which is what an email with "see attached" actually is.
      let body = threadToNoteText(thread) || note.rawContent || '';
      const attachmentTexts: MailAttachmentText[] = [];
      const { attachments } = await threadAttachments(acct, thread);
      if (attachments.length) await ensureMailFolderExcluded();
      for (const att of attachments) {
        try {
          const saved = await saveAttachment(threadId, subject, att);
          if (saved.saved) {
            result.attachmentsSaved++;
            item.attachmentsSaved = (item.attachmentsSaved ?? 0) + 1;
          }
        } catch (err) {
          // A document that could not be filed is still a document that can be
          // read. Losing the copy must not lose the passage.
          console.warn(
            `[intel:mail-admit] could not save ${att.filename}:`,
            err instanceof Error ? err.message : err,
          );
        }
        if (att.text) {
          attachmentTexts.push({ filename: att.filename, text: att.text });
          body = `${body}\n\n--- ${att.filename} ---\n${att.text}`;
        }
      }

      // `force`, because the content hash has not changed and the decision has.
      // Without it the extractor would answer 'unchanged' and admit nothing —
      // the note was written by the sweep that captured it.
      const outcome = await extractIntoIntel({
        kind: 'file',
        source: 'email',
        refId: refIdForThread(threadId),
        title: subject.slice(0, 200),
        text: body,
        contentHash: hash,
        observedAt,
        force: true,
        hold: false,
        metadata: {
          channel: 'gmail',
          gmailThreadId: threadId,
          gmailAccount: acct.email,
          participants: structuralEdges(thread).participants.map((p) => p.email),
          sourceUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
          admittedBy: opts.actor ?? 'owner',
          ...(opts.ruleKey ? { admittedByRule: opts.ruleKey } : {}),
          ...(threadIsImportant(thread) ? { important: true } : {}),
        },
      });

      if (outcome.status === 'failed' || !outcome.noteId) {
        item.reason = 'Extraction failed — the note is still held and can be retried.';
        result.items.push(item);
        result.failed++;
        continue;
      }

      result.entities += outcome.status === 'extracted' ? outcome.entityCount : 0;
      item.entityCount = outcome.status === 'extracted' ? outcome.entityCount : 0;

      // The header half. Written after the body so both hang off one note, and
      // asserted at the thread's own recency — a correspondence edge from
      // eleven weeks ago is a weaker claim about who works with whom than one
      // from yesterday.
      const structural = structuralEdges(thread);
      if (structural.entities.length) {
        const stats = await persistExtraction(outcome.noteId, structural, { recency, observedAt });
        item.edges = stats.relationshipCount;
        result.edges += stats.relationshipCount;
      }

      const indexed = await indexMail({
        noteId: outcome.noteId,
        subject,
        body: threadToNoteText(thread) || note.rawContent || '',
        attachments: attachmentTexts,
        contentHash: hash,
      });
      if (indexed.status === 'indexed') {
        item.chunks = indexed.chunkCount;
        result.chunks += indexed.chunkCount;
      } else if (indexed.status === 'error') {
        // Admitted but unsearchable. Said out loud rather than swallowed —
        // `backfillMailIndex` exists to pick these up, and it can only do that
        // if somebody knows to run it.
        console.warn(`[intel:mail-admit] ${subject} admitted but not indexed: ${indexed.reason}`);
      }

      await recordMailDecision({
        noteId: outcome.noteId,
        decision: 'admit',
        actor: opts.actor ?? 'owner',
        ruleKey: opts.ruleKey,
        reason: opts.reason,
        metadata: meta,
        subject,
      });

      item.status = 'admitted';
      result.admitted++;
      result.items.push(item);
    } catch (err) {
      item.reason = err instanceof Error ? err.message : String(err);
      result.items.push(item);
      result.failed++;
      console.error(`[intel:mail-admit] note ${note.id} failed:`, item.reason);
    }
  }

  if (result.admitted > 0) {
    const { invalidateGraphAnalysis } = await import('./analytics/load');
    invalidateGraphAnalysis();
  }
  console.log(
    `[intel:mail-admit] ${result.admitted} admitted (${result.entities} entities, ${result.edges} edges, ` +
      `${result.attachmentsSaved} attachments, ${result.chunks} passages), ${result.failed} failed`,
  );
  return result;
}

export interface RejectResult {
  rejected: number;
  items: Array<{ noteId: string; status: 'rejected' | 'not-found' }>;
}

/**
 * Refuse threads.
 *
 * The note stays — daydreaming still reads it for vouchers, receipts and
 * interest terms, and that was never conditional on the graph wanting it. What
 * changes is that the sweep will not offer it again (see the `rejected` branch
 * in extractIntoIntel) and the rule engine gets a negative example, which is
 * the only way it learns what you do NOT want.
 *
 * Any graph rows and passages a previously-admitted thread left behind are
 * removed, so "reject" means the same thing whichever direction it is coming
 * from.
 */
export async function rejectMailNotes(noteIds: string[], opts: AdmitOptions = {}): Promise<RejectResult> {
  const out: RejectResult = { rejected: 0, items: [] };
  if (!noteIds.length) return out;

  const notes = await db
    .select({ id: intelNotes.id, title: intelNotes.title, metadata: intelNotes.metadata, graphState: intelNotes.graphState })
    .from(intelNotes)
    .where(and(inArray(intelNotes.id, noteIds), eq(intelNotes.source, 'email')));
  const found = new Set(notes.map((n) => n.id));
  for (const id of noteIds) {
    if (!found.has(id)) out.items.push({ noteId: id, status: 'not-found' });
  }
  if (!notes.length) return out;

  // A thread that had been admitted has graph rows and passages to take back.
  const wasAdmitted = notes.filter((n) => n.graphState === 'admitted').map((n) => n.id);
  if (wasAdmitted.length) {
    const { purgeMailFromGraph } = await import('./mail-purge');
    await purgeMailFromGraph({ noteIds: wasAdmitted });
    for (const id of wasAdmitted) await removeMail(id);
  }

  await db
    .update(intelNotes)
    .set({ graphState: 'rejected', status: 'held', updatedAt: new Date() })
    .where(inArray(intelNotes.id, notes.map((n) => n.id)));

  for (const note of notes) {
    await recordMailDecision({
      noteId: note.id,
      decision: 'reject',
      actor: opts.actor ?? 'owner',
      ruleKey: opts.ruleKey,
      reason: opts.reason,
      metadata: (note.metadata ?? {}) as Record<string, unknown>,
      subject: note.title ?? '',
    });
    out.items.push({ noteId: note.id, status: 'rejected' });
    out.rejected++;
  }

  if (wasAdmitted.length) {
    const { invalidateGraphAnalysis } = await import('./analytics/load');
    invalidateGraphAnalysis();
  }
  return out;
}

/**
 * Put a decided thread back in the queue.
 *
 * The escape hatch for a rejection made in haste or a rule that turned out to
 * be wrong. Deliberately does NOT delete the original decision: the ledger is
 * the training data, and a reversal is a fact about it, not a reason to pretend
 * the first answer never happened.
 */
export async function requeueMailNotes(noteIds: string[]): Promise<number> {
  if (!noteIds.length) return 0;
  const admitted = await db
    .select({ id: intelNotes.id })
    .from(intelNotes)
    .where(and(inArray(intelNotes.id, noteIds), eq(intelNotes.graphState, 'admitted')));
  if (admitted.length) {
    const { purgeMailFromGraph } = await import('./mail-purge');
    await purgeMailFromGraph({ noteIds: admitted.map((r) => r.id) });
    for (const row of admitted) await removeMail(row.id);
  }
  const result = await db
    .update(intelNotes)
    .set({ graphState: 'pending', status: 'held', updatedAt: new Date() })
    .where(and(inArray(intelNotes.id, noteIds), eq(intelNotes.source, 'email')));
  const count = (result as { rowCount?: number | null } | null)?.rowCount;
  return typeof count === 'number' ? count : noteIds.length;
}
