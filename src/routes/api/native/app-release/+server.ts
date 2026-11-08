import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { adhocBuildOf, latestTestFlightRun, listAdhocDrafts } from '$lib/github/adhoc-builds';
import { buildState, chooseReleased, currentRelease, releaseBuild } from '$lib/github/app-release';

/**
 * GET /api/native/app-release — the family's releases, for the owner's own
 * phone (Settings → Release to the family; John, 2026-10-27: "release new
 * versions of the app to the family instead of having to go to the main
 * site"). The same record and the same copies as /admin/access/app#releases
 * (`$lib/github/app-release`): which build the family are offered, every
 * copy GitHub still holds with its state, and the newest TestFlight run.
 *
 * POST `{ build }` — offer that build to the family: newer is a release,
 * older a roll back. /app, /install and every phone's hourly update check
 * follow at once, exactly as the page's Release button.
 *
 * Owner only (`withDevice`), and a "View as" look is refused.
 */
export const GET: RequestHandler = withDevice(async () => {
  const [drafts, testflight] = await Promise.all([
    listAdhocDrafts(true),
    latestTestFlightRun().catch(() => null),
  ]);
  const release = await currentRelease(drafts);
  const offered = release ? chooseReleased(drafts, release) : null;
  const builds = await Promise.all(
    drafts.map(async (d) => {
      const meta = await adhocBuildOf(d).catch(() => null);
      return {
        run: d.run,
        commit: d.commit,
        builtAt: meta?.builtAt ?? d.createdAt,
        version: meta?.version ?? `0.1.${d.run}`,
        state: buildState(d, release, offered),
      };
    }),
  );
  return {
    release: release && { build: release.build, commit: release.commit, at: release.at, by: release.by },
    offered: offered?.run ?? null,
    builds,
    testflight,
  };
});

export const POST: RequestHandler = withDevice(async (event, identity) => {
  const body = (await event.request.json().catch(() => null)) as { build?: unknown } | null;
  const run = Number(body?.build);
  if (!Number.isInteger(run) || run <= 0) return json({ error: 'Which build?' }, { status: 400 });
  const outcome = await releaseBuild(run, identity.ownerEmail.toLowerCase());
  if (!outcome.ok) return json({ error: outcome.error }, { status: 400 });
  console.warn(`[fleet] build ${run} released to the family from the owner's phone`);
  return { released: run, release: { build: outcome.release.build, commit: outcome.release.commit, at: outcome.release.at, by: outcome.release.by } };
});
