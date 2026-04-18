import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';
import { OrchestratorBridge } from '$lib/workflows/whatsapp/orchestrator-bridge';
import { db } from '$lib/db';
import { whatsappConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(whatsappConfig)
    .where(eq(whatsappConfig.id, 'default'))
    .limit(1);

  const authDir = config?.authDir || 'data/whatsapp-auth';
  const service = getWhatsAppService();

  if (config) {
    service.setAllowedNumbers((config.allowedNumbers as string[]) || []);
  }

  const bridge = new OrchestratorBridge(
    (to, text) => service.sendMessage(to, text),
    {
      sendAttachmentFn: (to, att, caption) => service.sendAttachment(to, att, caption),
      typingFn: (to) => service.sendTyping(to),
      typingDoneFn: (to) => service.sendTypingDone(to),
    },
  );

  service.onMessage((msg) => bridge.handleMessage(msg));
  await service.connect(authDir);

  return json({ status: 'connecting' });
};

export const DELETE: RequestHandler = async () => {
  const service = getWhatsAppService();
  await service.disconnect();
  return json({ status: 'disconnected' });
};
