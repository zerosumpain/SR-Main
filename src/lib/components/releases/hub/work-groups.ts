import type { ConsoleRelease } from '$lib/releases/console';
import type { ReleaseSession, ReleaseSessionsBand } from '$lib/releases/sessions.server';

export interface WorkGroup {
  releases: ConsoleRelease[];
  sessions: ReleaseSession[];
  commitCount: number;
}

/** A connected PR-linked set appears once, even when sessions share a PR. */
export function groupReleaseWork(releases: ConsoleRelease[], band: ReleaseSessionsBand): WorkGroup[] {
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const sessionById = new Map(band.sessions.map((session) => [session.id, session]));
  const seenReleases = new Set<number>();
  const seenSessions = new Set<string>();
  const groups: WorkGroup[] = [];

  for (const release of releases) {
    if (seenReleases.has(release.id)) continue;
    const releaseIds = new Set<number>();
    const sessionIds = new Set<string>();
    const queue = [release.id];

    while (queue.length) {
      const id = queue.shift()!;
      if (seenReleases.has(id) || !releaseById.has(id)) continue;
      seenReleases.add(id);
      releaseIds.add(id);

      for (const sessionId of band.byRelease[id] ?? []) {
        const session = sessionById.get(sessionId);
        if (!session || seenSessions.has(sessionId)) continue;
        seenSessions.add(sessionId);
        sessionIds.add(sessionId);
        for (const linkedId of session.releaseIds) {
          if (releaseById.has(linkedId) && !seenReleases.has(linkedId)) queue.push(linkedId);
        }
      }
    }

    const groupReleases = releases.filter((item) => releaseIds.has(item.id));
    groups.push({
      releases: groupReleases,
      sessions: band.sessions.filter((session) => sessionIds.has(session.id)),
      commitCount: groupReleases.reduce((count, item) => count + item.commits.length, 0),
    });
  }

  return groups;
}
