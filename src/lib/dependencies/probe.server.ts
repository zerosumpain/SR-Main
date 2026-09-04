import { isAzureStorageEnabled, azExists } from '$lib/storage/azure-blob';
import {
  DEPENDENCIES,
  worstState,
  type DependencyObservation,
  type DependencyState,
} from './catalog';

const TIMEOUT_MS = 8_000;

type Fetcher = typeof fetch;

interface StatusPageComponent {
  name?: string;
  status?: string;
}

interface StatusPagePayload {
  components?: StatusPageComponent[];
}

function observation(
  dependencyId: string,
  state: DependencyState,
  summary: string,
  startedAt: number,
): DependencyObservation {
  return {
    dependencyId,
    state,
    summary,
    checkedAt: new Date(),
    latencyMs: Date.now() - startedAt,
  };
}

function cleanText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function componentState(status: string | undefined): DependencyState {
  switch ((status ?? '').toLowerCase()) {
    case 'operational':
    case 'available':
      return 'green';
    case 'degraded_performance':
    case 'partial_outage':
    case 'under_maintenance':
    case 'degraded':
      return 'amber';
    case 'major_outage':
    case 'offline':
    case 'unavailable':
      return 'red';
    default:
      return 'unknown';
  }
}

/** Scope a large provider page to only the components this estate consumes. */
export function parseStatusPage(
  payload: StatusPagePayload,
  relevant: RegExp,
): { state: DependencyState; summary: string } {
  const components = (payload.components ?? []).filter((component) =>
    relevant.test(component.name ?? ''),
  );
  if (!components.length) return { state: 'unknown', summary: 'Relevant components were not present in the status feed' };

  const bad = components
    .map((component) => ({ ...component, state: componentState(component.status) }))
    .filter((component) => component.state !== 'green');
  const state = worstState(components.map((component) => componentState(component.status)));
  if (!bad.length) return { state: 'green', summary: `${components.length} relevant components operational` };

  return {
    state,
    summary: bad
      .slice(0, 3)
      .map((component) => `${component.name}: ${(component.status ?? 'unknown').replaceAll('_', ' ')}`)
      .join(' · '),
  };
}

export function parseHetznerStatus(html: string): { state: DependencyState; summary: string } {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return { state: 'unknown', summary: 'Hetzner status data was not readable' };

  try {
    const page = JSON.parse(match[1])?.props?.pageProps as {
      systems?: Array<{ '@id'?: string; parent?: string | null; titleEn?: string }>;
      incidents?: { topNotification?: Array<Record<string, unknown>> };
    };
    const systems = new Map((page.systems ?? []).map((system) => [system['@id'], system]));
    const relevantSystem = (id: unknown): boolean => {
      let current = typeof id === 'string' ? systems.get(id) : undefined;
      while (current) {
        if (/cloud|network|datacenter|location/i.test(current.titleEn ?? '')) return true;
        current = current.parent ? systems.get(current.parent) : undefined;
      }
      return false;
    };
    const active = (page.incidents?.topNotification ?? []).filter((incident) =>
      relevantSystem(incident.system),
    );
    if (!active.length) return { state: 'green', summary: 'Cloud compute and network operational' };

    const red = active.some((incident) =>
      incident.incidentType === 'outage' || /outage|unavailable|unreachable/i.test(String(incident.titleEn ?? '')),
    );
    return {
      state: red ? 'red' : 'amber',
      summary: active.slice(0, 2).map((incident) => String(incident.titleEn ?? 'Active Hetzner incident')).join(' · '),
    };
  } catch {
    return { state: 'unknown', summary: 'Hetzner status data was malformed' };
  }
}

export function parseRssItems(xml: string): Array<{ title: string; description: string }> {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([item]) => ({
    title: cleanText(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    description: cleanText(item.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? ''),
  }));
}

