/**
 * Stub for SvelteKit's $env/dynamic/private virtual module.
 * Used when running standalone scripts via tsx outside the SvelteKit runtime.
 * Reads env vars from process.env (populated by dotenv in the calling script).
 */
export const env: Record<string, string | undefined> = process.env as Record<string, string | undefined>;
