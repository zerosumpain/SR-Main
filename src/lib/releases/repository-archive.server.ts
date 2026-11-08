/**
 * Archiving a site repository from the /releases footprint table.
 *
 * The owner can archive any repository on the "Where the site lives" list
 * except SR-Main. Archiving goes straight to GitHub (`PATCH /repos/{slug}`
 * with `archived: true`); the id is then remembered in `app_settings` so the
 * row leaves the table and the totals at once. The runtime snapshot is only
 * reinstalled by a Main release, and the nightly porkserv refresh skips
 * archived repositories, so this list only bridges that gap.
 *
 * The slug always comes from the installed snapshot, never from the request:
 * a caller names a row by id and can only reach a repository already listed.
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { githubToken } from '$lib/github/issues';
import { redactGitHubSecrets } from '$lib/github/redact';

export const SETTINGS_KEY = 'releases.archivedRepositories';
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/;

export type ArchiveResult =
  | { ok: true; id: string; name: string }
  | { ok: false; status: number; message: string };

export async function loadArchivedRepositories(): Promise<Set<string>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const value = row?.value;
  return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
}

async function rememberArchived(id: string): Promise<void> {
  const value = [...(await loadArchivedRepositories()), id].filter((v, i, all) => all.indexOf(v) === i).sort();
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** `repositories` is the owner's footprint, so only listed rows can be archived. */
export async function archiveRepository(
  id: string,
  repositories: ReadonlyArray<{ id: string; name: string; url: string }>,
  fetcher: typeof fetch = fetch,
): Promise<ArchiveResult> {
  if (id === 'main') return { ok: false, status: 400, message: 'SR-Main runs the site and cannot be archived here.' };
  const repository = repositories.find((r) => r.id === id);
  if (!repository) return { ok: false, status: 404, message: 'That repository is not on the list.' };
  const slug = GITHUB_REPO.exec(repository.url)?.[1];
  if (!slug) return { ok: false, status: 400, message: `${repository.name} is not a GitHub repository.` };
  const token = githubToken();
  if (!token) return { ok: false, status: 503, message: 'No GitHub token on this host, so nothing was archived.' };

  const response = await fetcher(`https://api.github.com/repos/${slug}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'sr-releases-archive',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ archived: true }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    const hint = response.status === 403 || response.status === 404
      ? ' The site token may not have admin rights on this repository.'
      : '';
    return {
      ok: false,
      status: 502,
      message: `GitHub refused (${response.status}): ${redactGitHubSecrets(body.message ?? response.statusText, token)}.${hint}`,
    };
  }
  await rememberArchived(id);
  return { ok: true, id, name: repository.name };
}
