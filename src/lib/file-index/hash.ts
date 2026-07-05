// Content hashing for the global file index. The sha256 of a file's bytes is
// the change-detection key: re-embedding only happens when the hash differs
// from workflow_files.content_hash, so a metadata-only rename/permission edit
// (which bumps updatedAt but not the bytes) never triggers wasted embedding.

import { createHash } from 'node:crypto';

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
