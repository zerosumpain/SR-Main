import { error, fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { approvalProblem, cleanCaption, cleanNotes, cleanQuestion, cleanTitle, cleanYear, isPackId, PACK_QUESTIONS_MAX } from '$lib/games/quiz-packs';
import { PackError, deletePack, draftPack, getPack, photoUrl, removePhoto, updatePack } from '$lib/games/quiz-packs.server';

/** /admin/content/quiz-packs/<id> — one Kelly's Quiz Night pack: notes, photos, questions, approve. Owner only. */
export const load: PageServerLoad = async ({ params }) => {
  if (!isPackId(params.id)) error(404, 'That pack is not there.');
  const pack = await getPack(params.id).catch((err) => {
    if (err instanceof PackError) error(err.status, err.message);
    throw err;
  });
  return {
    pack: {
      ...pack,
      photos: pack.photos.map((p) => ({ id: p.id, caption: p.caption, year: p.year, url: photoUrl(pack.id, p.id) })),
    },
  };
};

async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof PackError) return fail(err.status === 503 ? 503 : 400, { error: err.message });
    throw err;
  }
}

export const actions: Actions = {
  details: async ({ params, request }) => {
    const form = await request.formData();
    return attempt(() =>
      updatePack(params.id, (p) => {
        p.title = cleanTitle(form.get('title'));
        p.subject = String(form.get('subject') ?? '').trim().slice(0, 60);
        p.notes = cleanNotes(form.get('notes'));
      }),
    );
  },
  caption: async ({ params, request }) => {
    const form = await request.formData();
    const id = String(form.get('photoId') ?? '');
    return attempt(() =>
      updatePack(params.id, (p) => {
        const photo = p.photos.find((x) => x.id === id);
        if (!photo) throw new PackError(404, 'That photo is not in this pack.');
        photo.caption = cleanCaption(form.get('caption'));
        photo.year = cleanYear(form.get('year'));
      }),
    );
  },
  removePhoto: async ({ params, request }) => {
    const form = await request.formData();
    return attempt(() => removePhoto(params.id, String(form.get('photoId') ?? '')));
  },
  draft: async ({ params }) => attempt(() => draftPack(params.id)),
  questions: async ({ params, request }) => {
    const form = await request.formData();
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get('questions') ?? '[]'));
    } catch {
      return fail(400, { error: 'The questions could not be read.' });
    }
    if (!Array.isArray(raw)) return fail(400, { error: 'The questions could not be read.' });
    let dropped = 0;
    const result = await attempt(() =>
      updatePack(params.id, (p) => {
        const photoIds = new Set(p.photos.map((x) => x.id));
        const next = [];
        for (const item of raw as unknown[]) {
          const q = cleanQuestion(item, photoIds, () => 'pq_' + randomBytes(6).toString('hex'));
          if (q) next.push(q);
          else dropped++;
        }
        p.questions = next.slice(0, PACK_QUESTIONS_MAX);
      }),
    );
    if (dropped && 'ok' in result) return { ok: true, warning: `${dropped} question${dropped === 1 ? ' was' : 's were'} incomplete and not kept (each needs a question and four different answers).` };
    return result;
  },
  approve: async ({ params }) =>
    attempt(async () => {
      const pack = await getPack(params.id);
      const problem = approvalProblem(pack);
      if (problem) throw new PackError(409, problem);
      await updatePack(params.id, (p) => {
        p.status = 'approved';
      }, { keepStatus: true });
    }),
  unapprove: async ({ params }) =>
    attempt(() =>
      updatePack(params.id, (p) => {
        p.status = 'draft';
      }),
    ),
  delete: async ({ params }) => {
    await deletePack(params.id);
    redirect(303, '/admin/content/quiz-packs');
  },
};
