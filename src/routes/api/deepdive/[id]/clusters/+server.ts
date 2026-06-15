import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { toVectorLiteral } from '$lib/deepdive/vector';
import { greedyCluster, type ClusterAssignment, type ClusterItem } from '$lib/deepdive/cluster-facts';

// Cosine-similarity threshold for two facts to be "the same cluster".
// Reuses the `1 - (e <=> e)` idiom from credibility.ts; tuned slightly tighter
// (0.82) than the source-agreement pass (0.85) so near-duplicate AND closely
// paraphrased facts group, without collapsing loosely-related topics.
const SIMILARITY_THRESHOLD = 0.82;

// Cap neighbours fetched per fact — clustering is transitive so we don't need
// the full pairwise matrix, just enough edges to connect the components.
const NEIGHBOUR_LIMIT = 25;

// ——— in-memory cache, keyed on (sessionId, factCount) ———
// Recompute only when the number of facts changes (new facts loaded / synthesis
// added/removed facts). Embeddings never leave the server.
interface CacheEntry {
	factCount: number;
	clusters: ClusterAssignment[];
}
const clusterCache = new Map<string, CacheEntry>();

function cacheKey(sessionId: string, factCount: number): string {
	return `${sessionId}:${factCount}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = params.id;
	const by = url.searchParams.get('by') ?? 'similarity';

	if (by !== 'similarity') {
		return json({ error: `Unsupported clustering dimension: ${by}` }, { status: 400 });
	}

	// 404-guard the session (mirrors synthesize/+server.ts).
	const [session] = await db
		.select({ id: researchSessions.id })
		.from(researchSessions)
		.where(eq(researchSessions.id, sessionId));
	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	// Load all clusterable facts (non-counterfactual, embedded).
	const rows = await db
		.select({
			id: facts.id,
			content: facts.content,
			confidence: facts.confidence,
			embedding: facts.embedding,
		})
		.from(facts)
		.where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, false)));

	const embedded = rows.filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);
	const factCount = embedded.length;

	// Serve from cache when the fact set hasn't grown/shrunk.
	const cached = clusterCache.get(cacheKey(sessionId, factCount));
	if (cached) {
		return json({ clusters: cached.clusters });
	}

	if (factCount === 0) {
		const empty: ClusterAssignment[] = [];
		clusterCache.set(cacheKey(sessionId, factCount), { factCount, clusters: empty });
		return json({ clusters: empty });
	}

	// Build the symmetric adjacency via the pgvector cosine query per fact.
	// Reuses the `1 - (embedding <=> vec)::vector > threshold` idiom.
	const adjacency = new Map<string, Set<string>>();
	const addEdge = (a: string, b: string) => {
		if (!adjacency.has(a)) adjacency.set(a, new Set());
		if (!adjacency.has(b)) adjacency.set(b, new Set());
		adjacency.get(a)!.add(b);
		adjacency.get(b)!.add(a);
	};

	for (const fact of embedded) {
		const vectorStr = toVectorLiteral(fact.embedding as number[]);
		const similar = await db.execute(
			sql`SELECT id
          FROM fact
          WHERE session_id = ${sessionId}
            AND id != ${fact.id}
            AND NOT is_counterfactual
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorStr}::vector) > ${SIMILARITY_THRESHOLD}
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${NEIGHBOUR_LIMIT}`,
		);
		for (const r of similar.rows as Array<{ id: string }>) {
			addEdge(fact.id, r.id);
		}
	}

	const isSimilar = (a: string, b: string): boolean =>
		a === b || (adjacency.get(a)?.has(b) ?? false);

	const items: ClusterItem[] = embedded.map((r) => ({
		id: r.id,
		confidence: r.confidence,
		content: r.content,
	}));

	const clusters = greedyCluster(items, isSimilar);
	clusterCache.set(cacheKey(sessionId, factCount), { factCount, clusters });

	return json({ clusters });
};