async function fetchWithTimeout(fetcher: Fetcher, url: string): Promise<Response> {
  return fetcher(url, {
    headers: { Accept: 'application/json, application/xml, text/xml, text/html' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function probePublicSite(fetcher: Fetcher): Promise<DependencyObservation> {
  const started = Date.now();
  try {
    const [home, version] = await Promise.all([
      fetchWithTimeout(fetcher, 'https://strangeramblings.com/'),
      fetchWithTimeout(fetcher, 'https://strangeramblings.com/api/version'),
    ]);
    if (!home.ok || !version.ok) {
      return observation('public-site', 'red', `Public checks returned HTTP ${home.status} and ${version.status}`, started);
    }
    const elapsed = Date.now() - started;
    return observation(
      'public-site',
      elapsed >= 3_000 ? 'amber' : 'green',
      elapsed >= 3_000 ? `Public journey answered slowly (${elapsed}ms)` : 'Homepage and live version endpoint answered',
      started,
    );
  } catch (error) {
    return observation('public-site', 'red', `Public journey failed: ${error instanceof Error ? error.message : String(error)}`, started);
  }
}

async function probeStatusPage(
  fetcher: Fetcher,
  dependencyId: string,
  url: string,
  relevant: RegExp,
): Promise<DependencyObservation> {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(fetcher, url);
    if (!response.ok) return observation(dependencyId, 'unknown', `Status feed returned HTTP ${response.status}`, started);
    const parsed = parseStatusPage((await response.json()) as StatusPagePayload, relevant);
    return observation(dependencyId, parsed.state, parsed.summary, started);
  } catch (error) {
    return observation(dependencyId, 'unknown', `Status feed failed: ${error instanceof Error ? error.message : String(error)}`, started);
  }
}

async function probeHetzner(fetcher: Fetcher): Promise<DependencyObservation> {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(fetcher, 'https://status.hetzner.com/');
    if (!response.ok) return observation('hetzner', 'unknown', `Status page returned HTTP ${response.status}`, started);
    const parsed = parseHetznerStatus(await response.text());
    return observation('hetzner', parsed.state, parsed.summary, started);
  } catch (error) {
    return observation('hetzner', 'unknown', `Status page failed: ${error instanceof Error ? error.message : String(error)}`, started);
  }
}

async function probeAzure(fetcher: Fetcher): Promise<DependencyObservation> {
  const started = Date.now();
  const [feed, live] = await Promise.allSettled([
    fetchWithTimeout(fetcher, 'https://rssfeed.azure.status.microsoft/en-us/status/feed/'),
    isAzureStorageEnabled()
      ? azExists(process.env.AZURE_BLOB_CONTAINER || 'drive', '.dependency-healthcheck')
      : Promise.resolve(null),
  ]);

  if (live.status === 'rejected') {
    return observation('azure', 'red', `The configured Blob account did not answer: ${live.reason instanceof Error ? live.reason.message : String(live.reason)}`, started);
  }

  if (feed.status === 'rejected' || !feed.value.ok) {
    if (live.status === 'fulfilled' && live.value !== null) {
      return observation('azure', 'green', 'Configured Blob account answered; public status feed was unavailable', started);
    }
    return observation('azure', 'unknown', 'Neither an account check nor the public status feed was available', started);
  }

  const items = parseRssItems(await feed.value.text()).filter((item) =>
    /blob|storage|uk south|multiple (azure )?services|azure resource manager/i.test(`${item.title} ${item.description}`),
  );
  if (items.length) {
    const text = items.map((item) => item.title).join(' · ');
    const state = /outage|unavailable|down/i.test(text) ? 'red' : 'amber';
    return observation('azure', state, text, started);
  }

  return observation(
    'azure',
    'green',
    live.status === 'fulfilled' && live.value !== null
      ? 'Configured Blob account answered; no relevant Azure incident'
      : 'No relevant Azure incident reported (account check is not configured here)',
    started,
  );
}

async function probeGoogle(fetcher: Fetcher): Promise<DependencyObservation> {
  const started = Date.now();
  try {
    const [incidentsResponse, identityResponse] = await Promise.all([
      fetchWithTimeout(fetcher, 'https://www.google.com/appsstatus/dashboard/incidents.json'),
      fetchWithTimeout(fetcher, 'https://accounts.google.com/.well-known/openid-configuration'),
    ]);
    if (!identityResponse.ok) {
      return observation('google', 'red', `Google identity discovery returned HTTP ${identityResponse.status}`, started);
    }
    if (!incidentsResponse.ok) {
      return observation('google', 'green', 'Google identity answered; Workspace status feed was unavailable', started);
    }
    const incidents = (await incidentsResponse.json()) as Array<Record<string, unknown>>;
    const active = incidents.filter((incident) => {
      if (incident.end) return false;
      const products = JSON.stringify(incident.affected_products ?? '');
      return /gmail|calendar|identity|account|multiple products/i.test(`${incident.service_name ?? ''} ${products}`);
    });
    if (!active.length) return observation('google', 'green', 'Identity answered; no relevant Workspace incident', started);
    const red = active.some((incident) => incident.status_impact === 'SERVICE_OUTAGE' || incident.severity === 'high');
    return observation(
      'google',
      red ? 'red' : 'amber',
      active.slice(0, 2).map((incident) => String(incident.service_name ?? 'Google incident')).join(' · '),
      started,
    );
  } catch (error) {
    return observation('google', 'unknown', `Google checks failed: ${error instanceof Error ? error.message : String(error)}`, started);
  }
}

async function probeOpenRouter(fetcher: Fetcher): Promise<DependencyObservation> {
  const started = Date.now();
  try {
    const [api, statusPage] = await Promise.allSettled([
      fetchWithTimeout(fetcher, 'https://openrouter.ai/api/v1/models'),
      fetchWithTimeout(fetcher, 'https://status.openrouter.ai/'),
    ]);
    if (api.status === 'rejected' || !api.value.ok) {
      const detail = api.status === 'rejected' ? String(api.reason) : `HTTP ${api.value.status}`;
      return observation('openrouter', 'red', `Model API did not answer (${detail})`, started);
    }
    if (statusPage.status === 'fulfilled' && statusPage.value.ok) {
      const html = await statusPage.value.text();
      const banner = cleanText(html.match(/text-white truncate[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
      if (/major outage|unavailable/i.test(banner)) return observation('openrouter', 'red', banner, started);
      if (banner && !/all systems operational/i.test(banner)) return observation('openrouter', 'amber', banner, started);
    }
    return observation('openrouter', 'green', 'Model API answered and no active platform incident was reported', started);
  } catch (error) {
    return observation('openrouter', 'unknown', `OpenRouter checks failed: ${error instanceof Error ? error.message : String(error)}`, started);
  }
}

async function probeBackblaze(fetcher: Fetcher): Promise<DependencyObservation> {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(fetcher, 'https://status.backblaze.com/data/payload.json');
    if (!response.ok) return observation('backblaze', 'unknown', `Status feed returned HTTP ${response.status}`, started);
    const payload = (await response.json()) as { incidents?: Array<Record<string, unknown>> };
    const active = payload.incidents ?? [];
    if (!active.length) return observation('backblaze', 'green', 'All B2 regions operational', started);
    const serialised = JSON.stringify(active);
    const red = /OFFLINE|UNAVAILABLE|SEV0|SEV1/i.test(serialised);
    return observation(
      'backblaze',
      red ? 'red' : 'amber',
      active.slice(0, 2).map((incident) => String(incident.name ?? incident.title ?? 'Active B2 incident')).join(' · '),
      started,
    );
  } catch (error) {
    return observation('backblaze', 'unknown', `Status feed failed: ${error instanceof Error ? error.message : String(error)}`, started);
  }
}

/** One bounded, concurrent pass across every dependency in the catalogue. */
export async function probeDependencies(fetcher: Fetcher = fetch): Promise<DependencyObservation[]> {
  const probes: Record<string, () => Promise<DependencyObservation>> = {
    'public-site': () => probePublicSite(fetcher),
    cloudflare: () => probeStatusPage(
      fetcher,
      'cloudflare',
      'https://www.cloudflarestatus.com/api/v2/summary.json',
      /^(Access|Authoritative DNS|CDN\/Cache|Tunnel|London, United Kingdom - \(LHR\)|Manchester, United Kingdom - \(MAN\))$/i,
    ),
    hetzner: () => probeHetzner(fetcher),
    azure: () => probeAzure(fetcher),
    google: () => probeGoogle(fetcher),
    openrouter: () => probeOpenRouter(fetcher),
    tailscale: () => probeStatusPage(
      fetcher,
      'tailscale',
      'https://status.tailscale.com/api/v2/summary.json',
      /^(API \(.*\)|Certificates|DERP relay servers|Coordination service)$/i,
    ),
    github: () => probeStatusPage(
      fetcher,
      'github',
      'https://www.githubstatus.com/api/v2/summary.json',
      /^(Git Operations|Actions)$/i,
    ),
    backblaze: () => probeBackblaze(fetcher),
  };

  return Promise.all(DEPENDENCIES.map((dependency) => probes[dependency.id]()));
}
