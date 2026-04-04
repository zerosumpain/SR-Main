import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const UPLOAD_DIR = '/opt/strange-rambling/static/images/blog';

export const POST: RequestHandler = async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get('image');
  const postId = formData.get('postId');

  if (!file || !(file instanceof File)) {
    return json({ error: 'No image file provided' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return json({ error: 'File too large (max 5MB)' }, { status: 400 });
  }

  const dir = join(UPLOAD_DIR, String(postId ?? 'uncategorized'));
  await mkdir(dir, { recursive: true });

  const ext = file.name.split('.').pop() ?? 'jpg';
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const filepath = join(dir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const url = `/static/images/blog/${postId ?? 'uncategorized'}/${filename}`;
  return json({ url });
};
