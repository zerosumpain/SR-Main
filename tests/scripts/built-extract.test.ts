import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const check = resolve('scripts/check-built-extract.mjs');
function fixture(pdfText: string) {
  const root = mkdtempSync(join(tmpdir(), 'built-extract-split-'));
  mkdirSync(join(root, 'build/server/chunks'), { recursive: true });
  mkdirSync(join(root, 'tests/fixtures/extract'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'tests/fixtures/extract/sample.pdf'), '%PDF-synthetic');
  writeFileSync(join(root, 'build/server/chunks/pdf.js'), `
    // PDF text extraction failed
    export function p(buffer) { return { text: ${JSON.stringify(pdfText)}, meta: { pageCount: 2 } }; }
  `);
  writeFileSync(join(root, 'build/server/chunks/dispatch.js'), `
    import { p } from './pdf.js';
    export function e(buffer, mime, filename) {
      if (mime === 'text/plain') return { text: buffer.toString() };
      if (mime === 'application/pdf') return p(buffer);
      throw new Error('cannot extract from mime');
    }
  `);
  return root;
}

describe('built document extraction check', () => {
  it('finds the dispatcher when PDF extraction is emitted in another chunk', () => {
    const root = fixture('Hello world\nSynthetic second page');
    try { expect(execFileSync(process.execPath, [check], { cwd: root, encoding: 'utf8' })).toContain('built-extract check passed'); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('still rejects a located extractor that loses PDF content', () => {
    const root = fixture('');
    try { expect(() => execFileSync(process.execPath, [check], { cwd: root, stdio: 'pipe' })).toThrow(); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
});
