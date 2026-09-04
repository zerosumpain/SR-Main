import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createActivityConnection,
  listActivityConnections,
} from '$lib/activity/store/connections.server';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { ActivityRequestError, activityErrorResponse, readActivityJson } from '$lib/activity/http.server';
import {
  ACTIVITY_DATA_CLASSES,
  CONNECTION_MODES,
  type ActivityDataClass,
  type ConnectionMode,
} from '$lib/activity/contracts';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { publicActivityConnection } from '$lib/activity/public.server';
import {
  attachActivityOnboardingConnection,
  publicActivityOnboardingSession,
  requireActivityOnboardingSession,
} from '$lib/activity/store/onboarding.server';

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
    const onboardingSessionId = typeof body.onboardingSessionId === 'string'
      ? body.onboardingSessionId.trim()
      : '';
    if (!provider) throw new ActivityRequestError('provider_required', 'provider is required');
    if (!CONNECTION_MODES.includes(mode as ConnectionMode)) {
      throw new ActivityRequestError('mode_not_supported', 'mode is not supported');
    }
    let dataClasses = body.dataClasses === undefined
      ? undefined
      : Array.isArray(body.dataClasses) && body.dataClasses.every(
          (value): value is ActivityDataClass =>
            typeof value === 'string' && ACTIVITY_DATA_CLASSES.includes(value as ActivityDataClass),
        )
        ? body.dataClasses
        : null;
    if (dataClasses === null) {
      throw new ActivityRequestError('invalid_data_classes', 'dataClasses must contain recognized ids');
    }
    const feature = await getActivityFeatureState();
    const providerState = feature.providers.find((item) => item.id === provider);
    const localFixture = import.meta.env.DEV && provider === 'fixture';
    if (!localFixture && !providerState?.canStart) {
      return activityErrorResponse(
        new ActivityRequestError('provider_disabled', 'This activity provider is not enabled', 409),
      );
    }
    if (onboardingSessionId) {
      const onboarding = await requireActivityOnboardingSession(principal.id, onboardingSessionId);
      if (onboarding.selectedProvider !== provider) {
        throw new ActivityRequestError(
          'onboarding_provider_mismatch',
          'The onboarding journey is preparing a different provider',
          409,
        );
      }
      const selected = onboarding.dataClasses as ActivityDataClass[];
      dataClasses ??= selected;
      if (
        dataClasses.length !== selected.length ||
        dataClasses.some((dataClass) => !selected.includes(dataClass))
      ) {
        throw new ActivityRequestError(
          'onboarding_data_mismatch',
          'The connection data must match the saved onboarding choice',
          409,
        );
      }
    }
    const connection = await createActivityConnection({
      principalId: principal.id,
      provider,
      mode: mode as ConnectionMode,
      label: typeof body.label === 'string' ? body.label : undefined,
      scopes: Array.isArray(body.scopes)
        ? body.scopes.filter((scope): scope is string => typeof scope === 'string')
        : undefined,
      dataClasses,
      allowUnavailable: localFixture,
    });
    const onboarding = onboardingSessionId
      ? await attachActivityOnboardingConnection({
          principalId: principal.id,
          sessionId: onboardingSessionId,
          connectionId: connection.id,
        })
      : null;
    return json(
      {
        connection: publicActivityConnection(connection),
        onboarding: onboarding ? publicActivityOnboardingSession(onboarding) : null,
      },
      { status: 201 },
    );
  } catch (error) {
    return activityErrorResponse(error);
  }
};
