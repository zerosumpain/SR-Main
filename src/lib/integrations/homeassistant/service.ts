import type { HAArea, HAEntity, HAOperationResult, HAStateResponse } from './types';

export class HomeAssistantService {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  setConfig(url: string, token: string): void {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  /** The singleton starts as an empty local placeholder until it is booted. */
  isConfigured(): boolean {
    return this.token.trim().length > 0;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<HAOperationResult> {
    try {
      const res = await fetch(`${this.url}${path}`, {
        method: options.method || 'GET',
        headers: this.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        // Home Assistant is on the home LAN; unreachable must not hang the run.
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return { success: false, error: `HA API error: ${res.status} ${res.statusText}` };
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        return { success: true, data };
      }

      const text = await res.text();
      return { success: true, data: { result: text } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async queryState(entityId: string): Promise<HAOperationResult> {
    return this.request(`/api/states/${entityId}`);
  }

  async queryAllStates(): Promise<HAOperationResult> {
    return this.request('/api/states');
  }

  async callService(
    domain: string,
    service: string,
    entityId?: string,
    data?: Record<string, unknown>,
  ): Promise<HAOperationResult> {
    const body: Record<string, unknown> = { ...data };
    if (entityId) body.entity_id = entityId;
    return this.request(`/api/services/${domain}/${service}`, { method: 'POST', body });
  }

  async fireEvent(eventType: string, data?: Record<string, unknown>): Promise<HAOperationResult> {
    return this.request(`/api/events/${eventType}`, { method: 'POST', body: data || {} });
  }

  async getHistory(
    entityId: string,
    start?: string,
    end?: string,
  ): Promise<HAOperationResult> {
    const startTime = start || new Date(Date.now() - 86400000).toISOString();
    let path = `/api/history/period/${startTime}?filter_entity_id=${entityId}`;
    if (end) path += `&end_time=${end}`;
    return this.request(path);
  }

  async renderTemplate(template: string): Promise<HAOperationResult> {
    return this.request('/api/template', { method: 'POST', body: { template } });
  }

  async testConnection(): Promise<HAOperationResult> {
    return this.request('/api/');
  }

  parseEntityRegistry(states: HAStateResponse[]): HAEntity[] {
    return states.map((s) => ({
      entity_id: s.entity_id,
      domain: s.entity_id.split('.')[0],
      friendly_name:
        (s.attributes as Record<string, unknown>)?.friendly_name as string ||
        s.entity_id.split('.')[1].replace(/_/g, ' '),
      area_id: null,
      area_name: null,
      device_id: null,
      state: s.state,
    }));
  }

  /**
   * Fetch the entity list WITH real area/device mapping via a single Jinja
   * template render over /api/template. The REST /api/states endpoint carries
   * NO registry data (so parseEntityRegistry below nulls area/device); HA's
   * template functions area_id()/area_name()/device_id() resolve it. Every
   * value is piped through `to_json` so the rendered text is directly
   * JSON-parseable (verified against the live instance). Returns area-aware
   * HAEntity[]; an entity with a device but no assigned area gets area_id=null.
   */
  async fetchRegistryEntities(): Promise<HAEntity[]> {
    const template =
      '[{% for s in states %}' +
      '{"entity_id":{{ s.entity_id | to_json }},' +
      '"domain":{{ s.domain | to_json }},' +
      '"name":{{ s.name | to_json }},' +
      '"state":{{ s.state | to_json }},' +
      '"device_id":{{ device_id(s.entity_id) | to_json }},' +
      '"area_id":{{ area_id(s.entity_id) | to_json }},' +
      '"area_name":{{ area_name(s.entity_id) | to_json }}}' +
      '{{ "," if not loop.last }}{% endfor %}]';

    const result = await this.renderTemplate(template);
    if (!result.success) throw new Error(result.error || 'HA template render failed');

    // /api/template returns text/plain, so request() wraps it as { result }.
    const raw =
      result.data && typeof result.data === 'object' && 'result' in result.data
        ? String((result.data as { result: unknown }).result)
        : typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data);

    let rows: Array<Record<string, unknown>>;
    try {
      rows = JSON.parse(raw);
    } catch {
      throw new Error('HA template result was not valid JSON');
    }
    if (!Array.isArray(rows)) throw new Error('HA template result was not an array');

    return rows.map((r) => {
      const entityId = String(r.entity_id ?? '');
      return {
        entity_id: entityId,
        domain: (r.domain as string) || entityId.split('.')[0] || 'unknown',
        friendly_name:
          (r.name as string) ||
          entityId.split('.').slice(1).join('.').replace(/_/g, ' ') ||
          entityId,
        area_id: (r.area_id as string | null) ?? null,
        area_name: (r.area_name as string | null) ?? null,
        device_id: (r.device_id as string | null) ?? null,
        state: r.state == null ? '' : String(r.state),
      };
    });
  }

  async syncRegistries(): Promise<{ entities: HAEntity[]; areas: HAArea[]; entityCount: number }> {
    let entities: HAEntity[];
    try {
      // Preferred: registry-aware fetch (real area/device mapping).
      entities = await this.fetchRegistryEntities();
    } catch (err: unknown) {
      // Fallback: legacy states-only parse (no area data) so a template
      // failure never leaves the registry empty.
      console.error(
        '[ha] registry template fetch failed, falling back to /api/states:',
        err instanceof Error ? err.message : err,
      );
      const result = await this.queryAllStates();
      if (!result.success || !Array.isArray(result.data)) {
        throw new Error(result.error || 'Failed to fetch states');
      }
      entities = this.parseEntityRegistry(result.data);
    }

    // Derive the area list from the distinct (area_id, area_name) pairs the
    // entities now carry — no separate render needed.
    const areaMap = new Map<string, string>();
    for (const e of entities) {
      if (e.area_id) areaMap.set(e.area_id, e.area_name || e.area_id);
    }
    const areas: HAArea[] = Array.from(areaMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { entities, areas, entityCount: entities.length };
  }
}

let _instance: HomeAssistantService | null = null;

export function getHomeAssistantService(): HomeAssistantService {
  if (!_instance) {
    _instance = new HomeAssistantService('http://localhost:8123', '');
  }
  return _instance;
}

export function initHomeAssistantService(url: string, token: string): HomeAssistantService {
  _instance = new HomeAssistantService(url, token);
  return _instance;
}
