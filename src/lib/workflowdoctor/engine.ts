// src/lib/workflowdoctor/engine.ts
//
// Compatibility stub. The workflow doctor moved to SR-Workflows on 2026-10-02
// (its worker runs the night and a queued "Run now"; Main reads and drives it
// through `$lib/workflows-client/doctor-client`). This file only keeps the existing
// `startWorkflowDoctor` / `stopWorkflowDoctor` import and calls in
// `src/hooks.server.ts` working until that protected file is next edited: the
// hook edit should delete the import and both calls, and then this file and
// the `src/lib/workflowdoctor/` directory.

/** No-op: SR-Workflows seeds the doctor's datastore collections. */
export function startWorkflowDoctor(): void {}

/** No-op: there is nothing in Main to stop. */
export function stopWorkflowDoctor(): void {}
