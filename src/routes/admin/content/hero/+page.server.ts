import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { heroBackgroundSchema } from '$lib/server/hero-background-schema';
import { getHeroBackgroundSettings, getHeroBackgroundAsset, saveHeroBackgroundSettings } from '$lib/server/hero-background';
import { heroSourceOptions, selectedHero, heroPreparation, heroSlotAssignments } from '$lib/server/hero-sources';

import { getHeroActivity, getHeroActivityRules, saveHeroActivityRules } from '$lib/server/hero-activity';
import { heroActivitySchema } from '$lib/server/hero-slot-policy';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select()
    .from(heroTitles)
    .orderBy(
      heroTitles.hrBucket,
      heroTitles.stepsBucket,
      heroTitles.tempBucket,
      heroTitles.id,
    );

  const generatedAt = rows.reduce<string | null>((latest, r) => {
    const t = r.generatedAt ? new Date(r.generatedAt).toISOString() : null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);

  const [backgroundSettings, backgroundAsset, backgroundSources, selected, backgroundJob, backgroundSlots, activityRules, activity] = await Promise.all([
    getHeroBackgroundSettings(), getHeroBackgroundAsset(), heroSourceOptions(), selectedHero(), heroPreparation(), heroSlotAssignments(), getHeroActivityRules(), getHeroActivity(),
  ]);
  return { rows, count: rows.length, generatedAt, backgroundSlots, activityRules, activity, backgroundSettings, backgroundAsset, backgroundSources, backgroundJob,
    backgroundSource: selected ? { sourceId: selected.sourceId, sourceName: selected.sourceName } : null };
};

export const actions: Actions = {
  activity: async ({ request }) => {
    const form = await request.formData();
    const parsed = heroActivitySchema.safeParse({ averageSteps: Number(form.get('averageSteps')), veryActiveSteps: Number(form.get('veryActiveSteps')) });
    if (!parsed.success) return fail(400, { activityError: parsed.error.issues.map(i => i.message).join(' ') });
    await saveHeroActivityRules(parsed.data);
    return { activitySaved: true };
  },
  background: async ({ request }) => {
    const form = await request.formData();
    const value: Record<string, unknown> = {};
    for (const key of ['delayMs', 'playbackRate', 'holdMs', 'fadeMs', 'playingOpacity', 'finalTransparency', 'positionX', 'positionY']) {
      const raw = form.get(key);
      value[key] = typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    }
    value.enabled = form.get('enabled') === 'on';
    value.overlayTitle = form.get('overlayTitle') === 'on';
    value.fit = form.get('fit');
    const parsed = heroBackgroundSchema.safeParse(value);
    if (!parsed.success) return fail(400, { backgroundError: 'Check the animation settings: ' + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    await saveHeroBackgroundSettings(parsed.data);
    return { backgroundSaved: true };
  },
};
