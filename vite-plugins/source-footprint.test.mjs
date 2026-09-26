import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { measureRepository, measureSource, sourceFootprint } from './source-footprint.mjs';
import { build } from 'vite';

test('embeds only public SR-Main counts in the client build', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-source-'));
  function put(path, source) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  try {
    put('src/page.svelte', '<h1>Hello</h1>\n\n<!-- comment -->\n');
    put('packages/worker/src/index.ts', 'run();\n');
    put('scripts/update.mjs', 'update();\n');
    put('src/page.test.ts', 'test();\n');
    put('tests/feature.spec.ts', 'assert();\n');
    put('docs/guide.md', '# Guide\n\nRead me.\n');
    put('README.md', '# Site\n');
    for (const path of ['src/types.d.ts', 'src/fixtures/example.ts', 'packages/worker/dist/index.js', 'static/vendor/lib.js']) put(path, 'excluded();\n');
    put('vite-plugins/site-footprint.json', JSON.stringify({ measuredAt: '2026-09-26T00:00:00Z', repositories: [{
      id: 'health', name: 'SR-Health', revision: 'abc123', measuredAt: '2026-09-26T00:00:00Z', source: 'revision snapshot',
      code: { lines: 5, files: 1 }, documentation: { lines: 3, files: 1 }, tests: { lines: 2, files: 1 },
    }] }));
    const main = measureRepository(root);
    assert.deepEqual(main, {
      code: { lines: 5, files: 3 },
      documentation: { lines: 4, files: 2 },
      tests: { lines: 2, files: 2 },
    });
    const measured = measureSource(root);
    assert.equal(measured.lines, 5);
    assert.equal(measured.categories.documentation.lines, 4);
    assert.equal(measured.categories.tests.lines, 2);
    assert.equal(measured.repositories.length, 1);

    put('entry.js', "export { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';");
    const result = await build({ root, configFile: false, plugins: [sourceFootprint()], logLevel: 'silent', build: { write: false, lib: { entry: join(root, 'entry.js'), formats: ['es'] }, minify: false } });
    const output = Array.isArray(result) ? result[0].output : result.output;
    const chunk = output.find((entry) => entry.type === 'chunk');
    const { SOURCE_FOOTPRINT } = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
    assert.equal(SOURCE_FOOTPRINT.categories.code.lines, 5);
    assert.equal(SOURCE_FOOTPRINT.repositories.length, 1);
    assert.equal(chunk.code.includes('SR-Health'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
