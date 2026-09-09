import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '$lib/db';
import { codegraphSources } from '$lib/db/schema';
const sourceSchema = z.object({
  repo: z.string().trim().min(1).max(200).default('SR-Main'),
  kind: z.enum(['documentation', 'upstream-fix', 'example', 'owned-repository', 'scip']),
  title: z.string().trim().min(1).max(200), url: z.string().url().max(2000),
  revision: z.string().trim().min(1).max(200), license: z.string().trim().min(1).max(200),
  packageName: z.string().max(200).optional(), text: z.string().trim().min(1).max(50000),
});
/** Import reference text explicitly; fetching/executing arbitrary URLs is not an ingestion step. */
export async function registerSource(input: unknown) {
  const source = sourceSchema.parse(input);
  const url = new URL(source.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS source URL without embedded credentials.');
  const id = createHash('sha256').update([source.repo, source.url, source.revision].join('\n')).digest('hex');
  await db.insert(codegraphSources).values({ id, repo: source.repo, kind: source.kind, title: source.title,
    url: source.url, revision: source.revision, license: source.license, access: 'owner', status: 'reference',
    payload: { text: source.text, packageName: source.packageName ?? null, importedAt: new Date().toISOString(), trust: 'Reference data; not build instructions.' },
  }).onConflictDoUpdate({ target: codegraphSources.id, set: { title: source.title, payload: { text: source.text, packageName: source.packageName ?? null, importedAt: new Date().toISOString(), trust: 'Reference data; not build instructions.' }, license: source.license } });
  return id;
}
