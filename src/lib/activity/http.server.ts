import { json } from '@sveltejs/kit';
import { ActivityContractError } from './contracts';
import { safeActivityErrorText } from './sync/errors';
import { ActivityConnectionError } from './store/connections.server';
import { ActivityGrantError } from './store/grants.server';
import { ActivityImportError } from './imports/store.server';
import { ActivityOnboardingError } from './store/onboarding.server';

export class ActivityRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = 'ActivityRequestError';
  }
}

export function activityProblem(
  status: number,
  code: string,
  detail: string,
  extras: Record<string, unknown> = {},
) {
  return json(
    {
      type: `https://strangeramblings.com/problems/activity/${code}`,
      title: code.replaceAll('_', ' '),
      status,
      detail,
      code,
      ...extras,
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

export async function readActivityJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ActivityRequestError('invalid_json', 'Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function activityErrorResponse(error: unknown) {
  if (error instanceof ActivityRequestError) {
    return activityProblem(error.status, error.code, error.message);
  }
  if (error instanceof ActivityContractError) {
    return activityProblem(400, error.code, error.message);
  }
  if (error instanceof ActivityGrantError) {
    return activityProblem(error.code === 'conflict' ? 409 : 400, error.code, error.message);
  }
  if (error instanceof ActivityImportError) {
    const status = error.code === 'import_not_found' ? 404 : error.code === 'import_not_ready' ? 409 : 400;
    return activityProblem(status, error.code, error.message);
  }
  if (error instanceof ActivityConnectionError) {
    if (error.code === 'provider_not_found' || error.code === 'connection_not_found') {
      return activityProblem(404, error.code, error.message);
    }
    if (error.code === 'provider_unavailable' || error.code === 'mode_not_supported') {
      return activityProblem(409, error.code, error.message);
    }
    return activityProblem(409, error.code, error.message);
  }
  if (error instanceof ActivityOnboardingError) {
    const status = error.code === 'session_not_found' ? 404 : 409;
    return activityProblem(status, error.code, error.message);
  }
  console.error('[activity-api]', safeActivityErrorText(error));
  return activityProblem(500, 'internal_error', 'The activity request could not be completed');
}

export function readIdempotencyKey(request: Request): string | null {
  const value = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!value) return null;
  if (value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ActivityRequestError(
      'invalid_idempotency_key',
      'Idempotency-Key must be 1–128 safe characters',
    );
  }
  return value;
}
