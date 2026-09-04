export const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_IDENTITY = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function buildSteamOpenIdUrl(input: { returnTo: string; realm: string }): string {
  const url = new URL(STEAM_OPENID_URL);
  url.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
  url.searchParams.set('openid.mode', 'checkid_setup');
  url.searchParams.set('openid.return_to', input.returnTo);
  url.searchParams.set('openid.realm', input.realm);
  url.searchParams.set('openid.identity', STEAM_IDENTITY);
  url.searchParams.set('openid.claimed_id', STEAM_IDENTITY);
  return url.toString();
}

export function steamIdFromClaimedId(claimedId: string): string | null {
  return CLAIMED_ID_RE.exec(claimedId)?.[1] ?? null;
}

export async function verifySteamOpenIdResponse(
  callbackUrl: URL,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const claimedId = callbackUrl.searchParams.get('openid.claimed_id') ?? '';
  const steamId = steamIdFromClaimedId(claimedId);
  if (!steamId) throw new Error('Steam returned an invalid claimed identity');

  const body = new URLSearchParams();
  for (const [key, value] of callbackUrl.searchParams) {
    if (key.startsWith('openid.')) body.set(key, value);
  }
  body.set('openid.mode', 'check_authentication');
  const response = await fetchFn(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Steam OpenID verification failed with HTTP ${response.status}`);
  const text = await response.text();
  const fields = new Map(
    text.split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf(':');
      return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
    }),
  );
  if (fields.get('is_valid') !== 'true') throw new Error('Steam OpenID assertion was not valid');
  return steamId;
}
