// Pins on the household map that would sit on top of each other, merged into
// one. PURE — pixel positions in, pins out.
//
// Five people at home are five dots within a pixel of each other, and their
// labels used to merge into "F Rory a". Dots closer than `radius` px join one
// pin, at their centre, labelled with every name and the FRESHEST fix time.

export interface ClusterInput {
  subject: string;
  label: string;
  x: number;
  y: number;
  /** ISO time of the fix. */
  at: string;
  isHome: boolean | null;
}

export interface ClusterPin {
  key: string;
  /** "Katie · Fintan · Jemima · Rory" */
  label: string;
  subjects: string[];
  x: number;
  y: number;
  /** The freshest fix among them. */
  at: string;
  /** Home only when every one of them is. */
  isHome: boolean;
}

/** Merge dots less than `radius` px apart. Single-linkage: a chain of close dots is one pin. */
export function clusterDots(dots: readonly ClusterInput[], radius = 28): ClusterPin[] {
  const n = dots.length;
  const parent = dots.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) < radius) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, ClusterInput[]>();
  dots.forEach((d, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(d);
    else groups.set(r, [d]);
  });
  return [...groups.values()].map((g) => ({
    key: g.map((d) => d.subject).join('+'),
    label: g.map((d) => d.label).join(' · '),
    subjects: g.map((d) => d.subject),
    x: g.reduce((s, d) => s + d.x, 0) / g.length,
    y: g.reduce((s, d) => s + d.y, 0) / g.length,
    at: g.reduce((best, d) => (Date.parse(d.at) > Date.parse(best) ? d.at : best), g[0].at),
    isHome: g.every((d) => d.isHome === true),
  }));
}
