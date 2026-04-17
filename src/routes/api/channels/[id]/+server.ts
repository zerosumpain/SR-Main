import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { channels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

type ChannelConfig = Record<string, unknown>;

function computeStatus(kind: string, config: ChannelConfig): { status: string; detail?: Record<string, unknown> } {
  if (kind === 'whatsapp') {
    const state = getWhatsAppService().getState();
    return { status: state.status, detail: { connectedNumber: state.connectedNumber, qrCode: state.qrCode } };
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

export const GET: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(channels).where(eq(channels.id, params.id)).limit(1);
  if (!row) throw error(404, 'Channel not found');
  const { status, detail } = computeStatus(row.kind, (row.config as ChannelConfig) || {});
  return json({ channel: { ...row, status, statusDetail: detail } });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const [existing] = await db.select().from(channels).where(eq(channels.id, params.id)).limit(1);
  if (!existing) throw error(404, 'Channel not found');

  const updates: Partial<typeof channels.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
  if (body.config && typeof body.config === 'object') updates.config = body.config;

  const [updated] = await db
    .update(channels)
    .set(updates)
    .where(eq(channels.id, params.id))
    .returning();

  // If WhatsApp channel, sync allowed numbers into the live service
  if (updated.kind === 'whatsapp' && body.config && Array.isArray((body.config as any).allowedNumbers)) {
    getWhatsAppService().setAllowedNumbers((body.config as any).allowedNumbers);
  }

  return json({ channel: updated });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(channels).where(eq(channels.id, params.id)).limit(1);
  if (!row) throw error(404, 'Channel not found');
  await db.delete(channels).where(eq(channels.id, params.id));
  return json({ success: true });
};
