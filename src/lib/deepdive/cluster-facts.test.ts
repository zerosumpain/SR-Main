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

	it('transitively merges a chain a~b, b~c into one cluster even if a is not directly similar to c', () => {
		const items = [item('a', 0.9, 'alpha'), item('b', 0.8, 'beta'), item('c', 0.7, 'gamma')];
		const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
		const ids = new Set(out.map((r) => r.clusterId));
		expect(ids.size).toBe(1);
	});

	it('labels every cluster with the truncated content of its highest-confidence member', () => {
		const items = [
			item('a', 0.4, 'low confidence member'),
			item('b', 0.95, 'TOP confidence member'),
			item('c', 0.6, 'mid confidence member'),
		];
		const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
		expect(out.every((r) => r.clusterLabel === 'TOP confidence member')).toBe(true);
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
});
