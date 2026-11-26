// A counter every daydream_trail writer in this process moves after it writes,
// so a reader holding a scan of the trail knows when it went stale without
// asking the database. Moving it too often costs a re-read; forgetting to move
// it leaves a reader on rows up to its own time limit old — keep a writer's
// call next to its write.
//
// No imports: the writers (observe, places, privacy) and the reader
// (insights.server) already import each other in a ring.

let generation = 0;
// Set by ./peer-signals.server when this process has a peer (the http web
// app and the worker on the VPS): tells the other process to move ITS counter.
// A hook rather than an import, for the reason above.
let announce: (() => void) | null = null;

/** After an INSERT, UPDATE or DELETE on daydream_trail. */
export function trailChanged(): void {
  generation++;
  announce?.();
}

/** Another process wrote to the trail: stale here too, but not ours to announce. */
export function trailChangedElsewhere(): void {
  generation++;
}

export function onTrailChanged(fn: (() => void) | null): void {
  announce = fn;
}

export function trailGeneration(): number {
  return generation;
}
