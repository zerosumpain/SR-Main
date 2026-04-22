import { json, type RequestHandler } from '@sveltejs/kit';
import { runScrape } from '$lib/workflows/scraper/runner';

export const POST: RequestHandler = async ({ request }) => {
  const job = await request.json();
  const result = await runScrape(job);
  return json(result);
};
