import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { MODEL_SERVICE_APPS, type ModelServiceApp } from '$lib/llm/model-service-contract';

/**
 * The service credentials for the model-plumbing lane:
 * `GET /api/platform/models/config` and `POST /api/platform/models/usage`.
 *
 * One credential PER APPLICATION, not one shared token, because the usage
 * endpoint writes rows into the cost ledger and has to say whose spend each row
 * is. With a shared token the caller would name itself in the body and any
 * application could book its spend to another. Here the credential is the
 * name: `MODEL_SERVICE_TOKEN_POLICY_ENGINE` can only ever be Policy Engine.
 *
 *   MODEL_SERVICE_TOKEN_DRIVE
 *   MODEL_SERVICE_TOKEN_HEALTH
 *   MODEL_SERVICE_TOKEN_POLICY_ENGINE
 *   MODEL_SERVICE_TOKEN_DFE_DATA_STRATEGY
 *   MODEL_SERVICE_TOKEN_DATA_STANDARD_DESIGNER
 *
 * Unset, or shorter than 32 characters, means that application has no lane —
 * no default, no development fallback. Not loopback-gated, for the reason
 * `invoke-auth` gives: behind cloudflared every request looks like loopback.
 */
const MIN_TOKEN_LEN = 32;

export function modelServiceTokenVar(app: ModelServiceApp): string {
  return `MODEL_SERVICE_TOKEN_${app.toUpperCase().replace(/-/g, '_')}`;
}

function matches(provided: string, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_TOKEN_LEN) return false;
  if (!provided || provided.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

/** Which application this request's credential belongs to, or null. */
export function modelServiceAppFor(request: Request): ModelServiceApp | null {
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided) return null;
  const seen = new Set<string>();
  let found: ModelServiceApp | null = null;
  for (const app of MODEL_SERVICE_APPS) {
    const secret = env[modelServiceTokenVar(app)];
    // Two applications configured with the same token cannot be told apart, so
    // neither is trusted: refusing is better than booking spend to the wrong one.
    if (secret && secret.length >= MIN_TOKEN_LEN) {
      if (seen.has(secret) && matches(provided, secret)) return null;
      seen.add(secret);
    }
    if (!found && matches(provided, secret)) found = app;
  }
  return found;
}
