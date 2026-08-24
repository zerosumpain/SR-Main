import { db } from '$lib/db';
import { jkaiAttachments, type JkaiAttachment } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  describeImage,
  describePdfBestEffort,
  transcribeAudioBestEffort,
  looksLikeRefusal,
  looksDegenerate,
} from '$lib/file-index/describe';

/**
 * Turn an attachment a model cannot natively read into text it can.
 *
 * This is what Hermes has been doing invisibly: the pinned chat model is
 * text-only through the gateway, yet images, PDFs and voice notes work in /jkai
 * because Hermes pre-analyses them and prepends the description. Take Hermes
 * away without this and every attachment silently stops working —
 * `getChatInputCapabilities` is literally `if (opts.hermes) return ALL`.
 *
 * Two decisions worth knowing about, both learned the hard way here:
 *
 * 1. **Successes are cached, failures are NOT.** A failed extraction that gets
 *    stamped permanently means a later code fix re-processes nothing — that is
 *    exactly how every PDF in production stayed broken after the bundled
 *    pdf.worker fix landed. So a failure returns an honest note and leaves no
 *    record, and the next turn tries again.
 *
 * 2. **A refusal is a failure, not a description.** The vision model declines
 *    roughly one run in three on some inputs, and "I can't help with that"
 *    stored as a description is worse than nothing: it reads as fact to the
 *    model downstream. `looksLikeRefusal` and `looksDegenerate` already exist
 *    for this and are applied here.
 *
 * The cache lives in the existing `metadata` jsonb column, so this needs no
 * migration. It matters more than it looks: conversation history is replayed
 * every turn, so an uncached image would be re-described on every single turn
 * for the life of the thread.
 */

/** Bump to invalidate every cached description (e.g. a materially better prompt). */
const PREANALYSIS_VERSION = 1;

/** Below this, an "answer" is not a description. */
const MIN_USEFUL_CHARS = 8;

export interface PreanalysisRecord {
  v: number;
  text: string;
  at: string;
}

export interface PreanalysisOutcome {
  /** True when we have real extracted content. */
  ok: boolean;
  /** Always safe to put in front of a model — a description, or a plain note. */
  text: string;
  /** True when the answer came from cache (no model call). */
  cached: boolean;
}

function cachedRecord(att: JkaiAttachment): PreanalysisRecord | null {
  const meta = att.metadata as { preanalysis?: PreanalysisRecord } | null;
  const rec = meta?.preanalysis;
  if (!rec || rec.v !== PREANALYSIS_VERSION) return null;
  if (typeof rec.text !== 'string' || rec.text.trim().length === 0) return null;
  return rec;
}

async function persist(att: JkaiAttachment, text: string): Promise<void> {
  const meta = (att.metadata as Record<string, unknown> | null) ?? {};
  const next = {
    ...meta,
    preanalysis: { v: PREANALYSIS_VERSION, text, at: new Date().toISOString() },
  };
  try {
    await db.update(jkaiAttachments).set({ metadata: next }).where(eq(jkaiAttachments.id, att.id));
  } catch (err) {
    // A cache write failing must not cost the user their answer.
    console.warn(`[preanalyse] could not cache description for ${att.id}:`, err);
  }
}

/** Human-readable label for the note we show when extraction is impossible. */
function label(att: JkaiAttachment): string {
  return att.originalName ? `${att.kind} "${att.originalName}"` : att.kind;
}

/**
 * Extract text for one attachment. Never throws, never returns empty — a caller
 * can always put `text` in front of a model.
 */
export async function preanalyseAttachment(
  att: JkaiAttachment,
  buf: Buffer,
): Promise<PreanalysisOutcome> {
  const hit = cachedRecord(att);
  if (hit) return { ok: true, text: hit.text, cached: true };

  let raw: string | null = null;
  try {
    if (att.kind === 'image') {
      raw = await describeImage(buf, att.mimeType);
    } else if (att.kind === 'pdf') {
      raw = await describePdfBestEffort(buf, att.originalName ?? 'file.pdf');
    } else if (att.kind === 'audio') {
      raw = await transcribeAudioBestEffort(buf, att.mimeType);
    } else {
      // Video has no extraction path, and text/document never needed one.
      return {
        ok: false,
        cached: false,
        text: `[${label(att)} was attached. This conversation's model cannot read ${att.kind} files and there is no text extraction for them, so its contents are unavailable.]`,
      };
    }
  } catch (err) {
    console.warn(`[preanalyse] extraction threw for ${att.id}:`, err);
    raw = null;
  }

  const text = (raw ?? '').trim();
  // `looksDegenerate` targets repetition, not brevity — it passes a bare "." —
  // so guard length here as well. A handful of characters is not a description,
  // and caching one would be worse than admitting the failure.
  const tooShort = text.length < MIN_USEFUL_CHARS;
  if (!text || tooShort || looksLikeRefusal(text) || looksDegenerate(text)) {
    // Deliberately not cached — see the note at the top of this file.
    return {
      ok: false,
      cached: false,
      text: `[${label(att)} was attached but could not be read. Say so rather than guessing at its contents.]`,
    };
  }

  await persist(att, text);
  return { ok: true, text, cached: false };
}

/** The text part a pre-analysed attachment contributes to a turn. */
export function preanalysisPartText(att: JkaiAttachment, outcome: PreanalysisOutcome): string {
  if (!outcome.ok) return `\n\n${outcome.text}`;
  const name = att.originalName ? ` (${att.originalName})` : '';
  const heading =
    att.kind === 'audio'
      ? `Transcript of attached audio${name}`
      : `Description of attached ${att.kind}${name}`;
  return `\n\n--- ${heading} ---\n${outcome.text}\n--- end ---`;
}
