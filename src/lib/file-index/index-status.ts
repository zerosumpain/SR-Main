// Whether a /drive file made it into the @files index, and why not when it
// didn't. Rendered as a chip on /drive.
//
// A module rather than a helper inside +page.server.ts because SvelteKit
// validates the exports of a +page.server.ts against a fixed list — `load`,
// `prerender`, `csr`, `ssr`, `trailingSlash`, `config`, `actions`, `entries` —
// and anything else fails the BUILD (not the type check, and not the dev
// server). See reference: a non-handler export from a +server/+page.server file
// is a build error, so shared logic lives here and is imported.
//
// Server-side either way: deciding this needs `isIndexableMime`, which reaches
// the extract and vision modules.
import { isIndexableMime } from './content';

export type IndexStatus = 'indexed' | 'pending' | 'no-text' | 'failed' | 'skipped';

export interface IndexStatusInput {
  mimeType: string;
  name: string;
  contentHash: string | null;
  indexError: string | null;
}

/**
 * The distinction that matters is 'no-text' versus 'failed'.
 *
 * `retireNoText` stamps `content_hash` alongside its reason, meaning the
 * extractor ran and settled the question. `recordIndexError` deliberately leaves
 * the hash alone so the file is retried. So a reason WITH a hash is a verdict,
 * and a reason WITHOUT one is an outstanding failure — which is precisely the
 * difference nobody could see while every PDF was silently failing.
 */
export function indexStatusFor(file: IndexStatusInput, chunks: number): IndexStatus {
  if (chunks > 0) return 'indexed';
  if (!isIndexableMime(file.mimeType, file.name)) return 'skipped';
  if (file.indexError) return file.contentHash ? 'no-text' : 'failed';
  return file.contentHash ? 'no-text' : 'pending';
}
