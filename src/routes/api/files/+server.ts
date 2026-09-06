import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listFilesWithIndex } from '$lib/file-index/list';

// `disk_path` is the one column that never leaves the server.
export const GET: RequestHandler = async () => {
  const files = await listFilesWithIndex();
  return json({
    files: files.map(({ diskPath: _diskPath, contentHash: _hash, ...rest }) => rest),
  });
};
