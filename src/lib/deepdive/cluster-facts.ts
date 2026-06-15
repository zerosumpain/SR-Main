/**
 * Pure greedy cosine-threshold clustering over a list of facts.
 *
 * The SQL/pgvector similarity pass lives in the route handler; this module is
 * deliberately database-free so it can be unit-tested in isolation. The caller
 * builds a symmetric `isSimilar(a, b)` predicate (an adjacency derived from the
 * `1 - (e <=> e) > threshold` query) and passes it in.
 *
 * Algorithm (representative-linkage, single greedy pass, first-seen order):
 *   - For each item, find the FIRST existing cluster whose REPRESENTATIVE
 *     (its first member, i.e. the item that started the cluster) is similar
 *     to the incoming item. Join that cluster.
 *   - Otherwise start a new cluster with this item as its representative.
 *
 * Using the representative instead of any-member prevents single-linkage
 * chaining: a chain A~B~C where A≁C will NOT collapse into one cluster,
 * because C only checks the representative (A) of the existing cluster, not
 * the later-added member B.
 *
 * Cluster ids are `c0`, `c1`, ... in first-created order.
 * Cluster label = a short topic phrase derived from the highest-confidence
 * member's content (truncated to DEFAULT_LABEL_LEN at a word boundary).
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
	/** The first member ever added — serves as the cluster representative. */
	representative: ClusterItem;
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
		// Representative-linkage: compare incoming item to each cluster's
		// REPRESENTATIVE (its first member) only — not to all members.
		// This prevents single-linkage chaining where A~B and B~C would
		// incorrectly collapse A and C (A≁C) into one cluster.
		let joined: WorkingCluster | undefined;
		for (const cluster of clusters) {
			if (isSimilar(item.id, cluster.representative.id)) {
				joined = cluster;
				break;
			}
		}
		if (joined) {
			joined.members.push(item);
		} else {
			clusters.push({ id: `c${nextId++}`, representative: item, members: [item] });
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
