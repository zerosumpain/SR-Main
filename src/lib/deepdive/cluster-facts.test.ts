import { describe, it, expect } from 'vitest';
import { greedyCluster, truncateLabel, type ClusterItem } from './cluster-facts';

// Each test builds an explicit symmetric adjacency map (id -> Set of similar ids).
// greedyCluster must never read embeddings; it only consults `isSimilar`.
function adjacency(pairs: Array<[string, string]>): (a: string, b: string) => boolean {
	const map = new Map<string, Set<string>>();
	const add = (x: string, y: string) => {
		if (!map.has(x)) map.set(x, new Set());
		map.get(x)!.add(y);
	};
	for (const [a, b] of pairs) {
		add(a, b);
		add(b, a); // symmetric
	}
	return (a, b) => a === b || (map.get(a)?.has(b) ?? false);
}

const item = (id: string, confidence: number, content: string): ClusterItem => ({
	id,
	confidence,
	content,
});

describe('truncateLabel', () => {
	it('returns the content unchanged when within the limit', () => {
		expect(truncateLabel('short fact', 80)).toBe('short fact');
	});

	it('truncates long content at a word boundary and appends an ellipsis', () => {
		const long =
			'The Department for Education published new attainment statistics for the autumn term';
		const out = truncateLabel(long, 40);
		expect(out.length).toBeLessThanOrEqual(41); // 40 chars + the ellipsis char
		expect(out.endsWith('…')).toBe(true);
		// must not split mid-word (the boundary word at maxLen=40 is "published")
		expect(out.replace('…', '').trim().endsWith('published')).toBe(true);
	});

	it('collapses internal whitespace/newlines into single spaces', () => {
		expect(truncateLabel('line one\n\n  line two', 80)).toBe('line one line two');
	});

	it('handles empty content', () => {
		expect(truncateLabel('', 80)).toBe('');
	});
});

