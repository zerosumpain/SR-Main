// For each curated bridge, print the nearest graph edge + river + the nearest
// geometry point, to tell coordinate errors from missing OSM geometry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversine } from './lib/geo.ts';
import { BRIDGES } from './lib/seed-restrictions.ts';

const g = JSON.parse(readFileSync(join(process.cwd(), 'static', 'broads-pilot', 'graph.json'), 'utf8'));
for (const b of BRIDGES) {
  let best: any = null;
  for (const e of g.edges)
    for (const p of e.geometry) {
      const d = haversine(b.lat, b.lng, p[0], p[1]);
      if (!best || d < best.d) best = { d, river: e.river, p };
    }
  const flag = best.d > 500 ? '  <-- FAR' : '';
  console.log(
    `${b.id.padEnd(20)} ${best.d.toFixed(0).padStart(5)}m  nearest=${best.river} @ [${best.p[0].toFixed(4)},${best.p[1].toFixed(4)}] (bridge expects ${b.river})${flag}`,
  );
}
