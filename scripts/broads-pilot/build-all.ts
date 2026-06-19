// build-all.ts — run the full Broads Pilot data pipeline in dependency order.
//   npx tsx scripts/broads-pilot/build-all.ts
import { execFileSync } from 'node:child_process';
const steps = ['build-graph', 'build-restrictions', 'build-moorings', 'build-pois', 'scrape-richardsons', 'build-meta'];
for (const s of steps) {
  console.log(`\n=== ${s} ===`);
  execFileSync('npx', ['tsx', `scripts/broads-pilot/${s}.ts`], { stdio: 'inherit' });
}
console.log('\n✓ pipeline complete');
