import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { ActivityRequestError, activityErrorResponse, readActivityJson } from '$lib/activity/http.server';
import { replaceActivityGrants, type GrantChoice } from '$lib/activity/store/grants.server';

export const PUT: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const body = await readActivityJson(event.request);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ActivityRequestError('invalid_version', 'expectedVersion must be a positive integer');
    }
    if (!Array.isArray(body.grants)) {
      throw new ActivityRequestError('invalid_grants', 'grants must be an array');
    }
    const result = await replaceActivityGrants({
      principalId: principal.id,
      connectionId: event.params.id,
      expectedVersion,
      grants: body.grants as GrantChoice[],
    });
    return json(result);
  } catch (error) {
    return activityErrorResponse(error);
  }
};
