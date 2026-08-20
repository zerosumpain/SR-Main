#!/usr/bin/env node
// Prove that document extraction works in the BUILT bundle, not just in source.
//
// This exists because of a four-day production outage in August 2026: the PDF
// extractor was swapped to pdfjs-dist, which loads its worker with a dynamic
// import resolved relative to its own module. Vite inlines pdf.mjs into a server
// chunk and never emits pdf.worker.mjs beside it, so getDocument() rejected on
// every PDF in production — while every unit test passed, because tests run
// unbundled. No source-level check can catch that class of fault.
//
// Runs from ci-prebuild.sh, on the real adapter-node build, before the release
// directory is staged. A failure here fails prebuild, so `release` never runs
// and production is untouched.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const CHUNKS = resolve('build/server/chunks');
const FIXTURE = resolve('tests/fixtures/extract/sample.pdf');

function fail(msg) {
  console.error(`\n✗ built-extract check FAILED: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(CHUNKS)) fail(`no ${CHUNKS} — was this run against a real build?`);
if (!existsSync(FIXTURE)) fail(`missing fixture ${FIXTURE}`);

// pdf.js references these display globals even for text-only work; Node has no DOM.
for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, { value: class {}, configurable: true });
  }
}

// Chunk filenames carry a content hash and change every build, so find it by
// content. The error string is the extractor's own and is stable.
const candidates = readdirSync(CHUNKS)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => readFileSync(join(CHUNKS, f), 'utf8').includes('PDF text extraction failed'));
if (candidates.length === 0) fail('no server chunk contains the PDF extractor');

// Exports are minified aliases (`export { extractText as e }`), so probe by
// behaviour rather than by name.
let extractText = null;
for (const file of candidates) {
  const mod = await import(join(CHUNKS, file));
  for (const value of Object.values(mod)) {
    if (typeof value !== 'function') continue;
    try {
      const probe = await value(Buffer.from('probe'), 'text/plain', 'probe.txt');
      if (probe && typeof probe.text === 'string' && probe.text.includes('probe')) {
        extractText = value;
        console.log(`  found extractText in ${file}`);
        break;
      }
    } catch {
      // not this export
    }
  }
  if (extractText) break;
}
if (!extractText) fail('could not locate extractText among the built chunks');

// The regression itself: a PDF, through the bundled extractor.
let result;
try {
  result = await extractText(readFileSync(FIXTURE), 'application/pdf', 'sample.pdf');
} catch (err) {
  const cause = err?.cause instanceof Error ? err.cause.message : String(err?.cause ?? '');
  fail(`the bundled extractor threw on a PDF: ${err?.message}${cause ? ` — caused by: ${cause}` : ''}`);
}

if (!result.text.includes('Hello world')) fail(`extracted text is missing expected content: ${JSON.stringify(result.text.slice(0, 120))}`);
if (!result.text.includes('\n')) fail('extracted text has no line breaks — pdf.js hasEOL handling regressed');
if (result.meta?.pageCount !== 2) fail(`expected 2 pages, got ${result.meta?.pageCount}`);

// The worker path is what broke. Assert it resolves to a real file so an upgrade
// that moves it fails here rather than in production four days later.
const workerSrc = (() => {
  try {
    return createRequire(import.meta.url).resolve('pdfjs-dist/build/pdf.worker.mjs');
  } catch {
    return null;
  }
})();
if (!workerSrc || !existsSync(workerSrc)) fail('pdfjs-dist/build/pdf.worker.mjs does not resolve to a real file');

console.log(`✓ built-extract check passed — ${result.text.length} chars, ${result.meta.pageCount} pages, worker resolves`);
