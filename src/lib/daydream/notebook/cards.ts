// src/lib/daydream/notebook/cards.ts
//
// Getting the notebook out of the notebook.
//
// The owner's requirement, in his capitals: "notes AND ANY OTHER ACTIVITY THE
// MODEL UNDERTAKES should weave into future ponders, daydreams, suggestions,
// intelligence, and the knowledge graph."
//
// That is four destinations and they are NOT the same mechanism, which is the
// thing worth being explicit about:
//
//   ponders / daydreams / suggestions — all three are the ponder engine. One
//       pack, one `aggregates` slot, cards carried verbatim and cited like
//       everything else. `noteCards` and `actionCards` below.
//   intelligence / the knowledge graph — an `extract` job on the intel outbox,
//       which SR-Jkai-Core runs as a fifth AutoKind. Entities and
//       relationships, not prose.
//
// So a note reaches the thinking engine as a CARD and the graph as a NOTE, and
// neither path is a copy of the other.
//
// ── Verbatim, and cited ────────────────────────────────────────────────────
//
// A note is the owner's own words, which makes it the highest-value card in the
// pack and also the one most dangerous to paraphrase. It is carded exactly as
// typed, with its title, so a musing built on it has to cite it like any other
// card and `audit` can check that it did.

import { createHash } from 'node:crypto';

/** How much of one note goes into the pack. The pack holds dozens of cards and
 *  one long draft must not crowd out the rest. */
export const MAX_CARD_CHARS = 700;

export interface NoteCardInput {
  id: string;
  title: string;
  body: string;
  folder: string;
  supporting?: string | null;
}

/**
 * One note as a pack card.
 *
 * `supporting` is deliberately EXCLUDED. It is the model's own earlier output,
 * and feeding it back in as evidence is how a system comes to cite itself and
 * mistake that for corroboration — the same reason the ponder audit refuses a
 * musing that cites another musing.
 */
export function noteCard(n: NoteCardInput): { key: string; text: string } {
  const body = n.body.trim().slice(0, MAX_CARD_CHARS);
  const head = n.title.trim() || '(untitled note)';
  const where = n.folder ? ` [${n.folder}]` : '';
  return {
    key: `note:${n.id}`,
    text: `From John's notebook${where} — "${head}": ${body}`,
  };
}

export interface ActionCardInput {
  id: string;
  noteTitle: string;
  kind: string;
  title: string;
  result: string | null;
  refKind: string | null;
  refId: string | null;
}

/**
 * What the engine already DID about a note.
 *
 * This is the half that stops the loop being open. Without it the next ponder
 * cycle reads the same note, has the same idea, and proposes the same research
 * a third time — which is precisely the complaint that produced the rulings
 * memory on the feed. A finished action is a fact about the world now.
 */
export function actionCard(a: ActionCardInput): { key: string; text: string } {
  const ref = a.refKind && a.refId ? ` (${a.refKind}:${a.refId})` : '';
  const outcome = a.result ? `: ${a.result.slice(0, 400)}` : '';
  return {
    key: `note-action:${a.id}`,
    text: `Already done for the note "${a.noteTitle || 'untitled'}" — ${a.kind}, ${a.title}${ref}${outcome}`,
  };
}

/** Idempotency key for the graph weave. Changes when the text does. */
export function weaveHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/**
 * The text the extractor reads.
 *
 * Title, folder and body — the prose where the proper nouns live. `supporting`
 * IS included here, unlike the pack card, and the distinction is deliberate:
 * the graph wants every name the note touches, and a model-written paragraph
 * naming three organisations is useful to an entity extractor in a way it is
 * not useful as evidence for a fresh claim.
 */
export function weaveText(n: NoteCardInput): string {
  return [
    n.title.trim() || '(untitled note)',
    n.folder ? `Folder: ${n.folder}` : '',
    '',
    n.body.trim(),
    n.supporting ? `\nSupporting notes:\n${n.supporting.trim()}` : '',
  ]
    .filter((p) => p !== '')
    .join('\n')
    .trim();
}

/**
 * Weave one note into the knowledge graph.
 *
 * SR-Jkai-Core does the extraction (`extractIntoIntel`, the fifth `AutoKind`)
 * when it drains the intel outbox; this queues an `extract` job and, on a later
 * call, reads the job's outcome back. The pass is therefore two-step: the first
 * call for a text returns `queued`, and the next one (the next heartbeat tick,
 * or the next press) finds the result and marks the note woven.
 *
 * A job is matched to the note's CURRENT text by its content hash, so an edit
 * made while a job was in flight queues a fresh one rather than being marked
 * woven on the strength of the old text.
 *
 * Never throws: a graph that is busy must not cost the notebook a save.
 */
export async function weaveNote(noteId: string): Promise<
  | { status: 'woven'; noteId: string; entityCount: number }
  | { status: 'unchanged'; noteId: string }
  | { status: 'queued' }
  | { status: 'too-thin'; chars: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }
> {
  try {
    const [{ getNote, markWoven }, { MIN_EXTRACT_CHARS }, { OWNER_SPACE }, { enqueueIntelJob, latestIntelJob }] =
      await Promise.all([
        import('./store'),
        import('$lib/intel-client/types'),
        import('$lib/intel-client/scope'),
        import('$lib/intel-client/outbox'),
      ]);
    const note = await getNote(noteId);
    if (!note) return { status: 'skipped', reason: `no such note: ${noteId}` };

    const text = weaveText(note);
    if (text.length < MIN_EXTRACT_CHARS) return { status: 'too-thin', chars: text.length };
    const contentHash = weaveHash(text);
    const ref = `notebook:${note.id}`;

    const job = await latestIntelJob<{ status?: string; noteId?: string | null; entityCount?: number }>('extract', ref);
    const jobHash = (job?.payload as { contentHash?: unknown } | null | undefined)?.contentHash;
    if (job && jobHash === contentHash) {
      if (job.state === 'pending') return { status: 'queued' };
      if (job.state === 'done') {
        const out = job.result ?? {};
        if (out.status === 'extracted' && out.noteId) {
          await markWoven(note.id, out.noteId);
          return { status: 'woven', noteId: out.noteId, entityCount: out.entityCount ?? 0 };
        }
        if (out.status === 'unchanged' && out.noteId) {
          await markWoven(note.id, out.noteId);
          return { status: 'unchanged', noteId: out.noteId };
        }
        if (out.status === 'too-short') return { status: 'too-thin', chars: text.length };
        // Anything else (skipped, disabled, failed) is retried with a new job.
      }
    }

    await enqueueIntelJob('extract', ref, {
      kind: 'note',
      refId: note.id,
      title: (note.title || 'Untitled note').slice(0, 200),
      text,
      contentHash,
      source: 'notebook',
      metadata: { noteFolder: note.folder, notebookId: note.id },
      // The notebook is the owner's.
      spaceId: OWNER_SPACE,
    });
    return { status: 'queued' };
  } catch (err) {
    return { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}
