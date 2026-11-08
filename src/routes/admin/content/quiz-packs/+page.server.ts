import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { cleanNotes, cleanTitle, summary } from '$lib/games/quiz-packs';
import { createPack, listPacks } from '$lib/games/quiz-packs.server';

/** /admin/content/quiz-packs — Kelly's Quiz Night: the packs John writes from his own notes and photos. Owner only. */
export const load: PageServerLoad = async () => {
  const packs = await listPacks();
  return { packs: packs.map((p) => ({ ...summary(p), status: p.status, updatedAt: p.updatedAt })) };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    const pack = await createPack({ title: cleanTitle(form.get('title')), subject: cleanTitle(form.get('subject')).replace(/^Untitled pack$/u, ''), notes: cleanNotes(form.get('notes')) });
    redirect(303, `/admin/content/quiz-packs/${pack.id}`);
  },
};
