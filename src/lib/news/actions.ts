import { desc, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes, researchSessions } from '$lib/db/schema';
import { createNote as createIntelNote, processNote } from '$lib/jkai/intel/ingest';
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

export async function keepNewsInGraph(article: NewsArticle): Promise<{
  id: string;
  href: string;
  existing: boolean;
}> {
  const [existing] = await db
    .select({ id: intelNotes.id })
    .from(intelNotes)
    .where(sql`${intelNotes.metadata}->>'newsKey' = ${article.story.key}`)
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
  const id = await createIntelNote({
    title: article.story.title,
    rawContent: body,
    source: 'web',
    format: 'text',
    metadata: {
      newsKey: article.story.key,
      newsSource: article.story.source,
      sourceUrl: article.story.url,
      discussionUrl: article.story.discussionUrl,
      publishedAt: article.story.publishedAt,
    },
  });
  void processNote(id).catch((err) => console.error(`[news] graph processing failed for ${id}:`, err));
  return { id, href: `/jkai/intel/notes/${id}`, existing: false };
}

export async function linkNewsInNote(article: NewsArticle): Promise<{ id: string; href: string }> {
  const { story } = article;
  const note = await saveNote({
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

export async function commissionNewsResearch(article: NewsArticle): Promise<{
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
