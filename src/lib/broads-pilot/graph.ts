// Graph indexing helpers for the Broads Pilot routing engine. Pure.
import type { WaterGraph, GraphEdge } from './types';
import { haversine } from './geo';

export interface AdjEntry {
  edge: GraphEdge;
  to: string;
}

/** Build a bidirectional adjacency list keyed by node id. Each edge is added
 * for both from→to and to→from. Every node gets an entry (possibly empty). */
export function buildAdjacency(graph: WaterGraph): Map<string, AdjEntry[]> {
  const adj = new Map<string, AdjEntry[]>();
  for (const n of graph.nodes) adj.set(n.id, []);

  const push = (from: string, entry: AdjEntry) => {
    let list = adj.get(from);
    if (!list) {
      list = [];
      adj.set(from, list);
    }
    list.push(entry);
  };

  for (const edge of graph.edges) {
    push(edge.from, { edge, to: edge.to });
    push(edge.to, { edge, to: edge.from });
  }
  return adj;
}

/** Id of the graph node closest to (lat,lng) by great-circle distance. */
export function nearestNode(graph: WaterGraph, lat: number, lng: number): string {
  let bestId = '';
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const d = haversine([lat, lng], [n.lat, n.lng]);
    if (d < bestD) {
      bestD = d;
      bestId = n.id;
    }
  }
  return bestId;
}
