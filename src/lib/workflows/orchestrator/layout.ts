import type { Position } from '../types';

interface LayoutNode {
  id: string;
  type: string;
}

interface LayoutEdge {
  source: string;
  target: string;
}

const START_X = 50;
const START_Y = 200;
const X_SPACING = 300;
const Y_SPACING = 180;

export function autoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, Position> {
  const positions = new Map<string, Position>();
  if (nodes.length === 0) return positions;

  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adjacency.set(n.id, []);
    inDegree.set(n.id, 0);
  }

  for (const e of edges) {
    adjacency.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const levels: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < nodes.length) {
    const level: string[] = [];
    for (const n of nodes) {
      if (!processed.has(n.id) && (inDegree.get(n.id) ?? 0) === 0) {
        level.push(n.id);
      }
    }

    if (level.length === 0) {
      for (const n of nodes) {
        if (!processed.has(n.id)) {
          level.push(n.id);
          break;
        }
      }
    }

    for (const id of level) {
      processed.add(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) - 1);
      }
    }

    levels.push(level);
  }

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const level = levels[levelIdx];
    const x = START_X + levelIdx * X_SPACING;
    const levelHeight = (level.length - 1) * Y_SPACING;
    const startY = START_Y - levelHeight / 2;

    for (let nodeIdx = 0; nodeIdx < level.length; nodeIdx++) {
      positions.set(level[nodeIdx], {
        x,
        y: startY + nodeIdx * Y_SPACING,
      });
    }
  }

  return positions;
}
