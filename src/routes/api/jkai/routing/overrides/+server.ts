// Owner-gated (hooks.server.ts — /jkai and /api/jkai are owner-only). Backs the
// /jkai model picker's "apply to" chips: read the site default plus each
// profile's auto / pinned / effective model, and write either the site default
// or a per-profile pin.
//
// Both writes live here rather than reusing /api/admin/models/settings so the
// modal makes one round-trip and gets the refreshed picture back in the same
// response.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setSetting, clearSettingsCache, resolveDefaultModel } from '$lib/server/models/settings';
import { describeProfiles, setOverride, isRoutingEnabled } from '$lib/routing/events';
import { PROFILE_LABEL, PROFILES, type ModelProfile } from '$lib/routing/types';

const SITE_DEFAULT_KEY = 'jkai.chat.default_model';

async function picture() {
  const [siteDefault, profiles, routingEnabled] = await Promise.all([
    resolveDefaultModel(),
    describeProfiles(),
    isRoutingEnabled(),
  ]);
  return {
    routingEnabled,
    siteDefaultModelId: siteDefault.modelId,
    profiles: profiles.map((p) => ({ ...p, label: PROFILE_LABEL[p.profile] })),
  };
}

export const GET: RequestHandler = async () => json(await picture());

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const target = body?.target;

  if (target === 'site') {
    // Same validation as /api/admin/models/settings: a bare id would 400 at
    // OpenRouter call time, so reject it at save time.
    if (!isValidOpenRouterId(body?.modelId)) {
      throw error(400, 'invalid modelId — must be a full OpenRouter slug (vendor/model)');
    }
    await setSetting(SITE_DEFAULT_KEY, { provider: 'openrouter', modelId: body.modelId });
    clearSettingsCache();
    return json({ ok: true, ...(await picture()) });
  }

  if (isProfile(target)) {
    // null clears the pin and hands the profile back to the nightly selection.
    const modelId = body?.modelId ?? null;
    if (modelId !== null && !isValidOpenRouterId(modelId)) {
      throw error(400, 'invalid modelId — must be a full OpenRouter slug (vendor/model)');
    }
    await setOverride(target, modelId);
    return json({ ok: true, ...(await picture()) });
  }

  throw error(400, `invalid target — expected "site" or one of ${PROFILES.join(', ')}`);
};

function isProfile(v: unknown): v is ModelProfile {
  return typeof v === 'string' && (PROFILES as string[]).includes(v);
}

function isValidOpenRouterId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.includes('/');
}
