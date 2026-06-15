import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// DB-gated: only runs when a real Postgres is reachable (mirrors delete.integration.test.ts).
const HAS_DB = !!process.env.DATABASE_URL;
const suite = HAS_DB ? describe : describe.skip;

suite('GET /api/deepdive/[id]/clusters (integration)', () => {
	let db: typeof import('$lib/db')['db'];
	let schema: typeof import('$lib/db/schema');
	let GET_handler: typeof import('./+server')['GET'];
	let eq: typeof import('drizzle-orm')['eq'];

	let sessionId: string;
	let sourceId: string;

	// The production `fact.embedding` column is a fixed-dimension pgvector(1536),
	// so embeddings must be 1536-long; pad the meaningful leading components with
	// trailing zeros. The cosine relationships are unchanged by the padding.
	const DIM = 1536;
	const vec = (...lead: number[]): number[] => {
		const v = new Array<number>(DIM).fill(0);
		for (let i = 0; i < lead.length; i++) v[i] = lead[i];
		return v;
	};
	const VEC_A1 = vec(1, 0, 0, 0);
	const VEC_A2 = vec(0.98, 0.04, 0, 0); // ~cosine 0.999 with A1 -> same cluster
	const VEC_B = vec(0, 0, 1, 0); // orthogonal to A* -> singleton

	function makeEvent(id: string, by = 'similarity') {
		return {
			params: { id },
			url: new URL(`http://localhost/api/deepdive/${id}/clusters?by=${by}`),
		} as unknown as Parameters<typeof GET_handler>[0];
	}

	beforeAll(async () => {
		({ db } = await import('$lib/db'));
		schema = await import('$lib/db/schema');
		({ GET: GET_handler } = await import('./+server'));
		({ eq } = await import('drizzle-orm'));

		const [session] = await db
			.insert(schema.researchSessions)
			.values({ topic: 'clusters integration test' })
			.returning({ id: schema.researchSessions.id });
		sessionId = session.id;

		const [source] = await db
			.insert(schema.sources)
			.values({ sessionId, url: 'https://example.test/clusters', title: 'Clusters test source', phase: 0 })
			.returning({ id: schema.sources.id });
		sourceId = source.id;

		await db.insert(schema.facts).values([
			{
				sessionId,
				sourceId,
				content: 'Alpha fact about the policy with high confidence',
				confidence: 0.95,
				embedding: VEC_A1,
			},
			{
				sessionId,
				sourceId,
				content: 'Alpha fact restated slightly differently lower confidence',
				confidence: 0.6,
				embedding: VEC_A2,
			},
			{
				sessionId,
				sourceId,
				content: 'Beta fact about an unrelated topic',
				confidence: 0.7,
				embedding: VEC_B,
			},
		]);
	});

	afterAll(async () => {
		if (!sessionId) return;
		await db.delete(schema.facts).where(eq(schema.facts.sessionId, sessionId));
		await db.delete(schema.sources).where(eq(schema.sources.sessionId, sessionId));
		await db.delete(schema.researchSessions).where(eq(schema.researchSessions.id, sessionId));
	});

	it('returns 404 for a non-existent session', async () => {
		const res = await GET_handler(makeEvent('00000000-0000-0000-0000-000000000000'));
		expect(res.status).toBe(404);
	});

	it('rejects unsupported `by` dimensions with 400', async () => {
		const res = await GET_handler(makeEvent(sessionId, 'theme'));
		expect(res.status).toBe(400);
	});

	it('returns the {factId,clusterId,clusterLabel} contract with correct grouping', async () => {
		const res = await GET_handler(makeEvent(sessionId));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			clusters: Array<{ factId: string; clusterId: string; clusterLabel: string }>;
		};

		// One row per embedded fact.
		expect(body.clusters.length).toBe(3);
		for (const c of body.clusters) {
			expect(typeof c.factId).toBe('string');
			expect(typeof c.clusterId).toBe('string');
			expect(typeof c.clusterLabel).toBe('string');
		}

		// Group the assignments by clusterId.
		const byCluster = new Map<string, string[]>();
		for (const c of body.clusters) {
			if (!byCluster.has(c.clusterId)) byCluster.set(c.clusterId, []);
			byCluster.get(c.clusterId)!.push(c.factId);
		}

		// Exactly two clusters: the two Alpha facts together, Beta alone.
		expect(byCluster.size).toBe(2);
		const sizes = [...byCluster.values()].map((v) => v.length).sort();
		expect(sizes).toEqual([1, 2]);

		// The 2-member cluster's label = the highest-confidence (Alpha A1) content, truncated.
		const bigCluster = [...byCluster.values()].find((v) => v.length === 2)!;
		const labelRow = body.clusters.find((c) => c.factId === bigCluster[0])!;
		expect(labelRow.clusterLabel).toContain('Alpha fact about the policy');
	});

	it('serves the same result from cache on a second call (cache keyed on factCount)', async () => {
		const first = await GET_handler(makeEvent(sessionId));
		const second = await GET_handler(makeEvent(sessionId));
		const a = await first.json();
		const b = await second.json();
		expect(b).toEqual(a);
	});
});
