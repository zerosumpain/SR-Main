import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { channels } from '$lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

type ChannelConfig = Record<string, unknown>;

function computeStatus(kind: string, config: ChannelConfig): { status: string } {
  if (kind === 'whatsapp') {
    const state = getWhatsAppService().getState();
    return { status: state.status };
  }
  if (kind === 'email') {
    const provider = (config as any)?.provider;
    const from = (config as any)?.from;
    const providerConfig = (config as any)?.providerConfig;
    const hasCreds = provider && from && providerConfig && Object.keys(providerConfig).length > 0;
    return { status: hasCreds ? 'ready' : 'unconfigured' };
  }
  return { status: 'unknown' };
}

export const load: PageServerLoad = async () => {
  // Seed a default WhatsApp channel if none exist — mirrors the existing singleton.
  const existingWhatsApp = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.kind, 'whatsapp'))
    .limit(1);

  if (existingWhatsApp.length === 0) {
    await db.insert(channels).values({
      kind: 'whatsapp',
      name: 'WhatsApp (default)',
      enabled: true,
      config: {
        allowedNumbers: [],
        authDir: 'data/whatsapp-auth',
      },
    });
  }

  const rows = await db.select().from(channels).orderBy(desc(channels.createdAt));
  const withStatus = rows.map((row) => {
    const { status } = computeStatus(row.kind, (row.config as ChannelConfig) || {});
    return { ...row, status };
  });

  return { channels: withStatus };
};
