import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { narrativeItems, facts, sources, researchSessions } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ topic: researchSessions.topic })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return new Response('Session not found', { status: 404 });

  const items = await db
    .select()
    .from(narrativeItems)
    .where(eq(narrativeItems.sessionId, params.id))
    .orderBy(asc(narrativeItems.sortOrder));

  if (items.length === 0) {
    return new Response('No narrative items found', { status: 404 });
  }

  let md = `# ${session.topic}\n\n`;
  md += `*Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}*\n\n---\n\n`;

  for (const item of items) {
    if (item.annotation) {
      md += `${item.annotation}\n\n`;
    }

    if (item.factId) {
      const [fact] = await db
        .select({ content: facts.content, confidence: facts.confidence, sourceId: facts.sourceId })
        .from(facts)
        .where(eq(facts.id, item.factId))
        .limit(1);

      if (fact) {
        const [source] = await db
          .select({ title: sources.title, url: sources.url, domain: sources.domain })
          .from(sources)
          .where(eq(sources.id, fact.sourceId))
          .limit(1);

        md += `> ${fact.content}\n>\n`;
        md += `> *Confidence: ${fact.confidence.toFixed(2)}*`;
        if (source) {
          md += ` | [${source.title ?? source.domain}](${source.url})`;
        }
        md += `\n\n`;
      }
    }
  }

  const slug = session.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const filename = `narrative-${slug}-${new Date().toISOString().slice(0, 10)}.md`;

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
