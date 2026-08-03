// `archiver` ships no bundled type declarations and we don't want to pull in
// @types/archiver just for the /api/files/download-zip endpoint. A minimal
// ambient declaration keeps svelte-check/tsc happy (the module is used as `any`).
declare module 'archiver';

/**
 * `d3-force-3d` ships no declarations and has no @types package. It mirrors
 * d3-force's API with a third dimension, so the shape below covers what the
 * Intel 3D graph uses rather than declaring the whole module `any` — the
 * simulation handle is the one thing worth keeping typed, since getting
 * `tick()`/`stop()` wrong is a silent hang rather than a compile error.
 */
declare module 'd3-force-3d' {
  interface Force3DSimulation {
    force(name: string, force?: unknown): Force3DSimulation;
    tick(iterations?: number): Force3DSimulation;
    stop(): Force3DSimulation;
    restart(): Force3DSimulation;
    alpha(value?: number): number & Force3DSimulation;
    nodes(nodes?: unknown[]): unknown[] & Force3DSimulation;
    on(event: string, listener: () => void): Force3DSimulation;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceSimulation(nodes?: any[], numDimensions?: number): Force3DSimulation;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceLink(links?: any[]): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceManyBody(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceCenter(x?: number, y?: number, z?: number): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceCollide(radius?: number | ((d: any) => number)): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceX(x?: number | ((d: any) => number)): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceY(y?: number | ((d: any) => number)): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceZ(z?: number | ((d: any) => number)): any;
}
