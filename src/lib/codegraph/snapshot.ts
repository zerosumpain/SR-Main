export interface StructuralSnapshot {
  version: number; repo: string; revision: string; complete: boolean; fileCount: number; files: string[];
  hashes: Record<string, string>; manifestHash: string;
  edges: Array<{ source: string; target: string; kind: 'imports' | 'tests' | 'references' }>;
  routes: Array<{ path: string; route: string }>;
  dependencies: Array<{ name: string; version: string | null; license: string | null; usedBy: string[] }>;
  unresolved: Array<{ path: string; specifier: string }>; limitations: string[];
}
/** Direction is explicit; historical co-change does not imply a dependency. */
export function impactOf(snapshot: StructuralSnapshot, changed: string[]) {
  const touched = new Set(changed); const dependants = new Set<string>(); const uses = new Set<string>(); const tests = new Set<string>();
  let frontier = new Set(changed);
  for (let hop = 0; hop < 2; hop++) {
    const next = new Set<string>();
    for (const edge of snapshot.edges) {
      if (['imports', 'references'].includes(edge.kind) && frontier.has(edge.target) && !touched.has(edge.source)) { dependants.add(edge.source); next.add(edge.source); }
      if (['imports', 'references'].includes(edge.kind) && touched.has(edge.source)) uses.add(edge.target);
      if ((edge.kind === 'tests' || /\.(test|spec)\./.test(edge.source)) && (touched.has(edge.target) || frontier.has(edge.target))) tests.add(edge.source);
    }
    frontier = next;
  }
  return { changed, uses: [...uses].slice(0, 100), dependants: [...dependants].slice(0, 100), tests: [...tests].slice(0, 100),
    routes: snapshot.routes.filter(r => touched.has(r.path) || dependants.has(r.path)),
    dependencies: snapshot.dependencies.filter(d => d.usedBy.some(p => touched.has(p) || dependants.has(p))),
    missing: changed.filter(p => !snapshot.files.includes(p)),
    coverage: 'Static relationships only. Missing test links mean unknown coverage; run the required repository gate.' };
}
export function diffSnapshots(base: StructuralSnapshot, next: StructuralSnapshot) {
  return [...new Set([...base.files, ...next.files])].filter(p => base.hashes[p] !== next.hashes[p]);
}
