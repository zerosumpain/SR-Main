#!/usr/bin/env node
// One-off migration: upload every existing jkai media file from local disk to
// the Azure 'media' container, keyed by its path relative to JKAI_MEDIA_ROOT
// (which equals the stored diskPath). Idempotent — a blob already present at the
// right size is skipped. Run on the VPS with the app .env loaded:
//   set -a; . ./.env; set +a
//   node scripts/migrate-media-to-azure.mjs [--dry-run]
import { BlobServiceClient } from '@azure/storage-blob';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';

const DRY = process.argv.includes('--dry-run');

function mediaRoot() {
  const raw = process.env.JKAI_MEDIA_ROOT ?? join(homedir(), '.openclaw', 'jkai-media');
  return resolve(raw);
}

const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!conn) {
  console.error('AZURE_STORAGE_CONNECTION_STRING is not set');
  process.exit(1);
}
const containerName = process.env.AZURE_MEDIA_CONTAINER || 'media';
const container = BlobServiceClient.fromConnectionString(conn).getContainerClient(containerName);
await container.createIfNotExists();

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return; // media root not created yet
    throw err;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const root = mediaRoot();
console.log(`media root : ${root}`);
console.log(`container  : ${containerName}`);
console.log(`mode       : ${DRY ? 'DRY RUN (no uploads)' : 'LIVE'}\n`);

let total = 0, uploaded = 0, skipped = 0, errored = 0, bytes = 0;
for await (const file of walk(root)) {
  total++;
  const blobName = relative(root, file).split(sep).join('/');
  const bb = container.getBlockBlobClient(blobName);
  const sz = (await stat(file)).size;
  try {
    const p = await bb.getProperties();
    if (p.contentLength === sz) { skipped++; continue; }
  } catch { /* blob absent → upload below */ }
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
