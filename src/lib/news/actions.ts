import { and, desc, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes, researchSessions } from '$lib/db/schema';
import { enqueueIntelJob, hasPendingIntelJob } from '$lib/intel-client/outbox';
import { OWNER_INTEL_SCOPE, OWNER_SPACE, spaceIn, type IntelScope } from '$lib/intel-client/scope';
import { saveNote } from '$lib/daydream/notebook/store';
import { depthPreset } from '$lib/deepdive/depth';
import { coerceScope } from '$lib/deepdive/scope';
import { startResearch } from '$lib/deepdive/worker';
import { readNewsStory } from './reader';
import type { NewsArticle } from './types';

function provenance(article: NewsArticle): string {
  const { story } = article;
  return [
    `Original: ${story.url}`,
    `Discussion: ${story.discussionUrl}`,
    `Discovered via: ${story.sourceLabel}`,
    `Submitted by: ${story.author ?? 'unknown'} · ${story.score} points · ${story.commentCount} comments`,
  ].join('\n');
}

export async function keepNewsInGraph(
  article: NewsArticle,
  // Whose graph: the owner's by default (the phone lane, the owner's desk); a
  // member's request passes their own scope and space.
  into: { scope: IntelScope; spaceId: string } = { scope: OWNER_INTEL_SCOPE, spaceId: OWNER_SPACE },
): Promise<{
  id: string;
  href: string;
  existing: boolean;
  /** True when the note is queued for SR-Jkai-Core and has no id yet. */
  queued?: boolean;
}> {
  const [existing] = await db
    .select({ id: intelNotes.id })
    .from(intelNotes)
    // Kept means kept by THIS reader: another space's copy of the same story is
    // not theirs, and linking to it would 404 for them anyway.
    .where(and(sql`${intelNotes.metadata}->>'newsKey' = ${article.story.key}`, spaceIn(intelNotes.spaceId, into.scope)))
    .orderBy(desc(intelNotes.createdAt))
    .limit(1);
  if (existing) {
    return { id: existing.id, href: `/jkai/intel/notes/${existing.id}`, existing: true };
  }

  const body = [
    article.story.title,
    '',
    provenance(article),
    article.content ? `\nArticle text:\n${article.content}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 50_000);
  // SR-Jkai-Core writes the note and extracts it when it drains the outbox, a
  // few seconds from now. Until then there is no note id to link to, so the
  // link is the intel search page. One job per story per space: a second press
  // while the first is still queued does not queue it again.
  const ref = `news:${into.spaceId}:${article.story.key}`;
  if (await hasPendingIntelJob('note', ref)) {
    return { id: ref, href: '/jkai/intel', existing: true, queued: true };
  }
  await enqueueIntelJob('note', ref, {
    title: article.story.title,
    content: body,
    source: 'news',
    metadata: {
      newsKey: article.story.key,
      newsSource: article.story.source,
      sourceUrl: article.story.url,
      discussionUrl: article.story.discussionUrl,
      publishedAt: article.story.publishedAt,
    },
    spaceId: into.spaceId,
    process: true,
  });
  return { id: ref, href: '/jkai/intel', existing: false, queued: true };
}

export async function linkNewsInNote(
  article: NewsArticle,
  /** Whose notebook: the owner's unless a member filed it. */
  principalId = 'owner',
): Promise<{ id: string; href: string }> {
  const { story } = article;
  const note = await saveNote({
    principalId,
    title: story.title,
    folder: 'News',
    tags: ['news', story.source],
    body: [
      `[${story.title}](${story.url})`,
      '',
      `Via [${story.sourceLabel}](${story.discussionUrl}) · ${story.score} points · ${story.commentCount} comments`,
      '',
      '> Why this matters:',
      '> ',
    ].join('\n'),
  });
  return { id: note.id, href: `/jkai/notes?open=${note.id}` };
}

export async function commissionNewsResearch(
  article: NewsArticle,
  /** Whose run: the owner's unless a member commissioned it (research_session.principal_id). */
  principalId = 'owner',
): Promise<{
  id: string;
  href: string;
}> {
  const preset = depthPreset('brief');
  const { story } = article;
  const [session] = await db
    .insert(researchSessions)
    .values({
      topic: story.title,
      goals: [
        'Verify the central claims and add essential context.',
        'Explain the implications, strongest counterarguments, and what to watch next.',
      ],
      depth: 'brief',
      grounding: 'off',
      scope: coerceScope({ mode: 'open', seedUrls: [story.url] }),
      budgetMs: preset.budgetMs,
      config: preset.config,
      status: 'draft',
      principalId,
      seedContext: {
        kind: 'news',
        title: story.title,
        source: story.sourceLabel,
        sourceUrl: story.url,
        discussionUrl: story.discussionUrl,
        articleText: article.content.slice(0, 12_000),
      },
    })
    .returning({ id: researchSessions.id });
  startResearch(session.id);
  return { id: session.id, href: `/research/${session.id}` };
}

export async function newsActionArticle(source: NewsArticle['story']['source'], id: string) {
  return readNewsStory(source, id);
}
