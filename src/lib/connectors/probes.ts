// Live probes for every connector the site depends on.
//
// Each probe does the cheapest thing that constitutes real evidence: a token
// refresh, a HEAD on an API, a freshness check against the table the data
// actually lands in. Where a live call is not affordable (a paid search API) the
// probe says so via `live: false` rather than implying it verified something.
import type { ConnectorReport, ConnectorStatus, ConnectorTier } from './types';

const TIMEOUT_MS = 8000;

/** Wrap a probe so one broken integration cannot take down the dashboard. */
async function guard(
  key: string,
  label: string,
  group: string,
  tier: ConnectorTier,
  fn: () => Promise<Omit<ConnectorReport, 'key' | 'label' | 'group' | 'tier' | 'checkedAt' | 'ms'>>,
): Promise<ConnectorReport> {
  const started = Date.now();
  const base = { key, label, group, tier, checkedAt: new Date().toISOString() };
  try {
    const result = await fn();
    return { ...base, ...result, ms: Date.now() - started };
  } catch (err) {
    return {
      ...base,
      status: 'broken' as ConnectorStatus,
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
      live: true,
      ms: Date.now() - started,
    };
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function agoLabel(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// ---------------------------------------------------------------------------
// Gmail — attempt a real token refresh. This is also self-healing: a successful
// refresh resets `status` to 'active', so an account marked auth_expired by a
// transient failure repairs itself the next time this page is opened.
// ---------------------------------------------------------------------------
async function probeGmail(): Promise<ConnectorReport[]> {
  const { db } = await import('$lib/db');
  const { gmailAccounts } = await import('$lib/db/schema');
  const accounts = await db.select().from(gmailAccounts);

  if (!accounts.length) {
    return [
      await guard('gmail', 'Gmail', 'Email', 'account', async () => ({
        status: 'unconfigured',
        detail: 'no account connected',
        live: false,
        impact: 'No mail triggers, no intel sweep, no mail the assistant can read or send',
        fixUrl: '/admin/connections/gmail',
        fixHint: 'Connect a Google account',
        actions: [{ kind: 'link', target: '/api/gmail/connect', label: 'Connect', primary: true }],
      })),
    ];
  }

  return Promise.all(
    accounts.map((acc) =>
      guard(`gmail:${acc.id}`, `Gmail · ${acc.email}`, 'Email', 'account', async () => {
        const { gmailService } = await import('$lib/workflows/gmail/service');
        // Re-authorising is a consent redirect, so it has to be a real
        // navigation rather than a form post.
        const reconnect = {
          kind: 'link' as const,
          target: '/api/gmail/connect',
          label: 'Reconnect',
          primary: true,
        };
        const impact = 'Mail triggers, the intel sweep and anything that sends mail all stall';
        try {
          const client = await gmailService.getAuthenticatedClient(acc);
          const gmail = gmailService.gmailClientFor(client);
          const profile = await gmail.users.getProfile({ userId: 'me' });
          return {
            status: 'ok' as ConnectorStatus,
            detail: `authenticated — ${profile.data.messagesTotal ?? '?'} messages in mailbox`,
            live: true,
            lastOkAt: new Date().toISOString(),
            impact,
            fixUrl: '/admin/connections/gmail',
            actions: [
              { kind: 'submit', target: 'gmailTest', label: 'Test fetch', busyLabel: 'Fetching…' },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            status: 'broken' as ConnectorStatus,
            detail: msg,
            live: true,
            impact,
            fixUrl: '/api/gmail/connect',
            fixHint: `Re-authorise ${acc.email} — this repairs the existing account, it does not create a duplicate`,
            actions: [reconnect],
          };
        }
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Home Assistant — GET /api/ with the stored token.
// ---------------------------------------------------------------------------
async function probeHomeAssistant(): Promise<ConnectorReport> {
  return guard('home-assistant', 'Home Assistant', 'Home', 'service', async () => {
    const { db } = await import('$lib/db');
    const { homeAssistantConfig } = await import('$lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [cfg] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);

    if (!cfg?.token) {
      return {
        status: 'unconfigured' as ConnectorStatus,
        detail: 'no token stored',
        live: false,
        fixUrl: '/admin/connections',
        fixHint: 'Add a long-lived access token',
      };
    }

    const res = await fetchWithTimeout(`${cfg.url.replace(/\/$/, '')}/api/`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    if (!res.ok) {
      return {
        status: 'broken' as ConnectorStatus,
        detail: `${cfg.url} returned ${res.status} ${res.statusText}`,
        live: true,
        fixHint: 'Check the Tailscale route and that the token is still valid',
      };
    }
    const entities = Array.isArray(cfg.entityRegistry) ? cfg.entityRegistry.length : 0;
    return {
      status: 'ok' as ConnectorStatus,
      detail: `${cfg.url} reachable — ${entities} entities in the cached registry`,
      live: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Home Assistant sensors — entities a workflow depends on can go `unavailable`
// while HA itself is perfectly healthy, which is invisible above.
// ---------------------------------------------------------------------------
async function probeHaSensors(): Promise<ConnectorReport> {
  return guard('ha-sensors', 'Home sensors', 'Home', 'service', async () => {
    const { db } = await import('$lib/db');
    const { homeAssistantConfig } = await import('$lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [cfg] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    if (!cfg?.token) {
      return { status: 'unconfigured' as ConnectorStatus, detail: 'Home Assistant not configured', live: false };
    }

    const res = await fetchWithTimeout(`${cfg.url.replace(/\/$/, '')}/api/states`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    if (!res.ok) {
      return { status: 'broken' as ConnectorStatus, detail: `states API returned ${res.status}`, live: true };
    }
    const states = (await res.json()) as Array<{ entity_id: string; state: string; attributes?: Record<string, unknown> }>;
    const measuring = states.filter((s) => {
      const dc = s.attributes?.device_class;
      return dc === 'temperature' || dc === 'humidity';
    });
    const dead = measuring.filter((s) => s.state === 'unavailable' || s.state === 'unknown');

    if (!measuring.length) {
      return { status: 'degraded' as ConnectorStatus, detail: 'no temperature/humidity sensors registered', live: true };
    }
    if (dead.length === measuring.length) {
      return {
        status: 'broken' as ConnectorStatus,
        detail: `all ${measuring.length} temperature/humidity sensors are unavailable`,
        live: true,
        fixHint: 'The sensor integration is down in Home Assistant',
      };
    }
    if (dead.length) {
      return {
        status: 'degraded' as ConnectorStatus,
        detail: `${measuring.length - dead.length} of ${measuring.length} reporting · dead: ${dead.map((d) => d.entity_id).join(', ')}`,
        live: true,
        fixHint: 'Re-pair or remove the dead sensors in Home Assistant',
      };
    }
    return { status: 'ok' as ConnectorStatus, detail: `${measuring.length} sensors reporting`, live: true };
  });
}

// ---------------------------------------------------------------------------
// Strava / Whoop — getValidToken performs a real refresh when expired.
//
// A valid token is NOT the same as a working sync, and conflating the two is
// how Strava sat broken for five weeks while this page said "ok": the refresh
// kept succeeding and every fetch came back 403. So the token check is only the
// first half — the second half asks the sync-state row whether the last run
// actually landed, and how long ago the last one that did was.
// ---------------------------------------------------------------------------
async function probeOAuthHealth(service: 'strava' | 'whoop'): Promise<ConnectorReport> {
  const label = service === 'strava' ? 'Strava' : 'Whoop';
  const impact =
    service === 'strava'
      ? 'No new activities on /health, and training-load figures drift out of date'
      : 'No new sleep, recovery or strain — readiness and recovery-debt go stale';

  return guard(service, label, 'Health', 'account', async () => {
    const { getValidToken } = await import('$lib/health/tokens');
    const token = await getValidToken(service);
    if (!token) {
      return {
        status: 'unconfigured' as ConnectorStatus,
        detail: 'not connected',
        live: false,
        impact,
        fixUrl: '/admin/connections/health',
        fixHint: `Connect ${label}`,
        actions: [
          { kind: 'link', target: `/api/health/${service}/connect`, label: 'Connect', primary: true },
        ],
      };
    }

    const { db } = await import('$lib/db');
    const { healthSyncState } = await import('$lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [state] = await db
      .select()
      .from(healthSyncState)
      .where(eq(healthSyncState.service, service))
      .limit(1);

    const lastOkAt = state?.lastSuccessfulSyncAt
      ? new Date(state.lastSuccessfulSyncAt * 1000).toISOString()
      : null;
    const okAge = state?.lastSuccessfulSyncAt
      ? Date.now() - state.lastSuccessfulSyncAt * 1000
      : null;
    const since = okAge === null ? 'never synced successfully' : `last good sync ${agoLabel(okAge)}`;

    const resync = {
      kind: 'submit' as const,
      target: 'resync',
      label: 'Resync now',
      busyLabel: 'Syncing…',
      primary: true,
    };
    const reconnect = {
      kind: 'link' as const,
      target: `/api/health/${service}/connect`,
      label: 'Reconnect',
    };

    if (state?.status === 'error') {
      const why = state.errorMessage ?? 'the last sync failed';
      // A 401/403 from the API with a token that just refreshed cleanly means
      // the grant itself is the problem — re-consent, don't retry.
      const authish = /\b(401|403|unauthor|forbidden|invalid[_ ]grant|scope)\b/i.test(why);
      return {
        status: 'broken' as ConnectorStatus,
        detail: `${why} · ${since}`,
        live: true,
        lastOkAt,
        impact,
        fixUrl: '/admin/connections/health',
        fixHint: authish
          ? `The token refreshes but ${label} is rejecting it — reconnect to re-grant access`
          : `Token is valid; retry the sync and check the error above if it repeats`,
        actions: authish
          ? [{ ...reconnect, primary: true }, { ...resync, primary: false }]
          : [resync, reconnect],
      };
    }

    if (okAge !== null && okAge > 3 * 24 * 3600 * 1000) {
      return {
        status: 'degraded' as ConnectorStatus,
        detail: `token valid but ${since}`,
        live: true,
        lastOkAt,
        impact,
        fixUrl: '/admin/connections/health',
        fixHint: 'Nothing has landed for a few days — run a sync to see whether it still works',
        actions: [resync, reconnect],
      };
    }

    return {
      status: 'ok' as ConnectorStatus,
      detail: `token valid (refreshed if needed) · ${since}`,
      live: true,
      lastOkAt,
      impact,
      fixUrl: '/admin/connections/health',
      actions: [{ ...resync, primary: false }, reconnect],
    };
  });
}

// ---------------------------------------------------------------------------
// Apple Health — freshness of the table data actually lands in. Deliberately
// NOT health_sync_state: that row is written by the pull-sync job and stays
// months stale while the webhook keeps delivering, so it reports a false alarm.
// ---------------------------------------------------------------------------
async function probeAppleHealth(): Promise<ConnectorReport> {
  return guard('apple-health', 'Apple Health', 'Health', 'account', async () => {
    const { db } = await import('$lib/db');
    const { appleHealthMetrics } = await import('$lib/db/schema');
    const { sql } = await import('drizzle-orm');
    const [row] = await db
      .select({ latest: sql<number | null>`max(${appleHealthMetrics.date})` })
      .from(appleHealthMetrics);

    if (!row?.latest) {
      return {
        status: 'unconfigured' as ConnectorStatus,
        detail: 'no metrics recorded',
        live: false,
        fixHint: 'Check the Apple device webhook is posting',
      };
    }
    const ageMs = Date.now() - row.latest * 1000;
    const detail = `latest metric ${agoLabel(ageMs)}`;
    const lastOkAt = new Date(row.latest * 1000).toISOString();
    const impact = 'The heartbeat on the landing page, steps and HRV all freeze';
    if (ageMs > 48 * 3600 * 1000) {
      return {
        status: 'broken' as ConnectorStatus,
        detail,
        live: false,
        lastOkAt,
        impact,
        fixHint: 'The Apple device webhook has stopped posting — check the shortcut on the phone',
      };
    }
    if (ageMs > 12 * 3600 * 1000)
      return { status: 'degraded' as ConnectorStatus, detail, live: false, lastOkAt, impact };
    return { status: 'ok' as ConnectorStatus, detail, live: false, lastOkAt, impact };
  });
}

// ---------------------------------------------------------------------------
// Integration credentials (Apple Calendar today, anything node-builder adds
// later). One row per connected account; an adapter with no rows is an
// integration the site can do but you never signed into, which is reported as
// unconfigured rather than broken.
// ---------------------------------------------------------------------------
async function probeIntegrationCredentials(): Promise<ConnectorReport[]> {
  const { listIntegrationAdapters } = await import('$lib/integrations/registry');
  const { db } = await import('$lib/db');
  const { integrationCredentials } = await import('$lib/db/schema');

  const adapters = listIntegrationAdapters();
  if (!adapters.length) return [];
  const rows = await db.select().from(integrationCredentials);

  const pretty = (t: string) => t.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const out: ConnectorReport[] = [];
  for (const adapter of adapters) {
    const type = adapter.integrationType;
    const mine = rows.filter((r) => r.integrationType === type);

    if (!mine.length) {
      out.push(
        await guard(`integration:${type}`, pretty(type), 'Calendar & files', 'account', async () => ({
          status: 'unconfigured' as ConnectorStatus,
          detail: 'available, but no account connected',
          live: false,
          impact: `Any workflow node using ${pretty(type)} will fail at run time`,
          fixUrl: '/admin/connections/credentials',
          fixHint: 'Connect an account',
          actions: [
            { kind: 'link', target: '/admin/connections/credentials', label: 'Connect', primary: true },
          ],
        })),
      );
      continue;
    }

    for (const cred of mine) {
      out.push(
        await guard(
          `integration:${type}:${cred.id}`,
          `${pretty(type)} · ${cred.label}`,
          'Calendar & files',
          'account',
          async () => {
            // Deliberately NOT a live CalDAV call on every page load — the test
            // is one click away and writes its result back to the row, so this
            // reports the last real answer and says so.
            const lastOkAt = cred.lastTestStatus === 'ok' && cred.lastTestedAt
              ? cred.lastTestedAt.toISOString()
              : null;
            const impact = `Any workflow node using ${pretty(type)} will fail at run time`;
            const test = {
              kind: 'submit' as const,
              target: 'testIntegration',
              label: 'Test now',
              busyLabel: 'Testing…',
              primary: true,
            };

            if (cred.lastTestStatus === 'failed') {
              return {
                status: 'broken' as ConnectorStatus,
                detail: cred.lastTestError ?? 'last test failed',
                live: false,
                lastOkAt,
                impact,
                fixUrl: '/admin/connections/credentials',
                fixHint:
                  type === 'apple-calendar'
                    ? 'App-specific passwords are revoked when you change your Apple ID password — generate a new one'
                    : 'Re-enter the credential',
                actions: [
                  test,
                  { kind: 'link', target: '/admin/connections/credentials', label: 'Re-enter' },
                ],
              };
            }
            if (!cred.lastTestedAt) {
              return {
                status: 'degraded' as ConnectorStatus,
                detail: 'connected but never tested',
                live: false,
                lastOkAt,
                impact,
                fixUrl: '/admin/connections/credentials',
                fixHint: 'Run a test so this row means something',
                actions: [test],
              };
            }
            return {
              status: 'ok' as ConnectorStatus,
              detail: `last tested ${agoLabel(Date.now() - cred.lastTestedAt.getTime())} — passed`,
              live: false,
              lastOkAt,
              impact,
              fixUrl: '/admin/connections/credentials',
              actions: [{ ...test, primary: false }],
            };
          },
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// OAuth accounts jkai set up for itself (TrueLayer, PayPal). These trade stored
// credentials for a short-lived access token on every call.
//
// This probe reads stored state ONLY. Forcing an exchange here would be
// actively harmful: TrueLayer rotates its refresh token on every use, so a
// dashboard that refreshed on load would churn the credential on every page
// view — and any write that failed midway would brick the connection. The
// exchange happens on the explicit "Test token exchange" button instead.
// ---------------------------------------------------------------------------
async function probeOAuthSecrets(): Promise<ConnectorReport[]> {
  const { OAUTH_PROVIDERS } = await import('$lib/secrets/oauth-refresh');
  const { db } = await import('$lib/db');
  const { apiSecrets } = await import('$lib/db/schema');

  const rows = await db.select().from(apiSecrets);
  const providers = Object.entries(OAUTH_PROVIDERS) as Array<
    [string, (typeof OAUTH_PROVIDERS)[keyof typeof OAUTH_PROVIDERS]]
  >;

  return Promise.all(
    providers.map(([provider, spec]) =>
      guard(`oauth:${provider}`, spec.label.replace(/ access token.*$/, ''), 'Set up by jkai', 'account', async () => {
        const vault = rows.find((r) => r.handle === spec.vaultHandle);
        const ref = rows.find((r) => r.handle === provider);
        const impact = `Workflows calling ${spec.dataHost} lose their access token`;
        const test = {
          kind: 'submit' as const,
          target: 'testOauthSecret',
          label: 'Test token exchange',
          busyLabel: 'Exchanging…',
          primary: true,
        };

        if (!vault) {
          return {
            status: 'unconfigured' as ConnectorStatus,
            detail: `no "${spec.vaultHandle}" credential stored`,
            live: false,
            impact,
            fixUrl: '/admin/ai/apis',
            fixHint: `Add the vault secret bound to ${spec.tokenHost}`,
          };
        }
        // The ref row is what nodes actually reference; the vault row alone
        // resolves at build time and then fails at run time.
        if (!ref) {
          return {
            status: 'broken' as ConnectorStatus,
            detail: `credentials stored, but no "${provider}" reference row — nodes have nothing to point at`,
            live: false,
            impact,
            fixUrl: '/admin/ai/apis',
            fixHint: `Add the ref-source row for "${provider}" bound to ${spec.dataHost}`,
            actions: [{ kind: 'link', target: '/admin/ai/apis', label: 'Open registry', primary: true }],
          };
        }

        const used = ref.lastUsedAt ?? vault.lastUsedAt;
        const detail = used
          ? `credentials stored · last used ${agoLabel(Date.now() - used.getTime())}`
          : 'credentials stored · never used';
        return {
          status: 'ok' as ConnectorStatus,
          detail,
          live: false,
          lastOkAt: used?.toISOString() ?? null,
          impact,
          fixUrl: '/admin/ai/apis',
          actions: [test],
        };
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// OpenRouter — the single point of failure for every LLM call on the site.
// ---------------------------------------------------------------------------
async function probeOpenRouter(): Promise<ConnectorReport> {
  return guard('openrouter', 'OpenRouter (all LLM)', 'AI', 'service', async () => {
    const { loadKeys } = await import('$lib/deepdive/keys');
    const key = loadKeys().openrouterApiKey;
    if (!key) {
      return {
        status: 'broken' as ConnectorStatus,
        detail: 'no API key — every LLM call on the site will fail',
        live: false,
        fixHint: 'Set OPENROUTER_API_KEY',
      };
    }
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      return {
        status: 'broken' as ConnectorStatus,
        detail: `credits endpoint returned ${res.status} ${res.statusText}`,
        live: true,
        fixHint: res.status === 401 ? 'The key is rejected — rotate it' : 'Check the OpenRouter account',
      };
    }
    const body = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
    const remaining = (body.data?.total_credits ?? 0) - (body.data?.total_usage ?? 0);
    const detail = `key valid — $${remaining.toFixed(2)} credit remaining`;
    if (remaining <= 1) {
      return {
        status: 'broken' as ConnectorStatus,
        detail: `${detail} — LLM calls will start failing`,
        live: true,
        fixHint: 'Top up OpenRouter',
      };
    }
    if (remaining < 5) return { status: 'degraded' as ConnectorStatus, detail, live: true };
    return { status: 'ok' as ConnectorStatus, detail, live: true };
  });
}

// ---------------------------------------------------------------------------
// WhatsApp — the delivery channel for the briefing and every alert, including
// the alert that would tell you this is down.
// ---------------------------------------------------------------------------
async function probeWhatsApp(): Promise<ConnectorReport> {
  return guard('whatsapp', 'WhatsApp', 'Messaging', 'service', async () => {
    const bridge = process.env.WHATSAPP_HERMES_BRIDGE_URL;
    if (!bridge) {
      return {
        status: 'unconfigured' as ConnectorStatus,
        detail: 'WHATSAPP_HERMES_BRIDGE_URL not set — sends run through the in-process client',
        live: false,
      };
    }
    const base = bridge.replace(/\/+$/, '').replace(/\/send$/, '');
    const res = await fetchWithTimeout(`${base}/health`).catch(() => null);
    if (!res || !res.ok) {
      return {
        status: 'broken' as ConnectorStatus,
        detail: `Hermes bridge ${base} unreachable${res ? ` (${res.status})` : ''} — alerts and the briefing cannot be delivered`,
        live: true,
        fixHint: 'Restart jkai-hermes on homeserv',
      };
    }
    return { status: 'ok' as ConnectorStatus, detail: `bridge ${base} reachable`, live: true };
  });
}

// ---------------------------------------------------------------------------
// Tavily — presence only. A live search costs money on every dashboard load.
// ---------------------------------------------------------------------------
async function probeTavily(): Promise<ConnectorReport> {
  return guard('tavily', 'Tavily (research)', 'AI', 'service', async () => {
    const { loadKeys } = await import('$lib/deepdive/keys');
    const key = loadKeys().tavilyApiKey;
    return key
      ? { status: 'ok' as ConnectorStatus, detail: 'key present (not test-searched — searches are billed)', live: false }
      : {
          status: 'broken' as ConnectorStatus,
          detail: 'no key — research returns 0 sources and reports "complete"',
          live: false,
          fixHint: 'Set TAVILY_API_KEY in .env (keys.json is not backed up)',
        };
  });
}

/** Probe everything, concurrently. Never throws. */
export async function probeAll(): Promise<ConnectorReport[]> {
  const [gmail, integrations, oauthSecrets, ...rest] = await Promise.all([
    probeGmail(),
    probeIntegrationCredentials(),
    probeOAuthSecrets(),
    probeHomeAssistant(),
    probeHaSensors(),
    probeOAuthHealth('strava'),
    probeOAuthHealth('whoop'),
    probeAppleHealth(),
    probeOpenRouter(),
    probeWhatsApp(),
    probeTavily(),
  ]);
  return [...gmail, ...integrations, ...oauthSecrets, ...(rest as ConnectorReport[])];
}
