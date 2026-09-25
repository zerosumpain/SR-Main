import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { connectorAttention } from '$lib/connectors/watch-store';
import { requestConnectorCheck } from '$lib/server/connector-check';

/** Older than this and the answer is refreshed in the background. */
const STALE_MS = 45 * 60 * 1000;

/**
 * GET /api/native/connections — what needs signing in again, or is down.
 *
 * Served from the connector watcher's watermark, never a live probe: probing
 * every connector costs a Gmail token refresh, a Home Assistant round trip and
 * an OpenRouter call, which is the dashboard's job, not a phone banner's. The
 * set is the one the watcher alerts on (`needsOwner` — see
 * `$lib/connectors/types`), so the banner here, the site's banner and the
 * notification agree.
 *
 * If the last check is older than 45 minutes (the watcher runs every 30) a
 * check is requested; this response still answers from what is stored.
 */
export const GET: RequestHandler = withDevice(async () => {
  const { items, checkedAt } = await connectorAttention();
  if (!checkedAt || Date.now() - checkedAt.getTime() > STALE_MS) requestConnectorCheck('native: stale watermark');
  return {
    needsAttention: items,
    checkedAt: checkedAt ? checkedAt.toISOString() : null,
  };
});
