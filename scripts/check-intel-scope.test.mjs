import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './check-intel-scope.mjs';

const reader = (path, extra = '') => ({ path, src: `import { intelEntities } from '$lib/db/schema';\n${extra}` });

test('a new unscoped reader fails', () => {
  const r = classify([reader('src/new.ts')], [], {});
  assert.deepEqual(r.unscoped, ['src/new.ts']);
});

test('a scoped reader passes', () => {
  const r = classify([reader('src/a.ts', 'where(spaceIn(intelEntities.spaceId, scope))')], [], {});
  assert.deepEqual(r.unscoped, []);
});

test('a baselined reader passes, and one that became scoped must leave the baseline', () => {
  const r = classify(
    [reader('src/old.ts'), reader('src/done.ts', 'const s: IntelScope = OWNER_INTEL_SCOPE')],
    ['src/old.ts', 'src/done.ts', 'src/deleted.ts'], {},
  );
  assert.deepEqual(r.unscoped, []);
  assert.deepEqual(r.fixed.sort(), ['src/deleted.ts', 'src/done.ts']);
});

test('maintenance files are exempt', () => {
  const r = classify([reader('src/cleanup.ts')], [], { 'src/cleanup.ts': 'nightly sweep over every space' });
  assert.deepEqual(r.unscoped, []);
});

test('a file that does not touch intel tables is ignored', () => {
  const r = classify([{ path: 'src/x.ts', src: 'const a = 1' }], [], {});
  assert.deepEqual(r.unscoped, []);
});
