// Owner-only deck export: renders /decks/<slug>/print in headless Chromium
// (playwright) and streams back a print-quality PDF — one 1280×720 page per
// slide, exactly the player's fixed design canvas. As a side effect the first
// slide is screenshotted into the deck's OG poster (decks.og_image), so every
// export also refreshes the share link's social card.
//
// Host prerequisite (one-time): `npx playwright install chromium` for the
// service user — the package is a dependency but browsers install separately.

import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { saveBlogImage } from '$lib/blog/image-store';
import { db } from '$lib/db';
import { decks } from '$lib/db/schema';
import { mintPrintToken } from '$lib/decks/print-tokens';
import { isOwnerRequest } from '$lib/server/owner';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(404, 'Not found');
  const [deck] = await db.select().from(decks).where(eq(decks.id, event.params.id)).limit(1);
  if (!deck) throw error(404, 'Not found');

  const { chromium } = await import('playwright');
  const ptk = mintPrintToken(deck.id);
  // The browser must reach THIS process directly — event.url.origin lies
  // behind proxies (cloudflared/https). Loopback on the adapter-node PORT is
  // the truth on both hosts; DECKS_EXPORT_ORIGIN overrides for odd setups.
  const origin =
    process.env.DECKS_EXPORT_ORIGIN ||
    (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : event.url.origin);
  const target = new URL(`/decks/${deck.slug}/print?ptk=${ptk}`, origin).href;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    await page.goto(target, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForSelector('[data-print-ready]', { timeout: 30_000 });
    await page.waitForTimeout(1600); // chart draw-ins and count-ups settle

    // OG poster — non-fatal: the PDF is the deliverable.
    try {
      const shot = await page.locator('.pslide').first().screenshot({ type: 'png' });
      const file = `og-${deck.id}.png`;
      await saveBlogImage('deck-media', file, Buffer.from(shot));
      await db
        .update(decks)
        .set({ ogImage: `/api/blog/images/deck-media/${file}` })
        .where(eq(decks.id, deck.id));
    } catch (err) {
      console.error('[decks] og poster capture failed (non-fatal):', err);
    }

    const pdf = await page.pdf({
      width: '1280px',
      height: '720px',
      printBackground: true,
      preferCSSPageSize: true,
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${deck.slug}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[decks] pdf export failed:', err);
    throw error(500, 'Export failed — is Chromium installed for playwright on this host?');
  } finally {
    await browser.close().catch(() => {});
  }
};
