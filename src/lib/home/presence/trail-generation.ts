// A counter every daydream_trail writer in this process moves after it writes,
// so a reader holding a scan of the trail knows when it went stale without
// asking the database. Moving it too often costs a re-read; forgetting to move
// it leaves a reader on rows up to its own time limit old — keep a writer's
// call next to its write.
//
// No imports: the writers (observe, places, privacy) and the reader
// (insights.server) already import each other in a ring.

let generation = 0;

/** After an INSERT, UPDATE or DELETE on daydream_trail. */
export function trailChanged(): void {
  generation++;
}

export function trailGeneration(): number {
  return generation;
}
