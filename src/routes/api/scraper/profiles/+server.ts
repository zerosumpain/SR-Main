import { json, type RequestHandler } from '@sveltejs/kit';
import { execInSandbox } from '$lib/jkai/sandbox';

export const GET: RequestHandler = async () => {
  const res = await execInSandbox('ls -1 /home/jkai/scraper-profiles 2>/dev/null || true');
  const names = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return json(names);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const name = url.searchParams.get('name');
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    return json({ error: 'invalid profile name' }, { status: 400 });
  }
  await execInSandbox(`rm -rf /home/jkai/scraper-profiles/${name}`);
  return json({ ok: true });
};