describe('greedyCluster', () => {
	it('groups two mutually-similar facts into one cluster', () => {
		const items = [item('a', 0.9, 'alpha'), item('b', 0.7, 'beta')];
		const out = greedyCluster(items, adjacency([['a', 'b']]));
		expect(out.length).toBe(2);
		// both in the same cluster
		const ca = out.find((r) => r.factId === 'a')!;
		const cb = out.find((r) => r.factId === 'b')!;
		expect(ca.clusterId).toBe(cb.clusterId);
	});

	it('keeps a fact with no similar neighbours as a singleton cluster', () => {
		const items = [item('a', 0.9, 'alpha'), item('b', 0.7, 'beta'), item('c', 0.5, 'gamma')];
		// a~b only; c is isolated
		const out = greedyCluster(items, adjacency([['a', 'b']]));
		const ca = out.find((r) => r.factId === 'a')!;
		const cc = out.find((r) => r.factId === 'c')!;
		expect(ca.clusterId).not.toBe(cc.clusterId);
		// c is alone in its cluster
		expect(out.filter((r) => r.clusterId === cc.clusterId).length).toBe(1);
	});

	it('representative-linkage: chain a~b, b~c (a≁c) splits into two clusters, NOT one', () => {
		// Under representative-linkage (not single-linkage), a starts c0.
		// b is similar to a (the representative of c0) → joins c0.
		// c is similar to b but NOT a → c0's representative is a, a≁c → c starts c1.
		// This is the CORRECT anti-chaining behaviour. (Single-linkage would give 1 cluster.)
		const items = [item('a', 0.9, 'alpha'), item('b', 0.8, 'beta'), item('c', 0.7, 'gamma')];
		const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
		const ca = out.find((r) => r.factId === 'a')!;
		const cb = out.find((r) => r.factId === 'b')!;
		const cc = out.find((r) => r.factId === 'c')!;
		// a and b share c0; c is in a separate cluster
		expect(ca.clusterId).toBe(cb.clusterId);
		expect(ca.clusterId).not.toBe(cc.clusterId);
		// Two distinct clusters
		expect(new Set(out.map((r) => r.clusterId)).size).toBe(2);
	});

	it('labels every cluster with the truncated content of its highest-confidence member', () => {
		// a~b (rep-linkage: a is c0's rep), b~c but a≁c so c→c1.
		// c0 contains a (0.4) and b (0.95) → label is b's content "TOP confidence member"
		// c1 contains only c (0.6) → label is c's content "mid confidence member"
		const items = [
			item('a', 0.4, 'low confidence member'),
			item('b', 0.95, 'TOP confidence member'),
			item('c', 0.6, 'mid confidence member'),
		];
		const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
		const ra = out.find((r) => r.factId === 'a')!;
		const rb = out.find((r) => r.factId === 'b')!;
		const rc = out.find((r) => r.factId === 'c')!;
		// a and b share c0; their label = the highest-confidence member's content = b's
		expect(ra.clusterLabel).toBe('TOP confidence member');
		expect(rb.clusterLabel).toBe('TOP confidence member');
		// c is alone in c1; its label = its own content
		expect(rc.clusterLabel).toBe('mid confidence member');
	});

	it('assigns stable cluster ids of the form c0, c1, ... in first-seen order', () => {
		const items = [item('a', 0.9, 'alpha'), item('b', 0.7, 'beta'), item('c', 0.5, 'gamma')];
		const out = greedyCluster(items, adjacency([['b', 'c']]));
		// a seen first -> c0 (singleton); b -> c1; c joins b's cluster c1
		const ca = out.find((r) => r.factId === 'a')!;
		const cb = out.find((r) => r.factId === 'b')!;
		const cc = out.find((r) => r.factId === 'c')!;
		expect(ca.clusterId).toBe('c0');
		expect(cb.clusterId).toBe('c1');
		expect(cc.clusterId).toBe('c1');
	});

	it('returns one row per input fact and preserves all fact ids', () => {
		const items = [item('a', 0.9, 'a'), item('b', 0.8, 'b'), item('c', 0.7, 'c'), item('d', 0.6, 'd')];
		const out = greedyCluster(items, adjacency([['a', 'b'], ['c', 'd']]));
		expect(out.length).toBe(4);
		expect(new Set(out.map((r) => r.factId))).toEqual(new Set(['a', 'b', 'c', 'd']));
	});

	it('returns an empty array for empty input', () => {
		expect(greedyCluster([], adjacency([]))).toEqual([]);
	});

	it('joins a new item to the FIRST existing cluster it matches (greedy), not all of them', () => {
		// a and c are NOT similar, but b is similar to both. b is processed last.
		// a -> c0, c -> c1, then b matches a(c0) first -> b joins c0. a,b in c0; c alone in c1.
		const items = [item('a', 0.9, 'alpha'), item('c', 0.8, 'gamma'), item('b', 0.7, 'beta')];
		const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
		const ca = out.find((r) => r.factId === 'a')!;
		const cb = out.find((r) => r.factId === 'b')!;
		const cc = out.find((r) => r.factId === 'c')!;
		expect(cb.clusterId).toBe(ca.clusterId); // b joined a's cluster
		expect(cc.clusterId).not.toBe(ca.clusterId); // c stayed separate
	});

	// ——— representative-linkage (anti-chaining) tests ———

	it('representative-linkage: chain A~B~C where A≁C must NOT collapse into one cluster', () => {
		// A is similar to B, B is similar to C, but A is NOT similar to C.
		// Under representative-linkage (compare to first member, not all members),
		// when C arrives it checks only the representative (A in c0, B in c1).
		// C is similar to B (c1's representative if B started c1)... wait — let's
		// set up so the representative for c0 is A (not similar to C):
		// A → c0 (representative: A), B → similar to A → joins c0 (representative still A)
		// C → similar to B but NOT A → c0 rep is A, NOT similar → starts c1
		const items = [
			item('A', 0.9, 'Topic about economics'),
			item('B', 0.8, 'Topic bridging economics and sports'),
			item('C', 0.7, 'Topic about sports'),
		];
		// A~B, B~C, but A≁C
		const out = greedyCluster(items, adjacency([['A', 'B'], ['B', 'C']]));
		const ra = out.find((r) => r.factId === 'A')!;
		const rc = out.find((r) => r.factId === 'C')!;
		// With representative-linkage: A starts c0. B joins c0 (similar to A, the rep).
		// C checks c0's rep (A): A≁C → does NOT join. C starts c1.
		expect(ra.clusterId).not.toBe(rc.clusterId);
	});

	it('representative-linkage: B joins cluster whose representative it IS similar to', () => {
		// A~B~C where A IS similar to C too — all three should still group together.
		const items = [
			item('A', 0.9, 'Economics policy'),
			item('B', 0.8, 'Fiscal policy'),
			item('C', 0.7, 'Tax reform'),
		];
		// A~B, B~C, and A~C
		const out = greedyCluster(items, adjacency([['A', 'B'], ['B', 'C'], ['A', 'C']]));
		const ids = new Set(out.map((r) => r.clusterId));
		expect(ids.size).toBe(1); // all in one cluster
	});

	it('representative is the FIRST member added (insertion order), not the highest confidence', () => {
		// D (low confidence) starts c0. E (high confidence, similar to D) joins c0.
		// F is similar to E but NOT to D (the representative). F must NOT join c0.
		const items = [
			item('D', 0.2, 'Low confidence representative'),
			item('E', 0.9, 'High confidence, similar to D'),
			item('F', 0.8, 'Similar to E but not D'),
		];
		// D~E, E~F, D≁F
		const out = greedyCluster(items, adjacency([['D', 'E'], ['E', 'F']]));
		const rd = out.find((r) => r.factId === 'D')!;
		const rf = out.find((r) => r.factId === 'F')!;
		expect(rd.clusterId).not.toBe(rf.clusterId);
	});
});
