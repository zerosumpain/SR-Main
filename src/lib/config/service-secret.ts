// The shared secret two hosts use to talk to each other.
//
// It authenticates the `/api/mcp` bearer (an MCP client is not a browser
// session, so the cookie gate cannot serve) and the cross-host reads behind the
// security panel, which shows homeserv and the VPS side by side.
//
// It was called `HERMES_BRIDGE_SECRET` because the gateway was its first user.
// Hermes is gone and the secret is not: renaming it is the point of this
// module. The old name is read SECOND rather than dropped, so a host whose
// `.env` has not been updated yet keeps authenticating instead of 503-ing —
// deploys and env edits do not land at the same instant, and the failure mode
// of getting that wrong is every MCP tool call refused at once.
//
// Once both hosts carry `SERVICE_BRIDGE_SECRET`, delete the fallback here and
// the matching one in `$lib/mcp/jsonrpc` (which reads `process.env` too, for
// tests, and so cannot use this module).
import { env } from '$env/dynamic/private';

/** The configured secret, or '' when neither name is set on this host. */
export function serviceBridgeSecret(): string {
  return env.SERVICE_BRIDGE_SECRET || env.HERMES_BRIDGE_SECRET || '';
}
