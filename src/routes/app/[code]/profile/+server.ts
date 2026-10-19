import { error, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { enrolProfile, joinDeviceName, joinDisplayName, parseEnrolment, verifyJoinCode } from '$lib/server/adhoc-install';
import { startAdhocBuild } from '$lib/github/adhoc-builds';
import { notifyOwner } from '$lib/server/notify';

/**
 * /app/<code>/profile — how a phone tells the site its UDID
 * (`$lib/server/adhoc-install`). Public (`/app` in PUBLIC_PATHS): the join
 * code is the owner's say-so, names the person, and lasts a week.
 *
 * GET hands Safari the one-time profile. Installing it in Settings makes iOS
 * POST the phone's attributes back here; that registers the phone (through a
 * build of the app that includes it) and sends Safari on to /app.
 */

/** Phones already sent on in this process: iOS can post twice, and a second build helps nobody. */
const seen = new Set<string>();

export const GET: RequestHandler = async ({ params, url }) => {
  const slug = verifyJoinCode(params.code, env.AUTH_SECRET);
  if (!slug) throw error(404, 'This link has expired. Ask John for a new one.');
  return new Response(enrolProfile(`${url.origin}/app/${params.code}/profile`, `${joinDisplayName(slug)}'s phone`), {
    headers: {
      'content-type': 'application/x-apple-aspen-config',
      'content-disposition': 'attachment; filename="get-sr.mobileconfig"',
      'cache-control': 'no-store',
    },
  });
};

export const POST: RequestHandler = async ({ params, request, url }) => {
  const slug = verifyJoinCode(params.code, env.AUTH_SECRET);
  if (!slug) throw error(404, 'This link has expired.');
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > 64 * 1024) throw error(413, 'Too large');
  const device = parseEnrolment(body);
  if (!device) throw error(400, 'That was not a phone’s enrolment.');
  const name = joinDeviceName(slug, device.product);

  if (!seen.has(device.udid)) {
    seen.add(device.udid);
    try {
      await startAdhocBuild({ udid: device.udid, name });
      await notifyOwner({
        category: 'access',
        title: `${name} asked to install the app`,
        body: `${device.product ?? 'iPhone'} · iOS ${device.version ?? '?'} · building a copy that installs on it`,
        url: '/admin/access/devices#install',
        severity: 'info',
        dedupeKey: `adhoc-enrol:${device.udid}`,
      }).catch((err) => console.error('[app] notify failed:', err));
    } catch (err) {
      seen.delete(device.udid);
      console.error('[app] could not start the build:', err);
      await notifyOwner({
        category: 'access',
        title: `${name} could not be added for the app`,
        body: `The build could not be started from the site. Its UDID is ${device.udid}: paste it into Install without TestFlight on /admin/access/devices.`,
        url: '/admin/access/devices#install',
        severity: 'warn',
      }).catch(() => {});
    }
  }

  // iOS ends a Profile Service exchange on a redirect, and Safari follows it.
  // The join page already left the cookie that lets /app offer the install.
  throw redirect(301, `${url.origin}/app?added=${encodeURIComponent(name)}`);
};
