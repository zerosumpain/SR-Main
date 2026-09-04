import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createActivityConnection,
  listActivityConnections,
} from '$lib/activity/store/connections.server';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { ActivityRequestError, activityErrorResponse, readActivityJson } from '$lib/activity/http.server';
import { CONNECTION_MODES, type ConnectionMode } from '$lib/activity/contracts';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { publicActivityConnection } from '$lib/activity/public.server';

export const GET: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const connections = await listActivityConnections(principal.id);
  return json({ connections: connections.map(publicActivityConnection) });
};

export const POST: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const body = await readActivityJson(event.request);
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const mode = typeof body.mode === 'string' ? body.mode : '';
    if (!provider) throw new ActivityRequestError('provider_required', 'provider is required');
    if (!CONNECTION_MODES.includes(mode as ConnectionMode)) {
      throw new ActivityRequestError('mode_not_supported', 'mode is not supported');
    }
    const feature = await getActivityFeatureState();
    const providerState = feature.providers.find((item) => item.id === provider);
    const localFixture = import.meta.env.DEV && provider === 'fixture';
    if (!localFixture && !providerState?.canStart) {
      return activityErrorResponse(
        new ActivityRequestError('provider_disabled', 'This activity provider is not enabled', 409),
      );
    }
    const connection = await createActivityConnection({
      principalId: principal.id,
      provider,
      mode: mode as ConnectionMode,
      label: typeof body.label === 'string' ? body.label : undefined,
      scopes: Array.isArray(body.scopes)
        ? body.scopes.filter((scope): scope is string => typeof scope === 'string')
        : undefined,
      allowUnavailable: localFixture,
    });
    return json({ connection: publicActivityConnection(connection) }, { status: 201 });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
