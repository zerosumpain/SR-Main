// src/lib/codegraph/build-lessons.ts
//
// A lesson the owner records against an accepted /jkai/develop feature, as a
// codegraph lesson — the one lessons store since 2026-10-02.
//
// These used to be written to `jkai_build_lessons` and copied into
// `codegraph_lessons` by a sync on every read. Two stores meant two answers:
// the develop page and the reviewer read the area list from one, the builder
// was served the copy from the other, and forgetting a lesson in the graph
// left it in the area list. Now there is one row, written here, retrieved
// through the graph (file retrieval, topic top-up, pins) and listed per area
// by `areaLessons`. The table stays declared in the schema until a later
// release drops it; nothing writes or reads it.
//
// Rules carried over from the graph rather than re-invented:
//  - `origin: 'build'` and UNVERIFIED: an accepted local candidate is not a
//    release, so the body says production deployment is not established —
//    the same words the sync wrote, so old copies and new rows read alike;
//  - forgetting is the graph's tombstone (`retiredAt` with a reason), never a
//    delete; a lesson whose cited paths are gone is ranked last and flagged
//    stale, not dropped.
//
// Pure, with relative imports only: `scripts/backfill-build-lessons.ts` runs it
// under tsx without SvelteKit's aliases.

import { pathsInText } from './build-context';

/** Keeps the identity the sync gave legacy rows: `development-lesson:<id>`. */
export const BUILD_LESSON_PREFIX = 'development-lesson:';
/** The area list's recency window — the 90 days `expires_at` used to hold. */
export const BUILD_LESSON_WINDOW_DAYS = 90;
/** The unverified flag. Read by `readBuildLesson`; keep the wording stable. */
export const UNVERIFIED_MARK = 'Production deployment is not established.';
const MAX_PATHS = 50;

export interface BuildLessonInput {
  /** A legacy row's serial id, or a fresh uuid. */
  key: string | number;
  buildId: string;
  lesson: string;
  evidence: string;
  /** The accepted local candidate it was learned on. */
  revision: string;
  /** The files the accepted feature changed. */
  files: readonly string[];
  at: Date;
}

/** The `codegraph_lessons` row for a build lesson. */
export function buildLessonRow(input: BuildLessonInput) {
  const id = `${BUILD_LESSON_PREFIX}${input.key}`;
  return {
    id, repo: 'SR-Main', slug: id, title: input.lesson.slice(0, 120),
    body: `${input.lesson}\nEvidence: ${input.evidence}\nAccepted local candidate: ${input.revision}. ${UNVERIFIED_MARK}`,
    origin: 'build', originRef: `/jkai/develop/${input.buildId}`,
    citedPaths: [...new Set([...pathsInText(input.evidence), ...input.files])].slice(0, MAX_PATHS),
    observedAt: input.at,
  };
}

export interface AreaLesson {
  id: string;
  lesson: string;
  evidence: string;
  /** The accepted candidate it was learned on. */
  revision: string;
  /** When it drops out of the area list. The graph keeps it. */
  expiresAt: string;
  createdAt: string;
  /** No release has established it. True for every build lesson today. */
  unverified: boolean;
  /** Every path it cites is gone: ranked last and shown flagged. */
  stale: boolean;
}

/** A stored build lesson, read back as the area list shows it. */
export function readBuildLesson(row: { id: string; title: string; body: string; observedAt: Date | null; createdAt: Date; staleAt: Date | null }): AreaLesson {
  const at = row.observedAt ?? row.createdAt;
  const evidenceAt = row.body.indexOf('\nEvidence: ');
  const tailAt = row.body.lastIndexOf('\nAccepted local candidate: ');
  const lesson = evidenceAt >= 0 ? row.body.slice(0, evidenceAt) : row.title;
  const evidence = evidenceAt >= 0 ? row.body.slice(evidenceAt + 11, tailAt > evidenceAt ? tailAt : undefined) : '';
  const revision = tailAt >= 0 ? row.body.slice(tailAt + 27).replace(/\.\s.*$/s, '').trim() : '';
  return {
    id: row.id, lesson, evidence, revision,
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + BUILD_LESSON_WINDOW_DAYS * 86_400_000).toISOString(),
    unverified: row.body.includes(UNVERIFIED_MARK),
    stale: row.staleAt != null,
  };
}
