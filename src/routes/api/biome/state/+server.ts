import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const UPSTREAM_URL = env.BIOME_API_URL || 'http://localhost:3000/api/biome/state';

export const GET: RequestHandler = async ({ fetch }) => {
  try {
    const res = await fetch(UPSTREAM_URL);
    if (!res.ok) {
      return json({ error: 'upstream error' }, { status: res.status });
    }
    const data = await res.json();
    return json(data, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (e) {
    return json({ error: 'upstream unreachable' }, { status: 502 });
  }
};
