import { error, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { enrolProfile, joinDeviceName, joinDisplayName, parseEnrolment, verifyJoinCode } from '$lib/server/adhoc-install';
import { joinCandidates, recordEnrolment } from '$lib/server/app-devices';
import { startAdhocBuild } from '$lib/github/adhoc-builds';
import { notifyOwner } from '$lib/server/notify';

/**
 * /app/<code>/profile — how a phone tells the site its UDID
 * (`$lib/server/adhoc-install`). Public (`/app` in PUBLIC_PATHS): the join
 * code is the owner's say-so, is signed over its person's address, and lasts
 * a week.
 *
 * GET hands Safari the one-time profile. Installing it in Settings makes iOS
 * POST the phone's attributes back here; that records the phone as that
 * person's (`app_device`), registers it (through a build of the app that
 * includes it) and sends Safari on to /app.
 */

/** Phones already sent on in this process: iOS can post twice, and a second build helps nobody. */
const seen = new Set<string>();

export const GET: RequestHandler = async ({ params, url }) => {
  const link = verifyJoinCode(params.code, env.AUTH_SECRET, await joinCandidates());
  if (!link) throw error(404, 'This link has expired. Ask John for a new one.');
  return new Response(enrolProfile(`${url.origin}/app/${params.code}/profile`, `${joinDisplayName(link.slug)}'s phone`), {
    headers: {
      'content-type': 'application/x-apple-aspen-config',
      'content-disposition': 'attachment; filename="get-sr.mobileconfig"',
      'cache-control': 'no-store',
    },
  });
};

export const POST: RequestHandler = async ({ params, request, url }) => {
  const link = verifyJoinCode(params.code, env.AUTH_SECRET, await joinCandidates());
  if (!link) throw error(404, 'This link has expired.');
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > 64 * 1024) throw error(413, 'Too large');
  const device = parseEnrolment(body);
  if (!device) throw error(400, 'That was not a phone’s enrolment.');
  const name = joinDeviceName(link.slug, device.product);

  // Recorded before the build, and on every post: the row is what ties the
  // developer account's name for the phone to a person, and a failed build
  // still leaves a phone the owner can see.
  await recordEnrolment({ udid: device.udid, email: link.email, name, product: device.product, osVersion: device.version }).catch(
    (err) => console.error('[app] could not record the enrolment:', err),
  );

  if (!seen.has(device.udid)) {
    seen.add(device.udid);
    try {
      await startAdhocBuild({ udid: device.udid, name });
      await notifyOwner({
        category: 'access',
        title: `${name} asked to install the app`,
        body: `${device.product ?? 'iPhone'} · iOS ${device.version ?? '?'} · building a copy that installs on it`,
        url: '/admin/access/app',
        severity: 'info',
        dedupeKey: `adhoc-enrol:${device.udid}`,
      }).catch((err) => console.error('[app] notify failed:', err));
    } catch (err) {
      seen.delete(device.udid);
      console.error('[app] could not start the build:', err);
      await notifyOwner({
        category: 'access',
        title: `${name} could not be added for the app`,
        body: `The build could not be started from the site. Its UDID is ${device.udid}: paste it into Build a copy on /admin/access/app.`,
        url: '/admin/access/app',
        severity: 'warn',
      }).catch(() => {});
    }
  }

  // iOS ends a Profile Service exchange on a redirect, and Safari follows it.
  // The join page already left the cookie that lets /app offer the install.
  throw redirect(301, `${url.origin}/app?added=${encodeURIComponent(name)}&join=${encodeURIComponent(params.code)}`);
};
