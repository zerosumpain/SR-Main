import type { HAEntity, HAOperationResult, HAStateResponse } from './types';

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

  async syncRegistries(): Promise<{ entities: HAEntity[]; entityCount: number }> {
    const result = await this.queryAllStates();
    if (!result.success || !Array.isArray(result.data)) {
      throw new Error(result.error || 'Failed to fetch states');
    }

    const entities = this.parseEntityRegistry(result.data);
    return { entities, entityCount: entities.length };
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
