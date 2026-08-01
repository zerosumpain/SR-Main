/**
 * Minimal type for the platform.call interface used across the codebase.
 * The actual implementation is injected at runtime by the platform.
 */
export type PlatformCall = (
  tool: string,
  name: string,
  args?: Record<string, unknown>
) => Promise<unknown>;
