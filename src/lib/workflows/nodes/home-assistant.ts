import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getHomeAssistantService } from '../homeassistant/service';
import type { HAOperation, HAOperationResult } from '../homeassistant/types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export { homeAssistantDef } from './home-assistant.def';

type RegistryMeta = { area_id: string | null; area_name: string | null; domain: string; friendly_name: string };

/** Load the cached entity registry (area/domain/friendly_name) as a lookup map.
 *  The live REST /api/states response has state + attributes but NO area, so
 *  query_state/get_history join it with this cached registry per entity_id. */
async function loadRegistryMap(): Promise<Map<string, RegistryMeta>> {
  const map = new Map<string, RegistryMeta>();
  try {
    const [cfg] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    const reg = Array.isArray(cfg?.entityRegistry) ? (cfg.entityRegistry as Array<Record<string, unknown>>) : [];
    for (const e of reg) {
      const id = e.entity_id;
      if (typeof id === 'string') {
        map.set(id, {
          area_id: (e.area_id as string | null) ?? null,
          area_name: (e.area_name as string | null) ?? null,
          domain: (e.domain as string) || id.split('.')[0],
          friendly_name: (e.friendly_name as string) || id,
        });
      }
    }
  } catch {
    // registry unavailable — proceed without area enrichment
  }
  return map;
}

/** Resolve target entity ids: prefer the multi-select `entityIds`, else fall
 *  back to the (already-interpolated) scalar `entityId`. Each `entityIds` entry
 *  is interpolated defensively in case a template was typed into a row. */
function resolveEntityIds(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  scalar: string,
): string[] {
  const arr = Array.isArray(config.entityIds)
    ? config.entityIds
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => interpolateTemplate(x, input))
        .filter((x) => x.trim() !== '')
    : [];
  if (arr.length) return arr;
  return scalar ? [scalar] : [];
}

/** Merge a live queryState result with the cached registry into a stable,
 *  downstream-addressable entity row (input.entities.N.state / .area_name). */
function buildStateRow(entityId: string, qr: HAOperationResult, reg: Map<string, RegistryMeta>) {
  const meta = reg.get(entityId);
  const data = qr.success && qr.data && typeof qr.data === 'object' ? (qr.data as Record<string, unknown>) : null;
  const attributes = (data?.attributes as Record<string, unknown>) ?? {};
  return {
    entity_id: entityId,
    domain: meta?.domain ?? entityId.split('.')[0],
    area_id: meta?.area_id ?? null,
    area_name: meta?.area_name ?? null,
    friendly_name: (attributes.friendly_name as string) ?? meta?.friendly_name ?? entityId,
    state: data ? ((data.state as string) ?? null) : null,
    attributes,
    ...(qr.success ? {} : { error: qr.error ?? 'query failed' }),
  };
}

export const homeAssistantExecutor: NodeExecutor = {
  type: 'home-assistant',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as HAOperation | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' }, rowCount: 1 };
    }

    const service = getHomeAssistantService();
    const entityId = interpolateTemplate((config.entityId as string) || '', input);

    switch (operation) {
      case 'query_state': {
        const ids = resolveEntityIds(config, input, entityId);
        if (ids.length === 0) return { output: { success: false, error: 'No entity selected' }, rowCount: 1 };
        const reg = await loadRegistryMap();
        const results = await Promise.all(ids.map((id) => service.queryState(id)));
        const entities = ids.map((id, i) => buildStateRow(id, results[i], reg));
        return { output: { success: true, entities, count: entities.length }, rowCount: entities.length };
      }

      case 'call_service': {
        const domain = interpolateTemplate((config.domain as string) || '', input) || entityId.split('.')[0];
        const svc = interpolateTemplate((config.service as string) || '', input);
        if (!domain || !svc) return { output: { success: false, error: 'domain and service are required' }, rowCount: 1 };
        let serviceData: Record<string, unknown> | undefined;
        const rawData = interpolateTemplate((config.serviceData as string) || '', input);
        if (rawData) {
          try { serviceData = JSON.parse(rawData); } catch { serviceData = undefined; }
        }
        if (context.dryRun) {
          return {
            output: {
              simulated: true,
              would_call: { domain, service: svc, entity_id: entityId || undefined, data: serviceData },
            },
            rowCount: 1,
            logs: [`[dry-run] would call HA service ${domain}.${svc} on ${entityId || '(no entity)'}`],
          };
        }
        const result = await service.callService(domain, svc, entityId || undefined, serviceData);
        return { output: result, rowCount: 1 };
      }

      case 'fire_event': {
        const eventType = interpolateTemplate((config.eventType as string) || '', input);
        if (!eventType) return { output: { success: false, error: 'No event_type configured' }, rowCount: 1 };
        let eventData: Record<string, unknown> | undefined;
        const rawEvent = interpolateTemplate((config.eventData as string) || '', input);
        if (rawEvent) {
          try { eventData = JSON.parse(rawEvent); } catch { eventData = undefined; }
        }
        if (context.dryRun) {
          return {
            output: {
              simulated: true,
              would_call: { domain: 'event', service: eventType, entity_id: undefined, data: eventData },
            },
            rowCount: 1,
            logs: [`[dry-run] would fire HA event ${eventType}`],
          };
        }
        const result = await service.fireEvent(eventType, eventData);
        return { output: result, rowCount: 1 };
      }

      case 'get_history': {
        const ids = resolveEntityIds(config, input, entityId);
        if (ids.length === 0) return { output: { success: false, error: 'No entity selected' }, rowCount: 1 };
        const start = interpolateTemplate((config.historyStart as string) || '', input) || undefined;
        const end = interpolateTemplate((config.historyEnd as string) || '', input) || undefined;
        const reg = await loadRegistryMap();
        const results = await Promise.all(ids.map((id) => service.getHistory(id, start, end)));
        const entities = ids.map((id, i) => {
          const meta = reg.get(id);
          const r = results[i];
          return {
            entity_id: id,
            domain: meta?.domain ?? id.split('.')[0],
            area_id: meta?.area_id ?? null,
            area_name: meta?.area_name ?? null,
            friendly_name: meta?.friendly_name ?? id,
            history: r.success ? r.data : null,
            ...(r.success ? {} : { error: r.error ?? 'history failed' }),
          };
        });
        return { output: { success: true, entities, count: entities.length }, rowCount: entities.length };
      }

      case 'render_template': {
        const template = interpolateTemplate((config.template as string) || '', input);
        if (!template) return { output: { success: false, error: 'No template configured' }, rowCount: 1 };
        const result = await service.renderTemplate(template);
        return { output: result, rowCount: 1 };
      }

      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` }, rowCount: 1 };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in config fields' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const op = config?.operation;
    if (op === 'query_state' || op === 'get_history') {
      const entityProps: Record<string, unknown> =
        op === 'get_history'
          ? { entity_id: { type: 'string' }, domain: { type: 'string' }, area_id: { type: 'string' }, area_name: { type: 'string' }, friendly_name: { type: 'string' }, history: { type: 'array' } }
          : { entity_id: { type: 'string' }, domain: { type: 'string' }, area_id: { type: 'string' }, area_name: { type: 'string' }, friendly_name: { type: 'string' }, state: { type: 'string' }, attributes: { type: 'object' } };
      return {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          count: { type: 'number' },
          entities: { type: 'array', items: { type: 'object', properties: entityProps } },
        },
      };
    }
    return {
      type: 'object',
      properties: { success: { type: 'boolean' }, data: { type: 'object' }, error: { type: 'string' } },
    };
  },
};

