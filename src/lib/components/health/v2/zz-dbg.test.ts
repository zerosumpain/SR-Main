import { it } from 'vitest';
import { render } from 'svelte/server';
import PulseGrid from './PulseGrid.svelte';
import type { HealthDay } from '$lib/health/series-30d-service';
const series: HealthDay[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 6, 23 + i));
  return { i, date: d.toISOString().slice(0, 10), rec: 50 + ((i * 7) % 40), hrv: 40 + ((i * 3) % 25),
    rhr: 50 + (i % 9), slept: 6 + ((i % 5) * 0.4), strain: 8 + ((i * 2) % 11),
    steps: i % 6 === 0 ? 0 : 6000 + i * 111, weight: 80 - (i % 4) * 0.3 };
});
it('dbg', () => {
  const b = render(PulseGrid, { props: { series } }).body;
  const rhr = b.split('RESTING HR')[1].split('h-pg-rowlabel ')[0];
  require('fs').writeFileSync('/tmp/claude-1000/-home-john/ce006e60-4b9d-4745-921f-cc281fac820f/scratchpad/rhr.txt', rhr.slice(0, 4000));
});
