import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { SecretError } from '$lib/secrets/registry';
import { saveSteamWebApiKey } from '$lib/activity/providers/steam/credential.server';
import { vaultKeyConfigured } from '$lib/activity/providers/secrets.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import {
  activityErrorResponse,
  activityProblem,
  readActivityJson,
} from '$lib/activity/http.server';

/**
 * Write-only. The owner pastes the Steam Web API key here from the guided
 * setup; it lands in the secrets vault under a binding fixed in code and is
 * never returned by any route.
 *
 * This RE-CHECKS THE OWNER SESSION rather than using the activity principal
 * helper, for the reason `/api/admin/apis/secrets` does: on homeserv the LAN
 * auth bypass makes any loopback request an owner, and a vault write is the
 * one activity mutation that should not inherit that. Reads of the catalogue
 * state stay bypass-friendly; they expose no value.
 */
export const POST: RequestHandler = async (event) => {
  const session = await event.locals.auth();
  if (!isOwnerEmail(session?.user?.email)) {
    return activityProblem(
      403,
      'owner_session_required',
      'Saving an application key needs a signed-in owner session. Sign in at /login and try again.',
    );
  }
  if (!vaultKeyConfigured()) {
    return activityProblem(
      409,
      'vault_key_missing',
      'This server has no INTEGRATION_CREDENTIALS_KEY, so it cannot store the key. Set it in the server environment first.',
    );
  }
  try {
    const body = await readActivityJson(event.request);
    await saveSteamWebApiKey(body.key);
    const feature = await getActivityFeatureState();
    const provider = feature.providers.find((item) => item.id === 'steam');
    return json({ saved: true, provider });
  } catch (error) {
    if (error instanceof SecretError) return activityProblem(400, 'vault_error', error.message);
    return activityErrorResponse(error);
  }
};
