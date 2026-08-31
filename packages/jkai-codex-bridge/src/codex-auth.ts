/**
 * The Codex OAuth credential, and keeping it alive.
 *
 * The SDK transport never needed this: it spawned the `codex` binary, which
 * owns `~/.codex/auth.json` and refreshes the token as a side effect of being
 * run. Talking to the Responses API directly means the bridge is now the only
 * thing touching that file, so refresh becomes ours. The access token lasts
 * about a week — long enough that a broken refresh would look fine for days and
 * then take chat down on a quiet Sunday, which is why it is a real module with
 * tests rather than three lines inside the transport.
 *
 * Two rules shape the design:
 *
 * 1. **The file is the source of truth, not our memory.** Anything else on the
 *    box that runs `codex` will refresh the token and rewrite the file. We
 *    re-read whenever the mtime changes so we pick that up instead of clinging
 *    to a copy we refreshed ourselves.
 * 2. **Never make the credential worse.** A failed refresh leaves the existing
 *    token in place and is retried later; we only fail hard once the token we
 *    hold has actually expired. Writing back is atomic (tmp + rename) and
 *    preserves every field we did not set, so a partial write cannot strand the
 *    `codex` CLI without its refresh token.
 */
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** Where the Codex CLI keeps its credential. `CODEX_HOME` mirrors the CLI's own
 *  override so a test (or a second account) can point somewhere else. */
export function authFilePath(): string {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  return join(home, 'auth.json');
}

/** OAuth client the Codex CLI authenticates as. Read out of the shipped `codex`
 *  binary and cross-checked against the `aud` claim on the stored id_token —
 *  refresh is rejected if this does not match the token's issuer. */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';

/** Refresh this long before the token actually dies. Generous on purpose: a
 *  turn that starts inside the window must still finish on the old token, and
 *  the refresh itself needs room to fail and be retried. */
const REFRESH_MARGIN_MS = 60 * 60_000;
/** Below this, the token is treated as unusable rather than merely stale. */
const HARD_EXPIRY_MARGIN_MS = 30_000;

export interface CodexAuth {
  accessToken: string;
  accountId: string;
  /** ms since epoch, from the token's own `exp` claim. */
  expiresAt: number;
}

interface AuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
  [k: string]: unknown;
}

/** Test seam — the expiry logic is entirely about the clock. */
let now = () => Date.now();
export function __setClockForTests(fn: () => number): void {
  now = fn;
  cached = null;
  inFlight = null;
}

/**
 * Read the `exp` claim out of a JWT without verifying it.
 *
 * Deliberately unverified: we are not authenticating the token, we are asking
 * when the issuer said it stops working so we can refresh in time. The server
 * remains the only thing that decides whether it is actually valid.
 */
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

/** Does this token need refreshing before we lean on it again? */
export function needsRefresh(expiresAt: number | null, at: number): boolean {
  if (expiresAt === null) return false; // unreadable exp — leave it alone, let the API judge
  return expiresAt - at < REFRESH_MARGIN_MS;
}

/** Is it too late to use at all? */
export function isUnusable(expiresAt: number | null, at: number): boolean {
  if (expiresAt === null) return false;
  return expiresAt - at < HARD_EXPIRY_MARGIN_MS;
}

/**
 * The server refused a token. Is the copy now on disk that same dead one?
 *
 * This is the question `exp` cannot answer. A token can be refused long before
 * it expires — revoked, rotated on another host, or a session invalidated
 * server-side — and the claim still reads healthy, so `needsRefresh` says no
 * and we hand back the same corpse on every retry. That is not hypothetical:
 * on 2026-08-31 the VPS held a token the API rejected as `token_expired` while
 * its own claim had a week left, and the bridge re-sent it for hours because
 * nothing could talk it into refreshing.
 *
 * Compared against the file rather than our cache on purpose: if the token on
 * disk has already moved on, another process refreshed while we were failing
 * and theirs is the one to use — refreshing again would rotate a live
 * credential for nothing.
 */
export function rejectedTokenIsCurrent(rejected: string | undefined, current: string | undefined): boolean {
  return rejected !== undefined && current !== undefined && rejected === current;
}

let cached: { auth: CodexAuth; mtimeMs: number } | null = null;
let inFlight: Promise<CodexAuth> | null = null;

