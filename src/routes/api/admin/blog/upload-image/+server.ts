import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { saveBlogImage } from '$lib/blog/image-store';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const POST: RequestHandler = async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get('file');
  const postId = formData.get('postId');

  if (!file || !(file instanceof File)) {
    return json({ error: 'No image file provided' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return json({ error: 'File too large (max 10MB)' }, { status: 400 });
  }

  const safePostId = String(postId ?? 'uncategorized').replace(/[^a-zA-Z0-9_-]/g, '_') || 'uncategorized';
  const ext = MIME_TO_EXT[file.type] ?? 'bin';
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await saveBlogImage(safePostId, filename, buffer);

  return json({ url: `/api/blog/images/${safePostId}/${filename}` });
};
