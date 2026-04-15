import { register } from '../registry-internal';

register({
  name: 'whatsapp_send',
  description: 'Send a WhatsApp message to a phone number. Use this to proactively message the user or send alerts/notifications.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Phone number with country code (e.g. "+447359228511")' },
      message: { type: 'string', description: 'Message text to send' },
    },
    required: ['to', 'message'],
  },
  category: 'WhatsApp',
  handler: async (args) => {
    const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
    const wa = getWhatsAppService();
    const result = await wa.sendMessage(args.to as string, args.message as string);
    return { success: result.sent, data: result };
  },
});
