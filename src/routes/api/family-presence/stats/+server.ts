import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
// The daydream trail engine owns the clustering geometry; this endpoint had its
// own inline copy of the same 200 m greedy clusterer, which is exactly how the
// two surfaces would one day disagree about what counts as one place.
import { clusterPoints, haversineKm } from '$lib/daydream/cluster';
import { CLUSTER_RADIUS_M } from '$lib/daydream/types';

const WORKFLOW_ID = '75bd5bc5-3297-4509-956e-3851b3811491';

/** Cluster all GPS history points per person, geocode via geocache. */
function clusterHistoryPoints(
	history: Record<string, any[]>,
	geocache: Record<string, string>
): Array<{ name: string; lat: number; lon: number; visits: number; avgDwell: number; persons: string[] }> {
	// Flatten every non-home point with its person
	const points: Array<{ lat: number; lon: number; person: string; ts: string }> = [];
	for (const [person, entries] of Object.entries(history)) {
		for (const e of entries) {
			if (e.lat != null && e.lon != null && e.state !== 'home') {
				points.push({ lat: e.lat, lon: e.lon, person, ts: e.ts });
			}
		}
	}
	if (points.length === 0) return [];

	const clusters = clusterPoints(
		points.map((p, idx) => ({ idx, lat: p.lat, lon: p.lon, ts: new Date(p.ts) })),
		CLUSTER_RADIUS_M,
	);

	// Reverse-geocode each cluster centroid via geocache
	return clusters
		.map((c) => {
			const name = nearestGeocacheName(c.lat, c.lon, geocache) || `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;
			const persons = [...new Set(c.members.map((idx) => points[idx].person))];
			return { name, lat: c.lat, lon: c.lon, visits: c.members.length, persons, avgDwell: 0 };
		})
		.sort((a, b) => b.visits - a.visits)
		.slice(0, 20);
}

/** Find the closest geocache entry to a lat/lon within ~500m. */
function nearestGeocacheName(
	lat: number,
	lon: number,
	geocache: Record<string, string>
): string | null {
	let bestName: string | null = null;
	let bestDist = 1.0; // km — max 1km match (geocache keys are 2-decimal, ~11km boxes)
	for (const [coords, name] of Object.entries(geocache)) {
		const [gcLat, gcLon] = coords.split(',').map(Number);
		if (isNaN(gcLat) || isNaN(gcLon)) continue;
		const d = haversineKm(lat, lon, gcLat, gcLon);
		if (d < bestDist) {
			bestDist = d;
			bestName = name;
		}
	}
	return bestName;
}

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

	// Patterns & anomalies (from new data-store key, populated by trend engine)
	const patternsData = store['family_presence_patterns']?.value || null;

	// Anomalies from stats (computed per-person by the workflow)
	const anomalies: any[] = [];
	if (statsData?.perPerson) {
		for (const [key, ps] of Object.entries(statsData.perPerson as Record<string, any>)) {
			if (ps?.anomalies?.length) {
				for (const a of ps.anomalies) {
					anomalies.push({ person: key, ...a });
				}
			}
		}
	}
	// Also surface from patterns data if available
	if (patternsData?.anomalies) {
		for (const a of patternsData.anomalies) {
			if (!anomalies.some(x => x.person === a.person && x.ts === a.ts && x.type === a.type)) {
				anomalies.push(a);
			}
		}
	}
	anomalies.sort((a: any, b: any) => (b.zScore || 0) - (a.zScore || 0));

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

	// ── Destination clustering ──
	// Cluster GPS history points by ~200m, then reverse-geocode via geocache.
	const destinations = clusterHistoryPoints(history, geocacheData);

	return json({
		currentStates,
		events,
		stats: statsData,
		perPerson,
		history,
		geocache: geocacheData,
		patterns: patternsData?.patterns || null,
		anomalies,
		destinations,
		range,
		since: since.toISOString(),
		updatedAt: store['family_presence_states']?.updatedAt || null
	});
};
