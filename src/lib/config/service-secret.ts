// The shared secret two hosts use to talk to each other.
//
// It authenticates the `/api/mcp` bearer (an MCP client is not a browser
// session, so the cookie gate cannot serve) and the cross-host reads behind the
// security panel, which shows homeserv and the VPS side by side.
//
// It was called `HERMES_BRIDGE_SECRET` because the gateway was its first user.
// The old name was read as a fallback until both hosts carried the new one
// with the same value (checked 2026-10-01); `$lib/mcp/jsonrpc` reads the same
// variable through `process.env`, for tests, and so cannot use this module.
import { env } from '$env/dynamic/private';

/** The configured secret, or '' when it is not set on this host. */
export function serviceBridgeSecret(): string {
  return env.SERVICE_BRIDGE_SECRET || '';
}
