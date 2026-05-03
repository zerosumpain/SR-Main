/**
 * Drop-in replacement for SvelteKit's `$env/dynamic/private` virtual module
 * when bundling the jkai-builder. SvelteKit's version dynamically loads .env
 * via vite/Kit; outside that runtime there's no virtual module to resolve.
 * Plain `process.env` is the same data the SvelteKit-side import would
 * surface, since the systemd unit reads the same .env via EnvironmentFile=.
 */
export const env: Record<string, string | undefined> = process.env;
