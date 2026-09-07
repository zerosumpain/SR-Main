import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { measureSource, sourceFootprint } from './source-footprint.mjs';
import { build } from 'vite';

test('counts runtime source and edits; embeds a snapshot without a runtime checkout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-source-'));
  function put(path, source) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  try {
    for (const dir of ['src', 'packages', 'services', 'static']) mkdirSync(join(root, dir));
    put('src/page.svelte', '<h1>Hello</h1>\n\n<!-- comment -->\n');
    put('src/routes/projects/example/build/+page.svelte', '<p>Real route</p>');
    put('packages/worker/src/index.ts', 'run();\n');
    put('services/worker/server.ts', 'serve();\r\n');
    put('static/app.js', 'start();');
    for (const path of ['src/page.test.ts', 'src/types.d.ts', 'static/vendor/lib.js', 'static/lib.min.js', 'packages/worker/build/index.js', 'packages/worker/dist/index.js', 'packages/worker/node_modules/lib/index.js', 'src/fixtures/example.ts']) put(path, 'excluded();');
    assert.equal(measureSource(root).lines, 6);
    assert.equal(measureSource(root).files, 5);
    put('src/page.svelte', '<h1>Edited</h1>\n');
    unlinkSync(join(root, 'static/app.js'));
    assert.equal(measureSource(root).lines, 4);
    put('entry.js', "export { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';");
    const result = await build({ root, configFile: false, plugins: [sourceFootprint()], logLevel: 'silent', build: { write: false, lib: { entry: join(root, 'entry.js'), formats: ['es'] }, minify: false } });
    const output = Array.isArray(result) ? result[0].output : result.output;
    const chunk = output.find((entry) => entry.type === 'chunk');
    rmSync(root, { recursive: true, force: true });
    const { SOURCE_FOOTPRINT } = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
    assert.equal(SOURCE_FOOTPRINT.lines, 4);
    assert.equal(SOURCE_FOOTPRINT.files, 4);
    assert.ok(Number.isFinite(Date.parse(SOURCE_FOOTPRINT.measuredAt)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
