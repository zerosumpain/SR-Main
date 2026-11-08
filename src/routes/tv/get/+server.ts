import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { APK_URL } from '$lib/games/tv-release.server';

/**
 * /tv/get — the address typed into the TV's Downloader app: the latest sr. tv
 * APK (`$lib/games/tv-release.server`). Public; it only redirects to the
 * public release asset.
 */
export const GET: RequestHandler = () => redirect(302, APK_URL);
