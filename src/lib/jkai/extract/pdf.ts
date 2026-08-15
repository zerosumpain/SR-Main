// src/lib/jkai/extract/pdf.ts
import { ExtractError, type ExtractResult, type ExtractOptions } from './types';

interface PdfJsPage {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
}

interface PdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  destroy: () => Promise<void>;
}

interface PdfJsModule {
  getDocument: (options: { data: Uint8Array }) => { promise: Promise<PdfJsDocument> };
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

export async function extractPdf(buffer: Buffer, options?: ExtractOptions): Promise<ExtractResult> {
  installPdfJsDomShims();

  let document: PdfJsDocument | undefined;
  let allPages: Array<{ index: number; text: string; error?: string }>;
  try {
    const { getDocument } = (await import('pdfjs-dist/build/pdf.mjs')) as unknown as PdfJsModule;
    document = await getDocument({ data: new Uint8Array(buffer) }).promise;
    allPages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, offset) => {
        const page = await document!.getPage(offset + 1);
        const content = await page.getTextContent();
        return { index: offset + 1, text: content.items.map((item) => item.str ?? '').join('') };
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
