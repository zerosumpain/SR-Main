import { createHash, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';

function fixedDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * True when the request carries `Bearer <configured>`, compared in constant
 * time. False when nothing is configured — for a route with a second way in
 * (an owner session); a route with no other way in uses `assertBearerSecret`.
 */
export function hasBearerSecret(request: Request, configured: string | undefined): boolean {
  if (!configured) return false;
  const auth = request.headers.get('authorization') ?? '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return Boolean(supplied) && timingSafeEqual(fixedDigest(configured), fixedDigest(supplied));
}

/** Require a configured bearer credential and compare it in constant time. */
export function assertBearerSecret(
  request: Request,
  configured: string | undefined,
  name: string,
): void {
  if (!configured) throw error(503, `${name} is not configured`);
  if (!hasBearerSecret(request, configured)) {
    throw error(401, `Invalid or missing ${name}`);
  }
}

/** Parse a JSON body without allowing an endpoint-specific oversized payload. */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw error(413, 'Request body too large');
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let raw = '';
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw error(413, 'Request body too large');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } catch (cause) {
    if (typeof cause === 'object' && cause && 'status' in cause) throw cause;
    throw error(400, 'Request body is not valid UTF-8');
  } finally {
    reader.releaseLock();
  }
}

export async function readLimitedJson<T>(request: Request, maxBytes: number): Promise<T> {
  const raw = await readLimitedText(request, maxBytes);
  try {
    return (raw ? JSON.parse(raw) : {}) as T;
  } catch {
    throw error(400, 'Invalid JSON');
  }
}
