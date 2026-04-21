import type { RequestHandler } from './$types';
import { parseFramePermissiveness, type ProbeResult } from '$lib/webframe/probe-parse';
import { json, error } from '@sveltejs/kit';

const cache = new Map<string, { result: ProbeResult; expires: number }>();
const TTL_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 3000;

export const GET: RequestHandler = async ({ url, fetch }) => {
  const target = url.searchParams.get('url');
  if (!target) throw error(400, 'url required');
  try {
    new URL(target);
  } catch {
    throw error(400, 'invalid url');
  }

  const cached = cache.get(target);
  if (cached && cached.expires > Date.now()) return json(cached.result);

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(target, { method: 'HEAD', signal: ac.signal, redirect: 'follow' });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const result = parseFramePermissiveness(headers, target);
    cache.set(target, { result, expires: Date.now() + TTL_MS });
    return json(result);
  } catch {
    const fallback: ProbeResult = { canFrame: true, reason: 'probe failed, assuming permissive' };
    cache.set(target, { result: fallback, expires: Date.now() + TTL_MS });
    return json(fallback);
  } finally {
    clearTimeout(timeout);
  }
};
