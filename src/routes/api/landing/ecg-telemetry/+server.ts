import type { RequestHandler } from './$types';

/**
 * Real-user telemetry for the landing heartbeat renderer.
 *
 * The ASCII heartbeat has been reported slow on real mobile devices that
 * cannot be reproduced from homeserv (Blink fine even 6x CPU-throttled;
 * Linux WebKit is software-rasterised and unrepresentative of iOS). The
 * EcgAscii component samples its own frame cadence once per visit and
 * beacons the result here; we log a single structured line to stdout so the
 * numbers can be read from the VPS with
 * `journalctl -u strange-rambling-svelte | grep ecg-rum`.
 *
 * Whitelisted in src/lib/auth.ts PUBLIC_PATHS + hooks PUBLIC_API_PATHS
 * (exact match) so anonymous mobile visits report too. No DB, no cookies,
 * nothing stored beyond the service journal.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const raw = await request.text();
    if (raw.length > 2048) return new Response(null, { status: 413 });
    const d = JSON.parse(raw) as Record<string, unknown>;
    const line = {
      r: String(d.r ?? '?').slice(0, 16), // renderer: webgl2 | 2d
      why: d.why ? String(d.why).slice(0, 16) : undefined, // GL refusal reason
      skip: Number(d.skip ?? -1), // adaptive presentation skip (-1 = 2D pen)
      fps: Number(d.fps ?? 0),
      p95: Number(d.p95 ?? 0), // frame ms
      max: Number(d.max ?? 0),
      over34pct: Number(d.over34pct ?? 0), // % of frames past ~2 vsyncs
      dpr: Number(d.dpr ?? 0),
      lite: Boolean(d.lite),
      vw: Number(d.vw ?? 0),
      vh: Number(d.vh ?? 0),
      ua: String(d.ua ?? '').slice(0, 160),
    };
    console.log('[ecg-rum]', JSON.stringify(line));
  } catch {
    // malformed beacon — ignore
  }
  return new Response(null, { status: 204 });
};
