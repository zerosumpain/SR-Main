#!/usr/bin/env node
// One-off migration: upload every existing blog image from local disk to the
// Azure 'blog' container, keyed by its path relative to BLOG_IMAGE_ROOT
// (i.e. `<postId>/<filename>`). Idempotent. Run on the VPS from the app dir so
// process.cwd() resolves BLOG_IMAGE_ROOT correctly:
//   set -a; . ./.env; set +a
//   node scripts/migrate-blog-images-to-azure.mjs [--dry-run]
import { BlobServiceClient } from '@azure/storage-blob';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const ROOT = resolve(process.cwd(), 'data', 'uploads', 'blog');

const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!conn) {
  console.error('AZURE_STORAGE_CONNECTION_STRING is not set');
  process.exit(1);
}
const containerName = process.env.AZURE_BLOG_CONTAINER || 'blog';
const container = BlobServiceClient.fromConnectionString(conn).getContainerClient(containerName);
await container.createIfNotExists();

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

console.log(`blog root : ${ROOT}`);
console.log(`container : ${containerName}`);
console.log(`mode      : ${DRY ? 'DRY RUN (no uploads)' : 'LIVE'}\n`);

let total = 0, uploaded = 0, skipped = 0, errored = 0, bytes = 0;
for await (const file of walk(ROOT)) {
  total++;
  const blobName = relative(ROOT, file).split(sep).join('/');
  const bb = container.getBlockBlobClient(blobName);
  const sz = (await stat(file)).size;
  try {
    const p = await bb.getProperties();
    if (p.contentLength === sz) { skipped++; continue; }
  } catch { /* absent → upload */ }
  if (DRY) { uploaded++; bytes += sz; continue; }
  try {
    await bb.uploadData(await readFile(file));
    uploaded++; bytes += sz;
  } catch (e) {
    errored++;
    console.error(`  UPLOAD-FAIL ${blobName}: ${e.message}`);
  }
}

console.log(JSON.stringify(
  { total, uploaded, skipped, errored, mb: +(bytes / 1048576).toFixed(3) }, null, 2,
));
process.exit(errored > 0 ? 1 : 0);
