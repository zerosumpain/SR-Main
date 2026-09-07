import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { decks, deckSlides } from '$lib/db/schema';
import { tools } from '$lib/workflows/site-tools/registry-internal';
import '$lib/workflows/site-tools/tools/presentations';

describe.skipIf(process.env.JKAI_LOCAL_TESTS !== '1')('native deck commissioning', () => {
  it('persists a model-authored spec and returns the real deck link', async () => {
    const tool = tools.find(t => t.name === 'presentation_build_from_spec')!;
    const result = await tool.handler({
      title: `Synthetic commission ${Date.now()}`,
      slides: [{ title: 'A commissioned deck', layout: 'center', blocks: [{ type: 'masthead', title: 'A commissioned deck' }] }],
    });
    expect(result.success).toBe(true);
    const data = result.data as { deckId: string; slug: string; url: string; slideCount: number };
    try {
      expect(data.url).toContain(`/decks/${data.slug}`);
      expect(data.slideCount).toBe(1);
      const [deck] = await db.select().from(decks).where(eq(decks.id, data.deckId));
      expect(deck.isPublic).toBe(false);
      const slides = await db.select().from(deckSlides).where(eq(deckSlides.deckId, data.deckId));
      expect(slides).toHaveLength(1);
    } finally {
      await db.delete(decks).where(eq(decks.id, data.deckId));
    }
  });
});
