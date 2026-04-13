// Module-level callback for node inspection.
// Set by Canvas, read by BaseNode. Avoids Svelte context propagation issues
// through SvelteFlow's internal component tree.

let inspectCallback: ((nodeId: string) => void) | null = null;

export function setInspectCallback(cb: (nodeId: string) => void): void {
  inspectCallback = cb;
}

export function inspectNode(nodeId: string): void {
  inspectCallback?.(nodeId);
}
