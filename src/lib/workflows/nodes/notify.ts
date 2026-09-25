import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { notifyOwner, deliveryReport } from '$lib/server/notify';

export { notifyDef } from './notify.def';

const SEVERITIES = new Set(['info', 'warn', 'alert']);

/** "Send to" — an explicit choice outranks the category's route. */
const CHANNELS: Record<string, { whatsapp: boolean; native: boolean } | undefined> = {
  whatsapp: { whatsapp: true, native: false },
  iphone: { whatsapp: false, native: true },
  both: { whatsapp: true, native: true },
};

export const notifyExecutor: NodeExecutor = {
  type: 'notify',

  async execute(input: Record<string, unknown>, config: Record<string, unknown>, context: ExecutionContext): Promise<NodeResult> {
    const text = (key: string) => interpolateTemplate(String(config[key] ?? ''), input).trim();
    const category = String(config.category || 'system');
    const title = text('title') || text('body').split('\n')[0].slice(0, 120);
    const body = text('body');
    if (!title) throw new Error('notify: a title or message is required (supports {{input.field}} templates)');
    const severity = SEVERITIES.has(String(config.severity)) ? (config.severity as 'info' | 'warn' | 'alert') : 'info';
    const result = await notifyOwner({
      category,
      title,
      body,
      url: text('url') || null,
      severity,
      dedupeKey: text('dedupeKey') || null,
      minIntervalSeconds: Number(config.minIntervalSeconds) || undefined,
      data: { workflowId: context.workflowId ?? null, runId: context.runId },
      channels: CHANNELS[String(config.channel ?? 'route')],
    });
    if (result.reason === 'error') throw new Error('notify: the notification could not be raised');
    return { output: { ...deliveryReport(result), category }, rowCount: 1 };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in title/body/url/dedupeKey' };
  },
  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        raised: { type: 'boolean' },
        channels: { type: 'string', description: 'e.g. "WhatsApp + iPhone", "iPhone", "suppressed (duplicate)"' },
        whatsapp: { type: 'string', description: 'sent | failed | off' },
        iphone: { type: 'string', description: 'queued | off' },
        id: { type: 'string' },
        category: { type: 'string' },
      },
    };
  },
};
