import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

const IMAGE_LIMIT_PER_DAY = Number(process.env.JKAI_IMAGE_LIMIT_PER_DAY ?? 20);
const TTS_CHAR_LIMIT_PER_DAY = Number(process.env.JKAI_TTS_CHAR_LIMIT_PER_DAY ?? 50000);

export interface QuotaResult {
	allowed: boolean;
	reason?: string;
	used: number;
	limit: number;
}

export async function checkImageQuota(
	conversationId: string,
	requested: number,
): Promise<QuotaResult> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const rows = await db
		.select({ count: sql<string>`count(*)` })
		.from(jkaiAttachments)
		.where(
			and(
				eq(jkaiAttachments.conversationId, conversationId),
				eq(jkaiAttachments.kind, 'image'),
				eq(jkaiAttachments.source, 'generated'),
				gte(jkaiAttachments.createdAt, since),
			),
		);
	const used = Number(rows[0]?.count ?? 0);
	if (used + requested > IMAGE_LIMIT_PER_DAY) {
		return {
			allowed: false,
			reason: `image generation limit (${IMAGE_LIMIT_PER_DAY}/24h) would be exceeded`,
			used,
			limit: IMAGE_LIMIT_PER_DAY,
		};
	}
	return { allowed: true, used, limit: IMAGE_LIMIT_PER_DAY };
}

export async function checkTtsQuota(
	conversationId: string,
	charsRequested: number,
): Promise<QuotaResult> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const rows = await db
		.select({ total: sql<string>`coalesce(sum((metadata->>'characters')::int), 0)` })
		.from(jkaiAttachments)
		.where(
			and(
				eq(jkaiAttachments.conversationId, conversationId),
				eq(jkaiAttachments.kind, 'audio'),
				eq(jkaiAttachments.source, 'generated'),
				gte(jkaiAttachments.createdAt, since),
			),
		);
	const used = Number(rows[0]?.total ?? 0);
	if (used + charsRequested > TTS_CHAR_LIMIT_PER_DAY) {
		return {
			allowed: false,
			reason: `TTS char budget (${TTS_CHAR_LIMIT_PER_DAY}/24h) would be exceeded`,
			used,
			limit: TTS_CHAR_LIMIT_PER_DAY,
		};
	}
	return { allowed: true, used, limit: TTS_CHAR_LIMIT_PER_DAY };
}
