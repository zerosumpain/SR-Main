import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * What is left of the ChatGPT subscription that Codex calls bill to.
 *
 * The header can show an OpenRouter figure because OpenRouter sells credit and
 * publishes the balance. A ChatGPT subscription has no balance — it has rate
 * limit WINDOWS, and the only thing that reports them is ChatGPT's own backend,
 * authenticated with the OAuth token `codex login` wrote to ~/.codex/auth.json.
 * There is no platform-API-key path: api.openai.com bills separately and knows
 * nothing about the subscription. That is the same wall that made the bridge
 * necessary — see packages/jkai-codex-bridge.
 *
 * The access token is a 10-day JWT that the Codex CLI refreshes whenever it
 * runs, and the bridge runs it constantly on the same host under the same user,
 * so reading the file is enough. This deliberately does NOT refresh the token
 * itself: refresh tokens rotate, so a second refresher would race the CLI and
 * could invalidate the login for both.
 */
export interface CodexRateWindow {
  /** How much of this window is gone, 0–100. */
  usedPercent: number;
  /** Window length in seconds — 18000 is the 5-hour window, 604800 the weekly. */
  windowSeconds: number;
  /** Epoch ms at which the window rolls over, or null when not reported. */
  resetAt: number | null;
}

export interface CodexUsage {
  /** `plus`, `pro`, `team`… as ChatGPT reports it. */
  planType: string | null;
  /** Every window the account actually has, longest-lived last. */
  windows: CodexRateWindow[];
  /** The window nearest its ceiling — the one worth putting in a header. */
  headline: CodexRateWindow | null;
  /** True once a window is exhausted and calls are being refused. */
  limitReached: boolean;
  /** Pay-as-you-go credit on top of the subscription, USD. Null when the
   *  account has none — which is not the same as zero. */
  creditBalanceUsd: number | null;
  /** Epoch ms the figure was fetched — drives the "as of" tooltip. */
  fetchedAt: number;
}

/** Same cadence as ./openrouter-credits.ts: the /jkai layout load runs on every
 *  navigation across the hub, so this is cached in-process rather than hit per
 *  page view. */
const TTL_MS = 60_000;
/** Shorter re-try window after a failure, so a blip doesn't cost a full TTL. */
const FAILURE_TTL_MS = 15_000;

const USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage';

/** The Codex CLI's own user-agent. This request IS that client — the same
 *  host's Codex login asking the endpoint the CLI's own `/status` asks — and
 *  presenting as anything else scores worse at Cloudflare's edge. The version
 *  inside it is cosmetic and need not track the installed SDK. */
const CODEX_CLI_UA = 'codex_cli_rs/0.147.0';

let cached: { value: CodexUsage | null; expiresAt: number } | null = null;
let inflight: Promise<CodexUsage | null> | null = null;

export function clearCodexUsageCache(): void {
  cached = null;
  inflight = null;
  clearanceCookie = null;
}

/** Honours CODEX_HOME the way the Codex CLI itself does, so a host that keeps
 *  its login somewhere other than ~/.codex still resolves. */
function authPath(): string {
  const base = process.env.CODEX_HOME || join(homedir(), '.codex');
  return join(base, 'auth.json');
}

interface CodexAuth {
  accessToken: string;
  accountId: string | null;
}

async function readCodexAuth(): Promise<CodexAuth | null> {
  try {
    const raw = await readFile(authPath(), 'utf8');
    const parsed = JSON.parse(raw) as {
      tokens?: { access_token?: string; account_id?: string };
    };
    const accessToken = parsed?.tokens?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) return null;
    return { accessToken, accountId: parsed.tokens?.account_id ?? null };
  } catch {
    // No file at all is the ordinary state on a host where `codex login` has
    // never been run. Not worth a warning on every refresh.
    return null;
  }
}

/**
 * Cloudflare's bot-management clearance, held between calls.
 *
 * chatgpt.com is behind Cloudflare Bot Management, which challenges a cold
 * request from this process: the first call gets `403` with
 * `cf-mitigated: challenge` and a `__cf_bm` cookie, and the same request
 * carrying that cookie gets `200`. Browsers and the Codex CLI (reqwest, with a
 * cookie jar) never notice because their HTTP clients keep cookies; Node's
 * fetch has no jar, so without this every single call would be a 403.
 *
 * Verified 2026-08-09 across fresh processes — it is reproducible, not a blip.
 * Keeping the cookie means the challenge is paid once per cookie lifetime
 * (~30 min) rather than on every refresh.
 */
