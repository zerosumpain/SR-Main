#!/usr/bin/env node
// One-off migration: upload every existing /drive file from local disk to
// Azure Blob Storage under its derived blob name (diskPath relative to
// storeRoot). Idempotent — a blob that already exists at the right size is
// skipped, so it is safe to run before AND after the cut-over deploy.
//
// Run on the VPS (where the files + prod DB live), with the app .env loaded:
//   set -a; . ./.env; set +a
//   node scripts/migrate-drive-to-azure.mjs [--dry-run]
import pg from 'pg';
import { BlobServiceClient } from '@azure/storage-blob';
import { readFile } from 'node:fs/promises';
import { resolve, relative, normalize, sep, join } from 'node:path';
import { homedir } from 'node:os';

const DRY = process.argv.includes('--dry-run');
const { Pool } = pg;

function storeRoot() {
  const raw = process.env.WORKFLOW_FILES_ROOT ?? join(homedir(), '.openclaw', 'workflow-files');
  return resolve(raw);
}
function toBlobName(absPath) {
  const rel = relative(storeRoot(), normalize(absPath));
  if (rel.startsWith('..')) return null; // escapes the store root
  return rel.split(sep).join('/');
}

const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!conn) {
  console.error('AZURE_STORAGE_CONNECTION_STRING is not set');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const containerName = process.env.AZURE_BLOB_CONTAINER || 'drive';
const container = BlobServiceClient.fromConnectionString(conn).getContainerClient(containerName);
await container.createIfNotExists();

console.log(`store root : ${storeRoot()}`);
console.log(`container  : ${containerName}`);
console.log(`mode       : ${DRY ? 'DRY RUN (no uploads)' : 'LIVE'}`);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  'SELECT id, name, disk_path AS "diskPath", size_bytes AS "sizeBytes" FROM workflow_files ORDER BY created_at',
);
console.log(`rows       : ${rows.length}\n`);

let uploaded = 0, skipped = 0, missing = 0, outside = 0, errored = 0, bytes = 0;
for (const r of rows) {
  const blobName = toBlobName(r.diskPath);
  if (!blobName) {
    outside++;
    console.warn(`  OUTSIDE-ROOT  ${r.name}  (${r.diskPath})`);
    continue;
  }
  const bb = container.getBlockBlobClient(blobName);
  try {
    const props = await bb.getProperties();
    if (props.contentLength === Number(r.sizeBytes)) { skipped++; continue; }
  } catch { /* blob absent → upload below */ }

  let buf;
  try {
    buf = await readFile(r.diskPath);
  } catch {
    missing++;
    console.warn(`  MISSING-LOCAL ${r.name}  (${r.diskPath})`);
    continue;
  }
  if (DRY) { uploaded++; bytes += buf.byteLength; continue; }
  try {
    await bb.uploadData(buf);
    uploaded++;
    bytes += buf.byteLength;
  } catch (e) {
    errored++;
    console.error(`  UPLOAD-FAIL   ${r.name}: ${e.message}`);
  }
}

console.log('\n' + JSON.stringify(
  { total: rows.length, uploaded, skipped, missing, outside, errored, mb: +(bytes / 1048576).toFixed(2) },
  null, 2,
));
await pool.end();
process.exit(errored > 0 ? 1 : 0);
