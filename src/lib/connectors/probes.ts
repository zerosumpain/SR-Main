// Live probes for every connector the site depends on.
//
// Each probe does the cheapest thing that constitutes real evidence: a token
// refresh, a HEAD on an API, a freshness check against the table the data
// actually lands in. Where a live call is not affordable (a paid search API) the
// probe says so via `live: false` rather than implying it verified something.
import type { ConnectorReport, ConnectorStatus } from './types';

const TIMEOUT_MS = 8000;

/** Wrap a probe so one broken integration cannot take down the dashboard. */
async function guard(
  key: string,
  label: string,
  group: string,
  fn: () => Promise<Omit<ConnectorReport, 'key' | 'label' | 'group' | 'checkedAt' | 'ms'>>,
): Promise<ConnectorReport> {
  const started = Date.now();
  const base = { key, label, group, checkedAt: new Date().toISOString() };
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
      await guard('gmail', 'Gmail', 'Email', async () => ({
        status: 'unconfigured',
        detail: 'no account connected',
        live: false,
        fixUrl: '/admin/connections/gmail',
        fixHint: 'Connect a Google account',
      })),
    ];
  }

  return Promise.all(
    accounts.map((acc) =>
      guard(`gmail:${acc.id}`, `Gmail · ${acc.email}`, 'Email', async () => {
        const { gmailService } = await import('$lib/workflows/gmail/service');
        try {
          const client = await gmailService.getAuthenticatedClient(acc);
          const gmail = gmailService.gmailClientFor(client);
          const profile = await gmail.users.getProfile({ userId: 'me' });
          return {
            status: 'ok' as ConnectorStatus,
            detail: `authenticated — ${profile.data.messagesTotal ?? '?'} messages in mailbox`,
            live: true,
            fixUrl: '/admin/connections/gmail',
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            status: 'broken' as ConnectorStatus,
            detail: msg,
            live: true,
            fixUrl: '/api/gmail/connect',
            fixHint: `Re-authorise ${acc.email} — this repairs the existing account, it does not create a duplicate`,
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
  return guard('home-assistant', 'Home Assistant', 'Home', async () => {
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
  return guard('ha-sensors', 'Home sensors', 'Home', async () => {
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
// ---------------------------------------------------------------------------
async function probeOAuthHealth(service: 'strava' | 'whoop'): Promise<ConnectorReport> {
  const label = service === 'strava' ? 'Strava' : 'Whoop';
  return guard(service, label, 'Health', async () => {
    const { getValidToken } = await import('$lib/health/tokens');
    const token = await getValidToken(service);
    if (!token) {
      return {
        status: 'unconfigured' as ConnectorStatus,
        detail: 'not connected',
        live: false,
        fixUrl: '/admin/connections/health',
        fixHint: `Connect ${label}`,
      };
    }
    return { status: 'ok' as ConnectorStatus, detail: 'token valid (refreshed if needed)', live: true };
  });
}

// ---------------------------------------------------------------------------
// Apple Health — freshness of the table data actually lands in. Deliberately
// NOT health_sync_state: that row is written by the pull-sync job and stays
// months stale while the webhook keeps delivering, so it reports a false alarm.
// ---------------------------------------------------------------------------
async function probeAppleHealth(): Promise<ConnectorReport> {
  return guard('apple-health', 'Apple Health', 'Health', async () => {
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
    if (ageMs > 48 * 3600 * 1000) {
      return {
        status: 'broken' as ConnectorStatus,
        detail,
        live: false,
        fixHint: 'The Apple device webhook has stopped posting',
      };
    }
    if (ageMs > 12 * 3600 * 1000) return { status: 'degraded' as ConnectorStatus, detail, live: false };
    return { status: 'ok' as ConnectorStatus, detail, live: false };
  });
}

// ---------------------------------------------------------------------------
// OpenRouter — the single point of failure for every LLM call on the site.
// ---------------------------------------------------------------------------
async function probeOpenRouter(): Promise<ConnectorReport> {
  return guard('openrouter', 'OpenRouter (all LLM)', 'AI', async () => {
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
  return guard('whatsapp', 'WhatsApp', 'Messaging', async () => {
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
  return guard('tavily', 'Tavily (research)', 'AI', async () => {
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
  const [gmail, ...rest] = await Promise.all([
    probeGmail(),
    probeHomeAssistant(),
    probeHaSensors(),
    probeOAuthHealth('strava'),
    probeOAuthHealth('whoop'),
    probeAppleHealth(),
    probeOpenRouter(),
    probeWhatsApp(),
    probeTavily(),
  ]);
  return [...gmail, ...(rest as ConnectorReport[])];
}
