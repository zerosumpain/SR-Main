import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

const WORKFLOW_ID = '75bd5bc5-3297-4509-956e-3851b3811491';

const EARTH_R = 6371; // km
const CLUSTER_RADIUS_M = 200; // metres

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) ** 2;
	return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

	// Simple greedy clustering: assign each point to nearest existing cluster within radius,
	// or start a new cluster.
	interface Cluster {
		lat: number;
		lon: number;
		points: typeof points;
	}
	const clusters: Cluster[] = [];

	for (const p of points) {
		let bestIdx = -1;
		let bestDist = Infinity;
		for (let i = 0; i < clusters.length; i++) {
			const d = haversineKm(p.lat, p.lon, clusters[i].lat, clusters[i].lon) * 1000;
			if (d < CLUSTER_RADIUS_M && d < bestDist) {
				bestDist = d;
				bestIdx = i;
			}
		}
		if (bestIdx >= 0) {
			clusters[bestIdx].points.push(p);
			// Update centroid (running average)
			const c = clusters[bestIdx];
			const n = c.points.length;
			c.lat = c.lat + (p.lat - c.lat) / n;
			c.lon = c.lon + (p.lon - c.lon) / n;
		} else {
			clusters.push({ lat: p.lat, lon: p.lon, points: [p] });
		}
	}

	// Reverse-geocode each cluster centroid via geocache
	return clusters
		.map((c) => {
			const name = nearestGeocacheName(c.lat, c.lon, geocache) || `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;
			const persons = [...new Set(c.points.map((p) => p.person))];
			return { name, lat: c.lat, lon: c.lon, visits: c.points.length, persons, avgDwell: 0 };
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
	let bestDist = 0.5; // km — max 500m match
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
