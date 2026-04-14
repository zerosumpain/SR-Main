import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { whatsappConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

export const GET: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(whatsappConfig)
    .where(eq(whatsappConfig.id, 'default'))
    .limit(1);

  if (!config) {
    return json({
      enabled: false,
      allowedNumbers: [],
      soulMd: '',
      authDir: 'data/whatsapp-auth',
    });
  }

  return json({
    enabled: config.enabled,
    allowedNumbers: config.allowedNumbers,
    soulMd: config.soulMd,
    authDir: config.authDir,
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { enabled, allowedNumbers, soulMd, authDir } = body;

  const values: Record<string, unknown> = { id: 'default', updatedAt: new Date() };
  if (typeof enabled === 'boolean') values.enabled = enabled;
  if (Array.isArray(allowedNumbers)) values.allowedNumbers = allowedNumbers;
  if (typeof soulMd === 'string') values.soulMd = soulMd;
  if (typeof authDir === 'string') values.authDir = authDir;

  await db
    .insert(whatsappConfig)
    .values(values as any)
    .onConflictDoUpdate({
      target: whatsappConfig.id,
      set: {
        ...values,
        id: undefined,
      } as any,
    });

  // Update service allowlist in real-time
  if (Array.isArray(allowedNumbers)) {
    getWhatsAppService().setAllowedNumbers(allowedNumbers);
  }

  return json({ success: true });
};