async function readAuthFile(): Promise<{ file: AuthFile; mtimeMs: number }> {
  const path = authFilePath();
  const [raw, st] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  return { file: JSON.parse(raw) as AuthFile, mtimeMs: st.mtimeMs };
}

/** tmp + rename, so a crash mid-write cannot leave a truncated credential. */
async function writeAuthFile(file: AuthFile): Promise<void> {
  const path = authFilePath();
  const tmp = join(dirname(path), `.auth.json.bridge-${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}

async function refresh(file: AuthFile): Promise<AuthFile> {
  const refreshToken = file.tokens?.refresh_token;
  if (!refreshToken) throw new Error('auth.json has no refresh_token — run `codex login --device-auth`');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`codex token refresh failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  };
  if (!body.access_token) throw new Error('codex token refresh returned no access_token');

  // Merge rather than replace. The refresh token usually rotates, but if the
  // issuer chose not to return one, the old one is still the live one — writing
  // `undefined` over it would lock the account out of every future refresh.
  return {
    ...file,
    tokens: {
      ...file.tokens,
      access_token: body.access_token,
      ...(body.refresh_token ? { refresh_token: body.refresh_token } : {}),
      ...(body.id_token ? { id_token: body.id_token } : {}),
    },
    last_refresh: new Date(now()).toISOString(),
  };
}

function toAuth(file: AuthFile): CodexAuth {
  const accessToken = file.tokens?.access_token;
  const accountId = file.tokens?.account_id;
  if (!accessToken) throw new Error('auth.json has no access_token — run `codex login --device-auth`');
  if (!accountId) throw new Error('auth.json has no account_id — run `codex login --device-auth`');
  return { accessToken, accountId, expiresAt: jwtExpiryMs(accessToken) ?? 0 };
}

/**
 * The credential to send on the next Responses call.
 *
 * Single-flight: a burst of concurrent turns that all arrive inside the refresh
 * window must produce ONE refresh, not one per turn — the token endpoint
 * rotates the refresh token, so a stampede would have racers writing each
 * other's tokens over the file and invalidating the survivor.
 *
 * Pass `rejectedToken` when the API has answered 401 for a token, to refresh a
 * credential the clock still believes in. Give it the exact token that failed,
 * never a bare flag: a 401 from a stale in-flight request must not rotate a
 * token some other turn has already replaced.
 */
export async function getCodexAuth(opts: { rejectedToken?: string } = {}): Promise<CodexAuth> {
  const pending = inFlight;
  if (pending) return pending;

  const { file, mtimeMs } = await readAuthFile();

  // The server has overruled the expiry claim, so the clock no longer gets a
  // vote: refresh even though `needsRefresh` would say we are fine.
  const refused = rejectedTokenIsCurrent(opts.rejectedToken, file.tokens?.access_token);

  // Someone else (the `codex` CLI, another process) may have refreshed since we
  // last looked; the file always wins over our cache.
  if (!refused && cached && cached.mtimeMs === mtimeMs && !needsRefresh(cached.auth.expiresAt, now())) {
    return cached.auth;
  }

  const current = toAuth(file);
  if (!refused && !needsRefresh(current.expiresAt, now())) {
    cached = { auth: current, mtimeMs };
    return current;
  }

  inFlight = (async () => {
    try {
      const updated = await refresh(file);
      await writeAuthFile(updated);
      const auth = toAuth(updated);
      const st = await stat(authFilePath());
      cached = { auth, mtimeMs: st.mtimeMs };
      return auth;
    } catch (err) {
      // A refresh failure is not automatically fatal — the token we already
      // hold is usually good for hours yet, and the next call will try again.
      // Only a token that is actually dead stops the request, and one the
      // server has just refused is dead whatever its claim says: carrying on
      // with it would return the same 401 while hiding the reason.
      if (refused || isUnusable(current.expiresAt, now())) throw err;
      console.warn(
        '[codex-auth] refresh failed, continuing on the existing token:',
        err instanceof Error ? err.message : err,
      );
      cached = { auth: current, mtimeMs };
      return current;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Drop the cache so the next call re-reads from disk. For tests and for the
 *  401 path, where the server has told us our copy is stale. */
export function invalidateCodexAuth(): void {
  cached = null;
}
