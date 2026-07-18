// src/lib/workflows/site-tools/tools/_datastore-errors.ts
//
// Shared DatastoreError -> ToolResult mapping for the `datastore` and `apis`
// toolsets (underscore prefix = not a tool module; nothing self-registers here).

import { DatastoreError } from '$lib/datastore';
import type { ToolResult } from '../registry-internal';

/** Map an access-layer error to a friendly `{success:false}` tool result. */
export function toToolError(err: unknown, fallback = 'datastore error'): ToolResult {
  if (err instanceof DatastoreError || (err as { name?: string })?.name === 'DatastoreError') {
    const e = err as DatastoreError;
    return { success: false, error: e.message, data: { code: e.code } };
  }
  return { success: false, error: err instanceof Error ? err.message : fallback };
}
