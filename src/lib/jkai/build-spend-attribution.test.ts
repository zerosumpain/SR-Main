import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKLOADS } from '$lib/models/workloads';

// The develop lane's model calls used to be tagged `selfimprove`, so its spend
// sat on the nightly self-improve row of /admin/ops/costs — the row whose
// switch changes a model the develop lane never uses. A tag is a workload id:
// the spend has to land on the row that switches the model that spent it.
const FILES: Record<string, string[]> = {
  'development-review.server.ts': ['development-assessor'],
  'development-autopilot.server.ts': ['development-assessor'],
  'development-grooming.server.ts': ['builder'],
  'planner.ts': ['builder'],
  'design-review.ts': ['design-review'],
};

const tagsIn = (file: string) =>
  [...readFileSync(join(__dirname, file), 'utf8').matchAll(/withActivity\('([^']+)'/g)].map((m) => m[1]);

describe('build-side LLM spend attribution', () => {
  const ids = new Set(WORKLOADS.map((w) => w.id));
  for (const [file, expected] of Object.entries(FILES)) {
    it(`${file} tags its calls ${expected.join(', ')}`, () => {
      const tags = tagsIn(file);
      expect(tags.length).toBeGreaterThan(0);
      expect(new Set(tags)).toEqual(new Set(expected));
      for (const t of tags) expect(ids.has(t)).toBe(true);
      expect(tags).not.toContain('selfimprove');
    });
  }
});
