import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

const WORKFLOW_ID = '75bd5bc5-3297-4509-956e-3851b3811491';

export const GET: RequestHandler = async ({ url }) => {
	const range = url.searchParams.get('range') || '7d';
	const hours = range === '30d' ? 720 : range === '90d' ? 2160 : 168;
	const since = new Date(Date.now() - hours * 3600000);

	// Read all data-store keys for this workflow
	const rows = await db
		.select({ key: workflowDataStore.key, value: workflowDataStore.value, updatedAt: workflowDataStore.updatedAt })
		.from(workflowDataStore)
		.where(eq(workflowDataStore.workflowId, WORKFLOW_ID));

	const store: Record<string, any> = {};
	for (const row of rows) {
		store[row.key] = { value: row.value, updatedAt: row.updatedAt };
	}

	// Extract current states (always present)
	const statesData = store['family_presence_states']?.value;
	if (!statesData) {
		return json({ error: 'No data available yet' }, { status: 503 });
	}

	// Current person states
	const currentStates: Record<string, any> = {};
	const names: Record<string, string> = {
		john: 'John',
		katie: 'Katie',
		fintan: 'Fintan',
		jemima: 'Jemima',
		rory: 'Rory'
	};
	for (const [key, name] of Object.entries(names)) {
		const state = statesData.states?.[key] || 'unknown';
		const loc = statesData.locations?.[key] || null;
		currentStates[key] = {
			name,
			state,
			lat: loc?.lat ?? null,
			lon: loc?.lon ?? null,
			lastSeen: statesData.history?.[key]?.slice(-1)[0]?.ts || null
		};
	}

	// Event log (from new data-store key, may not exist yet)
	const eventsData = store['family_presence_events']?.value || [];
	const events = Array.isArray(eventsData)
		? eventsData.filter((e: any) => new Date(e.ts) >= since)
		: [];

	// Computed stats (from new data-store key)
	const statsData = store['family_presence_stats']?.value || null;

	// Geocode cache (from new data-store key)
	const geocacheData = store['family_presence_geocache']?.value || {};

	// Position history for map trails (from current states, legacy format)
	const history: Record<string, any[]> = {};
	for (const key of Object.keys(names)) {
		const rawHistory = statesData.history?.[key] || [];
		history[key] = rawHistory.filter((h: any) => new Date(h.ts) >= since);
	}

	// Trend summaries (legacy, always present)
	const trends: Record<string, any> = statesData.trends || {};

	// If we have the new stats, merge them over the legacy trends
	const perPerson: Record<string, any> = {};
	for (const key of Object.keys(names)) {
		perPerson[key] = {
			...trends[key],
			...(statsData?.perPerson?.[key] || {})
		};
	}

	return json({
		currentStates,
		events,
		stats: statsData,
		perPerson,
		history,
		geocache: geocacheData,
		range,
		since: since.toISOString(),
		updatedAt: store['family_presence_states']?.updatedAt || null
	});
};
