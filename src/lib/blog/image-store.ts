import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, normalize, relative, sep } from 'node:path';
import { isAzureStorageEnabled, azSaveBuffer, azReadBuffer } from './azure-blob';
import { BLOG_IMAGE_ROOT } from './upload-paths';

// Blog images have two interchangeable backends behind one interface:
// filesystem (default, under BLOG_IMAGE_ROOT) and Azure Blob (prod, when
// AZURE_STORAGE_CONNECTION_STRING is set). The storage key is `<postId>/<filename>`
// in both modes — the same public URL `/api/blog/images/<postId>/<filename>` serves
// either backend, so nothing in blog post content changes.

// Validated `<postId>/<filename>` key (blocks path traversal). Also the relative
// path under BLOG_IMAGE_ROOT on the fs backend.
export function blogImageKey(postId: string, filename: string): string {
  const root = normalize(BLOG_IMAGE_ROOT);
  const abs = normalize(join(BLOG_IMAGE_ROOT, postId, filename));
  if (!abs.startsWith(root + sep)) {
    throw new Error('path traversal blocked');
  }
  // Return the normalized path relative to root so the Azure blob name and the
  // fs path are always identical (no `a/../a/x` vs `a/x` divergence).
  return relative(root, abs).split(sep).join('/');
}

export async function saveBlogImage(postId: string, filename: string, buf: Buffer): Promise<void> {
  const key = blogImageKey(postId, filename);
  if (isAzureStorageEnabled()) {
    await azSaveBuffer(key, buf);
    return;
  }
  await mkdir(join(BLOG_IMAGE_ROOT, postId), { recursive: true });
  await writeFile(join(BLOG_IMAGE_ROOT, postId, filename), buf);
}

export async function readBlogImage(postId: string, filename: string): Promise<Buffer> {
  const key = blogImageKey(postId, filename);
  if (isAzureStorageEnabled()) return azReadBuffer(key);
  return readFile(join(BLOG_IMAGE_ROOT, postId, filename));
}