let clearanceCookie: string | null = null;

/**
 * One request, retried once if Cloudflare challenges it.
 *
 * Deliberately a single retry with no loop: if the cookie we are handed still
 * doesn't satisfy the edge, something has changed and hammering it is the wrong
 * answer — the caller degrades to the last good reading instead.
 */
async function fetchThroughChallenge(headers: Record<string, string>): Promise<Response> {
  const send = (cookie: string | null) =>
    fetch(USAGE_URL, {
      headers: cookie ? { ...headers, cookie } : headers,
      signal: AbortSignal.timeout(6_000),
    });

  let res = await send(clearanceCookie);
  if (res.status !== 403 || res.headers.get('cf-mitigated') !== 'challenge') return res;

  const issued = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  // Drain the challenge page so the connection can be reused for the retry.
  await res.text().catch(() => undefined);
  if (!issued) return res;

  clearanceCookie = issued;
  res = await send(clearanceCookie);
  // A cookie that is refused is worse than none — drop it so the next refresh
  // starts clean rather than replaying a stale clearance forever.
  if (res.status === 403) clearanceCookie = null;
  return res;
}

interface RawWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

function toWindow(raw: RawWindow | null | undefined): CodexRateWindow | null {
  if (!raw) return null;
  const usedPercent = Number(raw.used_percent);
  const windowSeconds = Number(raw.limit_window_seconds);
  if (!Number.isFinite(usedPercent) || !Number.isFinite(windowSeconds)) return null;
  // `reset_at` is epoch SECONDS on the wire; everything downstream is ms.
  const resetAtSec = Number(raw.reset_at);
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    windowSeconds,
    resetAt: Number.isFinite(resetAtSec) && resetAtSec > 0 ? resetAtSec * 1000 : null,
  };
}

async function fetchUsage(): Promise<CodexUsage | null> {
  const auth = await readCodexAuth();
  if (!auth) return null;

  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${auth.accessToken}`,
      accept: 'application/json',
      'user-agent': CODEX_CLI_UA,
      originator: 'codex_cli_rs',
    };
    // Optional. Personal accounts answer without it; a workspace login needs it
    // to pick which account's quota is being asked about.
    if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;

    const res = await fetchThroughChallenge(headers);
    if (!res.ok) {
      console.warn(
        res.status === 401
          ? '[codex-usage] 401 — the stored Codex token has expired; run `codex login` on this host'
          : res.status === 403
            ? '[codex-usage] 403 — still challenged after retrying with the clearance cookie'
            : `[codex-usage] /usage returned ${res.status}`,
      );
      return null;
    }
    const body = (await res.json()) as {
      plan_type?: string;
      rate_limit?: {
        limit_reached?: boolean;
        primary_window?: RawWindow | null;
        secondary_window?: RawWindow | null;
      };
      credits?: { has_credits?: boolean; balance?: string | number };
    };

    const windows = [
      toWindow(body?.rate_limit?.primary_window),
      toWindow(body?.rate_limit?.secondary_window),
    ]
      .filter((w): w is CodexRateWindow => w !== null)
      .sort((a, b) => a.windowSeconds - b.windowSeconds);

    // Nothing usable came back — treat it as a failure so the caller keeps the
    // last good reading rather than rendering an empty meter.
    if (windows.length === 0) return null;

    const balance = Number(body?.credits?.balance);
    return {
      planType: typeof body?.plan_type === 'string' ? body.plan_type : null,
      windows,
      // The window nearest its ceiling is the one that will actually stop you,
      // so that is the one a one-line header should carry.
      headline: windows.reduce((worst, w) => (w.usedPercent > worst.usedPercent ? w : worst)),
      limitReached: body?.rate_limit?.limit_reached === true,
      creditBalanceUsd: body?.credits?.has_credits && Number.isFinite(balance) ? balance : null,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[codex-usage] fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Current subscription position, or null when there is no Codex login on this
 * host and nothing has ever been fetched.
 *
 * A failed refresh carries the LAST GOOD figure forward rather than nulling it,
 * for the same reason ./openrouter-credits.ts does: a meter that blanks every
 * time a request times out is worse than one a few minutes stale.
 */
export async function getCodexUsage(): Promise<CodexUsage | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inflight) return inflight;

  inflight = fetchUsage()
    .then((fresh) => {
      const value = fresh ?? cached?.value ?? null;
      cached = { value, expiresAt: Date.now() + (fresh ? TTL_MS : FAILURE_TTL_MS) };
      return value;
    })
    .catch(() => cached?.value ?? null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
