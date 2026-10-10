import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { heroBackgroundSchema } from '$lib/server/hero-background-schema';
import { getHeroBackgroundSettings, getHeroBackgroundAsset, saveHeroBackgroundSettings } from '$lib/server/hero-background';
import { heroSourceOptions, selectedHero, heroPreparation, heroSlotAssignments } from '$lib/server/hero-sources';

import { getHeroActivity, getHeroActivityRules, saveHeroActivityRules } from '$lib/server/hero-activity';
import { heroActivitySchema } from '$lib/server/hero-slot-policy';
import { isShowcase } from '$lib/server/showcase';
import { landingTaglineSchema } from '$lib/server/landing-tagline-schema';
import { getSavedLandingTagline, saveLandingTagline } from '$lib/server/landing-tagline';
import { LANDING_TAGLINE_MAX } from '$lib/constants/landing-tagline';

export const load: PageServerLoad = async (event) => {
  // Showcase ($lib/server/showcase): not today's step count, nor the activity
  // slot it selects — both are the owner's day.
  const showcase = await isShowcase(event);
  const [backgroundSettings, backgroundAsset, backgroundSources, selected, backgroundJob, backgroundSlots, activityRules, activity, tagline] = await Promise.all([
    getHeroBackgroundSettings(), getHeroBackgroundAsset(), heroSourceOptions(), selectedHero(), heroPreparation(), heroSlotAssignments(), getHeroActivityRules(), getHeroActivity(),
    getSavedLandingTagline(),
  ]);
  return { backgroundSlots, activityRules, tagline,
    activity: showcase ? { slot: 'default' as const, steps: null } : activity, backgroundSettings, backgroundAsset, backgroundSources, backgroundJob,
    backgroundSource: selected ? { sourceId: selected.sourceId, sourceName: selected.sourceName } : null };
};

export const actions: Actions = {
  // The masthead's subtitle. An empty save (what the panel's "Reset to
  // default" leaves in the box) deletes the setting, so the built-in line
  // shows again.
  tagline: async ({ request }) => {
    const form = await request.formData();
    const raw = form.get('tagline');
    const typed = typeof raw === 'string' ? raw : '';
    const parsed = landingTaglineSchema.safeParse(typed);
    if (!parsed.success) {
      // The typed line goes back so a full-page (no-JS) submit refills the box
      // with it; capped, so the response never echoes more than the box holds.
      return fail(400, { taglineError: parsed.error.issues.map(i => i.message).join(' '), taglineValue: typed.slice(0, LANDING_TAGLINE_MAX) });
    }
    await saveLandingTagline(parsed.data);
    return { taglineSaved: true, taglineReset: parsed.data === '' };
  },
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
