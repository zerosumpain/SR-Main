/**
 * The Steam Web API key, as the owner pastes it.
 *
 * Pure on purpose — no database, no environment — so the parse rule is unit
 * tested and the server module that stores the key stays a thin wrapper.
 *
 * Steam issues a 32-character upper-case hex key at
 * https://steamcommunity.com/dev/apikey. People paste it with whitespace, a
 * trailing newline, or the "Key: " prefix the page shows; all of that is
 * tolerated. Anything that is not 32 hex characters afterwards is refused
 * rather than stored, because a wrong key would only be discovered on the
 * first sync, several steps later, as a 403 from Steam.
 */

export const STEAM_WEB_API_SECRET_HANDLE = 'steam-web-api';
export const STEAM_WEB_API_ENV = 'STEAM_WEB_API_KEY';
export const STEAM_API_HOST = 'api.steampowered.com';
export const STEAM_API_KEY_URL = 'https://steamcommunity.com/dev/apikey';

const KEY_RE = /^[A-F0-9]{32}$/;

export class SteamCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SteamCredentialError';
  }
}

/** Normalise a pasted key, or throw a message the form can show verbatim. */
export function parseSteamWebApiKey(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new SteamCredentialError('Paste the key Steam shows on its API key page');
  }
  const cleaned = raw
    .trim()
    .replace(/^key\s*[:=]\s*/i, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!cleaned) throw new SteamCredentialError('Paste the key Steam shows on its API key page');
  if (!KEY_RE.test(cleaned)) {
    throw new SteamCredentialError(
      'A Steam Web API key is 32 letters and digits (A–F, 0–9). Check the paste and try again.',
    );
  }
  return cleaned;
}
