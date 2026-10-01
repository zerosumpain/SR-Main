/**
 * Keeping pi's Codex sign-in alive, from the builder.
 *
 * pi holds its own ChatGPT OAuth credential in `~/.pi/agent/auth.json`, a
 * separate session from the one the Codex bridge keeps in `~/.codex/auth.json`.
 * pi refreshes only when its stored `expires` says so — and the server can
 * refuse a token long before that. On 2026-10-01 the first unattended
 * development run spent its infrastructure retries on `Provided authentication
 * token is expired.` while the file still claimed six days of life; the
 * refresh token behind it was valid throughout, and one manual refresh fixed
 * it. That is exactly the failure the bridge had on 2026-08-31 and fixed in
 * #619 (`packages/jkai-codex-bridge/src/codex-auth.ts`), so this mirrors that
 * module's rules for pi's file format rather than inventing new ones:
 *
 *  - **The token's own `exp` claim decides staleness**, not the stored
 *    `expires` field, and a refresh runs well before it.
 *  - **A refused token is refreshed only if it is still the one on disk.** If
 *    something else already replaced it, that replacement is the one to use;
 *    refreshing again would rotate a live credential for nothing.
 *  - **Never make the credential worse.** A failed refresh leaves the file as
 *    it was; the write is tmp + rename and keeps every field it did not set,
 *    and a refresh token the issuer did not return is never blanked.
 *
 * It does NOT share or copy the bridge's credential. Two sessions refreshing
 * one token family is how each would keep revoking the other.
 */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** pi's credential store. `PI_CODING_AGENT_DIR` is pi's own override. */
export function piAuthFilePath(): string {
  return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'auth.json');
}

/** The OAuth client both Codex clients authenticate as (see the bridge). */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';

/**
 * Refresh this long before the claim runs out. Longer than the bridge's hour
 * because a build iteration can run for thirty minutes on the token it started
 * with, and pi has no way to swap it mid-run.
 */
const REFRESH_MARGIN_MS = 2 * 60 * 60_000;
/** What pi's own `expires` is set to, inside the claim, so pi never thinks it
 *  has longer than the server does. */
const PI_EXPIRY_SLACK_MS = 5 * 60_000;

interface PiCodexEntry { type?: string; access?: string; refresh?: string; expires?: number; accountId?: string; [k: string]: unknown }
type PiAuthFile = Record<string, unknown> & { 'openai-codex'?: PiCodexEntry };

/** The `exp` claim of a JWT, unverified — we are asking when, not whether. */
export function jwtExpiryMs(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const pad = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(pad, 'base64url').toString('utf8')) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export type RefreshReason = 'expiring' | 'rejected' | null;

/**
 * Why this entry should be refreshed now, or null. Pure, so the two triggers
 * and the "someone already replaced it" case can each be pinned by a test.
 */
export function refreshReason(entry: PiCodexEntry | undefined, at: number, rejectedAccess?: string): RefreshReason {
  if (!entry?.refresh || !entry.access) return null;
  if (rejectedAccess !== undefined) return rejectedAccess === entry.access ? 'rejected' : null;
  const expiresAt = jwtExpiryMs(entry.access) ?? (typeof entry.expires === 'number' ? entry.expires : null);
  if (expiresAt === null) return null;
  return expiresAt - at < REFRESH_MARGIN_MS ? 'expiring' : null;
}

/** Merge a token response into the entry. Never blanks a refresh token. */
export function mergeRefreshed(entry: PiCodexEntry, body: { access_token?: string; refresh_token?: string; expires_in?: number }, at: number): PiCodexEntry {
  if (!body.access_token) throw new Error('Codex token refresh returned no access_token');
  const claim = jwtExpiryMs(body.access_token) ?? at + (body.expires_in ?? 3600) * 1000;
  return {
    ...entry,
    access: body.access_token,
    ...(body.refresh_token ? { refresh: body.refresh_token } : {}),
    expires: claim - PI_EXPIRY_SLACK_MS,
  };
}

/**
 * Does this provider failure mean the server refused the credential? Matched
 * on what pi actually surfaces from the Codex API, not on a status alone: a
 * 401 is the common case, but the message is all a `provider_error` carries.
 */
export function isCodexAuthRejection(message: string | null | undefined, httpStatus?: number): boolean {
  if (httpStatus === 401) return true;
  return /token (?:is )?expired|token_expired|authentication token|invalid_token|unauthori[sz]ed|\b401\b/i.test(message ?? '');
}

async function readPiAuth(): Promise<PiAuthFile> {
  return JSON.parse(await readFile(piAuthFilePath(), 'utf8')) as PiAuthFile;
}

/** tmp + rename, mode 0600, every other provider's entry untouched. */
async function writePiAuth(file: PiAuthFile): Promise<void> {
  const path = piAuthFilePath();
  const tmp = join(dirname(path), `.auth.json.builder-${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}

let inFlight: Promise<PiCodexAuthResult> | null = null;

export interface PiCodexAuthResult {
  /** The access token pi will start with — compare against it after a refusal. */
  access: string | null;
  refreshed: RefreshReason;
  /** Set when a refresh was due and failed; the old credential is left in place. */
  error?: string;
}

/**
 * Make pi's Codex credential usable for the next run, and return the token it
 * will use. Pass `rejectedAccess` after the server refused a run's token to
 * force a refresh — honoured only if that token is still on disk.
 *
 * Never throws: a builder that cannot read or refresh the file runs pi as it
 * would have anyway, and pi's own error reaches the build as before.
 */
export function ensurePiCodexAuth(opts: { rejectedAccess?: string } = {}): Promise<PiCodexAuthResult> {
  // Single-flight: two iterations starting together must produce one refresh,
  // or the second would spend the refresh token the first just rotated.
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<PiCodexAuthResult> => {
    let file: PiAuthFile;
    try { file = await readPiAuth(); } catch (error) {
      return { access: null, refreshed: null, error: `pi auth.json unreadable: ${(error as Error).message}` };
    }
    const entry = file['openai-codex'];
    const reason = refreshReason(entry, Date.now(), opts.rejectedAccess);
    if (!entry || !reason) return { access: entry?.access ?? null, refreshed: null };
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: entry.refresh, scope: 'openid profile email' }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        return { access: entry.access ?? null, refreshed: null, error: `Codex token refresh failed (${res.status}): ${detail}` };
      }
      // Re-read before writing: pi itself may have refreshed while we waited,
      // and its entry — or another provider's — must not be overwritten blind.
      const latest = await readPiAuth();
      const current = latest['openai-codex'];
      if (!current || current.access !== entry.access) return { access: current?.access ?? null, refreshed: null };
      const next = mergeRefreshed(current, (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }, Date.now());
      await writePiAuth({ ...latest, 'openai-codex': next });
      return { access: next.access ?? null, refreshed: reason };
    } catch (error) {
      return { access: entry.access ?? null, refreshed: null, error: `Codex token refresh failed: ${(error as Error).message}` };
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}
