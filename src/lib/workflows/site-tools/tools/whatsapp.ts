import { register } from '../registry-internal';
import { NOTIFICATION_CATEGORIES } from '$lib/constants/notification-categories';

register({
  name: 'whatsapp_send',
  destructive: true,
  description: 'Send a WhatsApp message to a phone number. Use this to proactively message the user or send alerts/notifications.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Phone number with country code (e.g. "+447700900123")' },
      message: { type: 'string', description: 'Message text to send' },
    },
    required: ['to', 'message'],
  },
  category: 'WhatsApp',
  toolset: 'whatsapp',
  handler: async (args) => {
    const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
    const wa = getWhatsAppService();
    const result = await wa.sendMessage(args.to as string, args.message as string);
    return { success: result.sent, data: result };
  },
});

register({
  name: 'notify_owner',
  description:
    "Notify the owner (John) under a notification category. The category's route decides WhatsApp, the iPhone, both or neither, and the raise is written to the notification ledger. Prefer this over whatsapp_send for anything addressed to the owner. Returns which channels it went to.",
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: NOTIFICATION_CATEGORIES.map((c) => c.id), description: 'Routing category. Default system.' },
      title: { type: 'string', description: 'Short headline' },
      body: { type: 'string', description: 'The message' },
      url: { type: 'string', description: 'Site-relative link, e.g. /health' },
      severity: { type: 'string', enum: ['info', 'warn', 'alert'] },
      dedupeKey: { type: 'string', description: 'Collapse repeats with this key inside the category floor' },
      minIntervalSeconds: { type: 'number', description: 'Not more often than this (combined with the category floor)' },
    },
    required: ['title', 'body'],
  },
  category: 'WhatsApp',
  toolset: 'whatsapp',
  emits: ['notification.raised'],
  handler: async (args) => {
    const { notifyOwner, deliveryReport } = await import('$lib/server/notify');
    const severity = ['info', 'warn', 'alert'].includes(String(args.severity)) ? (args.severity as 'info') : 'info';
    const result = await notifyOwner({
      category: String(args.category || 'system'),
      title: String(args.title ?? ''),
      body: String(args.body ?? ''),
      url: typeof args.url === 'string' ? args.url : null,
      severity,
      dedupeKey: typeof args.dedupeKey === 'string' ? args.dedupeKey : null,
      minIntervalSeconds: Number(args.minIntervalSeconds) || undefined,
    });
    return { success: result.reason !== 'error', data: deliveryReport(result) };
  },
});
