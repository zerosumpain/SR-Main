import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import {
  ActivityRequestError,
  activityErrorResponse,
  readActivityJson,
} from '$lib/activity/http.server';
import {
  getActivityOnboardingSession,
  getLatestActivityOnboardingSession,
  publicActivityOnboardingSession,
  recordActivityExportRequest,
  saveActivityOnboardingSelection,
  updateActivityOnboardingProgress,
} from '$lib/activity/store/onboarding.server';

export const GET: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const sessionId = event.url.searchParams.get('session');
  const session = sessionId
    ? await getActivityOnboardingSession(principal.id, sessionId)
    : await getLatestActivityOnboardingSession(principal.id);
  return json({
    session: session ? publicActivityOnboardingSession(session) : null,
  });
};

export const POST: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const body = await readActivityJson(event.request);
    if (!Array.isArray(body.outcomes) || body.outcomes.some((value) => typeof value !== 'string')) {
      throw new ActivityRequestError('invalid_outcomes', 'outcomes must be an array of ids');
    }
    if (
      body.dataClasses !== undefined &&
      (!Array.isArray(body.dataClasses) ||
        body.dataClasses.some((value) => typeof value !== 'string'))
    ) {
      throw new ActivityRequestError('invalid_data_classes', 'dataClasses must be an array of ids');
    }
    const session = await saveActivityOnboardingSelection({
      principalId: principal.id,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      outcomes: body.outcomes as string[],
      selectedProvider: typeof body.selectedProvider === 'string' ? body.selectedProvider : null,
      dataClasses: body.dataClasses as string[] | undefined,
    });
    return json({ session: publicActivityOnboardingSession(session) });
  } catch (error) {
    return activityErrorResponse(error);
  }
};

export const PATCH: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const body = await readActivityJson(event.request);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!sessionId) throw new ActivityRequestError('session_required', 'sessionId is required');
    if (body.action === 'export_requested') {
      const session = await recordActivityExportRequest({
        principalId: principal.id,
        sessionId,
      });
      return json({ session: publicActivityOnboardingSession(session) });
    }
    if (body.action === 'progress') {
      const connectionId = typeof body.connectionId === 'string' ? body.connectionId : '';
      const step = Number(body.step);
      if (!connectionId || !Number.isInteger(step) || step < 3 || step > 8) {
        throw new ActivityRequestError(
          'invalid_progress',
          'connectionId and an onboarding step from 3 to 8 are required',
        );
      }
      const session = await updateActivityOnboardingProgress({
        principalId: principal.id,
        sessionId,
        connectionId,
        step,
      });
      return json({ session: publicActivityOnboardingSession(session) });
    }
    throw new ActivityRequestError('invalid_action', 'Unknown onboarding action');
  } catch (error) {
    return activityErrorResponse(error);
  }
};
