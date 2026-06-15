/**
 * Pure greedy cosine-threshold clustering over a list of facts.
 *
 * The SQL/pgvector similarity pass lives in the route handler; this module is
 * deliberately database-free so it can be unit-tested in isolation. The caller
 * builds a symmetric `isSimilar(a, b)` predicate (an adjacency derived from the
 * `1 - (e <=> e) > threshold` query) and passes it in.
 *
 * Algorithm (single greedy pass, first-seen order):
 *   - For each item, find the FIRST existing cluster containing a member that
 *     is similar to the item. Join that cluster (no re-balancing).
 *   - Otherwise start a new cluster.
 * This yields transitive merges along chains while staying O(N * clusters)
 * and deterministic for a fixed input order.
 *
 * Cluster ids are `c0`, `c1`, ... in first-created order.
 * Cluster label = truncated content of the highest-confidence member.
 */

export interface ClusterItem {
	id: string;
	/** Higher = more confident; used to pick the cluster label. */
	confidence: number;
	/** Fact content; the highest-confidence member's content becomes the label. */
	content: string;
}

export interface ClusterAssignment {
	factId: string;
	clusterId: string;
	clusterLabel: string;
}

const DEFAULT_LABEL_LEN = 80;

/**
 * Normalise whitespace and truncate to `maxLen` chars at a word boundary,
 * appending a single-character ellipsis (…) when truncated.
 */
export function truncateLabel(content: string, maxLen = DEFAULT_LABEL_LEN): string {
	const normalised = content.replace(/\s+/g, ' ').trim();
	if (normalised.length <= maxLen) return normalised;
	const slice = normalised.slice(0, maxLen);
	const lastSpace = slice.lastIndexOf(' ');
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trim()}…`;
}

interface WorkingCluster {
	id: string;
	members: ClusterItem[];
}

export function greedyCluster(
	items: ClusterItem[],
	isSimilar: (a: string, b: string) => boolean,
	labelLen = DEFAULT_LABEL_LEN,
): ClusterAssignment[] {
	const clusters: WorkingCluster[] = [];
	let nextId = 0;

	for (const item of items) {
		// Greedy: join the first cluster with any member similar to this item.
		let joined: WorkingCluster | undefined;
		for (const cluster of clusters) {
			if (cluster.members.some((m) => isSimilar(item.id, m.id))) {
				joined = cluster;
				break;
			}
		}
		if (joined) {
			joined.members.push(item);
		} else {
			clusters.push({ id: `c${nextId++}`, members: [item] });
		}
	}

	const out: ClusterAssignment[] = [];
	for (const cluster of clusters) {
		// Label = highest-confidence member's truncated content.
		const top = cluster.members.reduce((best, m) =>
			m.confidence > best.confidence ? m : best,
		);
		const label = truncateLabel(top.content, labelLen);
		for (const m of cluster.members) {
			out.push({ factId: m.id, clusterId: cluster.id, clusterLabel: label });
		}
	}
	return out;
}
