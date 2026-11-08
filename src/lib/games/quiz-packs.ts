// Kelly's Quiz Night — the pure half: a quiz pack John writes from his own
// material (notes, old photos with captions), its questions, and the checks a
// question must pass before a room may use it. Storage and the model calls are
// ./quiz-packs.server; the room that plays a pack is Quiz Night's own
// (`quiz-night.ts`, `room.pack`).

import { z } from 'zod';

export const PACK_TITLE_MAX = 60;
export const PACK_NOTES_MAX = 12_000;
export const PACK_PHOTOS_MAX = 40;
export const CAPTION_MAX = 200;
/** Questions a pack may hold, and fewest a playable one needs. */
export const PACK_QUESTIONS_MAX = 40;
export const PACK_QUESTIONS_MIN = 6;
/** Questions a room takes from a pack (the pack's own order). */
export const PACK_PLAY_MAX = 20;

export type PackStatus = 'draft' | 'drafting' | 'approved';

export interface PackPhoto {
  id: string;
  /** Where the bytes are, in the private media store (`$lib/jkai/media/storage`). */
  diskPath: string;
  mime: string;
  /** Who, where, when — what the model reads; it never sees the pixels. */
  caption: string;
  year: number | null;
}

export interface PackQuestion {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explain: string | null;
  /** A photo of this pack shown with the question, or null. */
  photoId: string | null;
}

export interface QuizPack {
  id: string;
  title: string;
  subject: string;
  notes: string;
  status: PackStatus;
  /** Why the last draft failed, for the page to say. */
  draftError: string | null;
  photos: PackPhoto[];
  questions: PackQuestion[];
  createdAt: number;
  updatedAt: number;
}

export const isPackId = (v: unknown): v is string => typeof v === 'string' && /^qp_[0-9a-f]{12}$/u.test(v);
export const isPhotoId = (v: unknown): v is string => typeof v === 'string' && /^ph_[0-9a-f]{12}$/u.test(v);

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/gu, '').trim().slice(0, max) : '');

export function cleanTitle(v: unknown): string {
  return clip(v, PACK_TITLE_MAX).replace(/\s+/gu, ' ') || 'Untitled pack';
}

export function cleanNotes(v: unknown): string {
  return clip(v, PACK_NOTES_MAX);
}

export function cleanCaption(v: unknown): string {
  return clip(v, CAPTION_MAX).replace(/\s+/gu, ' ');
}

export function cleanYear(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1850 && n <= 2100 ? n : null;
}

const QuestionIn = z.object({
  id: z.string().max(40).optional(),
  prompt: z.string().trim().min(3).max(300),
  options: z.array(z.string().trim().min(1).max(120)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explain: z.string().trim().max(300).nullable().optional(),
  photoId: z.string().nullable().optional(),
});

/**
 * A question as the editor or the model sent it, made safe: four distinct
 * options, one right answer, a photo only if the pack holds it. Null when it
 * cannot be one.
 */
export function cleanQuestion(raw: unknown, photoIds: ReadonlySet<string>, newId: () => string): PackQuestion | null {
  const q = QuestionIn.safeParse(raw);
  if (!q.success) return null;
  const options = q.data.options.map((o) => o.replace(/\s+/gu, ' '));
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) return null;
  const photoId = q.data.photoId && photoIds.has(q.data.photoId) ? q.data.photoId : null;
  const id = q.data.id && /^pq_[0-9a-f]{12}$/u.test(q.data.id) ? q.data.id : newId();
  return { id, prompt: q.data.prompt.replace(/\s+/gu, ' '), options, answerIndex: q.data.answerIndex, explain: q.data.explain?.trim() || null, photoId };
}

/** Whether a pack can be approved: enough good questions. A sentence saying why not, or null. */
export function approvalProblem(pack: Pick<QuizPack, 'questions'>): string | null {
  if (pack.questions.length < PACK_QUESTIONS_MIN) return `A pack needs at least ${PACK_QUESTIONS_MIN} questions — it has ${pack.questions.length}.`;
  return null;
}

/** What the TV lists: approved packs, newest first, title only. */
export interface PackSummary {
  id: string;
  title: string;
  subject: string;
  questions: number;
  photos: number;
}

export function summary(pack: QuizPack): PackSummary {
  return { id: pack.id, title: pack.title, subject: pack.subject, questions: pack.questions.length, photos: pack.photos.length };
}
