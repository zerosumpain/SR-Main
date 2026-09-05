/**
 * Store the Steam Web API key in the site's secrets vault.
 *
 * The binding is fixed HERE, in code — handle, host, injection, method — and
 * the browser supplies only the value. That is the same rule
 * `$lib/secrets/credential-requests.ts` enforces for the chat modal, and for
 * the same reason: `upsertSecret` rewrites the binding unconditionally, so a
 * caller that could choose the host could re-point a stored key at a host it
 * controls and read it back through an ordinary request.
 *
 * `{kind:'query', name:'key'}` is how Steam's Web API takes its key
 * (`?key=…`), and GET-only because every endpoint the adapter uses is a read.
 */
import { upsertSecret, type SecretMeta } from '$lib/secrets/registry';
import {
  parseSteamWebApiKey,
  STEAM_API_HOST,
  STEAM_WEB_API_SECRET_HANDLE,
} from './credential';

export async function saveSteamWebApiKey(raw: unknown): Promise<SecretMeta> {
  const value = parseSteamWebApiKey(raw);
  return upsertSecret({
    handle: STEAM_WEB_API_SECRET_HANDLE,
    label: 'Steam Web API key',
    source: 'vault',
    value,
    injection: { kind: 'query', name: 'key' },
    allowedHosts: [STEAM_API_HOST],
    allowedMethods: ['GET'],
    notes: 'Application key for the Steam activity source. Entered from /jkai/sources guided setup.',
  });
}
