// src/lib/jkai/extract/pdf.ts
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { ExtractError, type ExtractResult, type ExtractOptions } from './types';

interface PdfJsTextItem {
  str?: string;
  /** pdf.js sets this on the last run of a visual line. */
  hasEOL?: boolean;
}

interface PdfJsPage {
  getTextContent: () => Promise<{ items: PdfJsTextItem[] }>;
}

interface PdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  destroy: () => Promise<void>;
}

interface PdfJsModule {
  getDocument: (options: {
    data: Uint8Array;
    standardFontDataUrl?: string;
  }) => { promise: Promise<PdfJsDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

function installPdfJsDomShims(): void {
  // The browser bundle only references these display APIs while rendering. Text
  // extraction does not use them, but Node has no DOM globals. Avoid the legacy
  // bundle here: it imports @napi-rs/canvas at module load, which can crash a
  // worker even for text-only PDFs.
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
    if (!(name in globalThis)) {
      Object.defineProperty(globalThis, name, { value: class {}, configurable: true });
    }
  }
}

/**
 * Absolute paths to pdf.js's sibling assets, resolved through node_modules.
 *
 * pdf.js loads its worker (and its standard-font data) with a dynamic import
 * resolved RELATIVE TO ITS OWN MODULE. In dev that is node_modules, where the
 * worker sits beside pdf.mjs, so it just works. The production build inlines
 * pdf.mjs into a SvelteKit server chunk and does NOT emit pdf.worker.mjs next to
 * it, so every PDF in production died with
 *
 *   Setting up fake worker failed: Cannot find module
 *   '.../server/chunks/pdf.worker.mjs'
 *
 * — while every test passed, because tests run unbundled. Resolving through
 * node_modules pins the real files in both worlds. Nothing here is fatal: if
 * resolution fails we leave pdf.js to its own defaults rather than refusing to
 * read a PDF we might still manage.
 */
function resolvePdfJsAssets(): { workerSrc: string | null; standardFontDataUrl: string | null } {
  const require = createRequire(import.meta.url);
  const tryResolve = (specifier: string): string | null => {
    try {
      return require.resolve(specifier);
    } catch {
      return null;
    }
  };
  const fontFile = tryResolve('pdfjs-dist/standard_fonts/FoxitSans.pfb');
  return {
    workerSrc: tryResolve('pdfjs-dist/build/pdf.worker.mjs'),
    // pdf.js expects the DIRECTORY, with a trailing separator.
    standardFontDataUrl: fontFile ? `${dirname(fontFile)}/` : null,
  };
}

/**
 * Flatten one page's text runs.
 *
 * Joined on `hasEOL`, not blindly concatenated: pdf.js emits a separate item per
 * text run and marks the last run of each visual line. Concatenating without
 * that flag welds neighbouring lines together ("your annualstatementThis
 * statement shows…") and collapses every table row into one unbroken string,
 * which is unusable as model input even when extraction itself succeeds.
 */
function pageText(items: PdfJsTextItem[]): string {
  let out = '';
  for (const item of items) {
    out += item.str ?? '';
    if (item.hasEOL) out += '\n';
  }
  // Runs of blank lines are a layout artefact, not structure.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdf(buffer: Buffer, options?: ExtractOptions): Promise<ExtractResult> {
  installPdfJsDomShims();

  let document: PdfJsDocument | undefined;
  let allPages: Array<{ index: number; text: string; error?: string }>;
  try {
    const pdfjs = (await import('pdfjs-dist/build/pdf.mjs')) as unknown as PdfJsModule;
    const { workerSrc, standardFontDataUrl } = resolvePdfJsAssets();
    if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
    }).promise;
    allPages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, offset) => {
        const page = await document!.getPage(offset + 1);
        const content = await page.getTextContent();
        return { index: offset + 1, text: pageText(content.items) };
      }),
    );
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'PDF text extraction failed', err);
  } finally {
    try {
      await document?.destroy();
    } catch {
      // ignore cleanup errors
    }
  }

  const fromIdx = options?.pages?.from ? options.pages.from : 1;
  const toIdx = options?.pages?.to ? options.pages.to : allPages.length;
  const filtered = allPages.filter((p) => p.index >= fromIdx && p.index <= toIdx);

  const text = filtered.map((p) => p.text).filter(Boolean).join('\n\n');

  return {
    text,
    meta: { kind: 'pdf', pageCount: allPages.length, pages: filtered },
  };
}
