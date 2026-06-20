// build-all.ts — run the full Broads Pilot data pipeline in dependency order.
//   npx tsx scripts/broads-pilot/build-all.ts
import { execFileSync } from 'node:child_process';
// split-yarmouth runs AFTER build-graph (so it can split the lower-Bure edge) but
// BEFORE build-restrictions/build-moorings (so the bridges + Yacht Station mooring
// re-snap onto the split segments/node). build-tides has no graph dependency.
const steps = ['build-graph', 'split-yarmouth', 'build-broads', 'build-restrictions', 'build-moorings', 'build-pois', 'scrape-richardsons', 'build-tides', 'build-meta'];
for (const s of steps) {
  console.log(`\n=== ${s} ===`);
  execFileSync('npx', ['tsx', `scripts/broads-pilot/${s}.ts`], { stdio: 'inherit' });
}
console.log('\n✓ pipeline complete');
