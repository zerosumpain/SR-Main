// Run the voice drift check by hand.
//
//   DATABASE_URL=postgresql://... npx tsx scripts/voice-drift.ts
//
// Same comparison the monthly cron performs, printed rather than recorded.
// It changes nothing: rebuilding the card is a deliberate act with a commit
// behind it. Exits 1 when the drift is material, so it can gate a check.

import { compareDrift } from '../src/lib/voice/drift';
import { measure } from '../src/lib/voice/measure';
import { plainTextFromHtml, countWords } from '../src/lib/blog/readability';
import { CORPUS_AUTHORSHIP, MIN_CORPUS_WORDS } from '../src/lib/blog/authorship';
import type { VoiceCard } from '../src/lib/voice/types';
import { readFileSync } from 'node:fs';

const corpusFlag = process.argv.indexOf('--corpus');
const CORPUS_FILE = corpusFlag >= 0 ? process.argv[corpusFlag + 1] : undefined;

async function loadPosts(): Promise<{ authorship: string; content: string }[]> {
  if (CORPUS_FILE) return JSON.parse(readFileSync(CORPUS_FILE, 'utf8')).posts ?? [];
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    return (await pool.query('select authorship, content from blog_posts')).rows;
  } finally {
    await pool.end();
  }
}

async function main() {
  const card = JSON.parse(readFileSync('data/voice/voice-card.json', 'utf8')) as VoiceCard;
  const posts = await loadPosts();

  const words = (c: string) => countWords(plainTextFromHtml(c ?? ''));
  const fresh = measure({
    documents: posts.filter((p) => p.authorship === CORPUS_AUTHORSHIP && words(p.content) >= MIN_CORPUS_WORDS).map((p) => p.content),
    contrast: posts.filter((p) => p.authorship === 'generated').map((p) => p.content),
  });

  const report = compareDrift(card, fresh, 'public-prose');

  console.log(`Voice drift — card v${report.cardVersion} (${report.cardBuiltAt})\n`);
  console.log(`  corpus  ${report.corpusThen.posts} posts / ${report.corpusThen.words} words  →  ${report.corpusNow.posts} / ${report.corpusNow.words}`);
  console.log(`  new     ${report.newPosts} post(s) the card has not seen\n`);
  console.log('  metric                      was      now     change');
  for (const i of report.items) {
    const flag = i.material ? ' *' : '  ';
    console.log(`${flag} ${i.metric.padEnd(26)} ${String(i.was).padStart(6)} ${String(i.now).padStart(8)} ${String(i.changePct + '%').padStart(9)}`);
  }
  console.log(`\n${report.summary}`);
  process.exit(report.material ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
