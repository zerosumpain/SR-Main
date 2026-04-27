import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getHomeAssistantService } from '../homeassistant/service';
import type { HAOperation } from '../homeassistant/types';

export { homeAssistantDef } from './home-assistant.def';

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
        if (!entityId) return { output: { success: false, error: 'No entity_id configured' }, rowCount: 1 };
        const result = await service.queryState(entityId);
        return { output: result, rowCount: 1 };
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
        if (!entityId) return { output: { success: false, error: 'No entity_id configured' }, rowCount: 1 };
        const start = interpolateTemplate((config.historyStart as string) || '', input) || undefined;
        const end = interpolateTemplate((config.historyEnd as string) || '', input) || undefined;
        const result = await service.getHistory(entityId, start, end);
        return { output: result, rowCount: 1 };
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

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        error: { type: 'string' },
      },
    };
  },
};

