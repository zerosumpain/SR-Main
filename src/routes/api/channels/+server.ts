import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { channels } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

type ChannelConfig = Record<string, unknown>;

function computeStatus(kind: string, config: ChannelConfig): { status: string; detail?: Record<string, unknown> } {
  if (kind === 'whatsapp') {
    const state = getWhatsAppService().getState();
    return { status: state.status, detail: { connectedNumber: state.connectedNumber } };
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

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(channels).orderBy(desc(channels.createdAt));
  const withStatus = rows.map((row) => {
    const { status, detail } = computeStatus(row.kind, (row.config as ChannelConfig) || {});
    return { ...row, status, statusDetail: detail };
  });
  return json({ channels: withStatus });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { kind, name, enabled, config } = body ?? {};
  if (kind !== 'whatsapp' && kind !== 'email') {
    throw error(400, 'Invalid kind — must be whatsapp or email');
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw error(400, 'Name is required');
  }

  const [row] = await db
    .insert(channels)
    .values({
      kind,
      name: name.trim(),
      enabled: typeof enabled === 'boolean' ? enabled : true,
      config: (config && typeof config === 'object') ? config : {},
    })
    .returning();

  return json({ channel: row });
};
