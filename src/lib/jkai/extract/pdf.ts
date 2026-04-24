// src/lib/jkai/extract/pdf.ts
import { ExtractError, type ExtractResult, type ExtractOptions } from './types';

interface PdfParsePage {
  num: number;
  text: string;
}

interface PdfParseTextResult {
  pages: PdfParsePage[];
  text: string;
  total: number;
}

interface PdfParseInstance {
  getText: () => Promise<PdfParseTextResult>;
  destroy?: () => Promise<void> | void;
}

interface PdfParseModule {
  PDFParse: new (opts: { data: Buffer | Uint8Array }) => PdfParseInstance;
}

export async function extractPdf(buffer: Buffer, options?: ExtractOptions): Promise<ExtractResult> {
  // pdf-parse v2 exposes a PDFParse class with an async getText() method.
  const mod = (await import('pdf-parse')) as unknown as PdfParseModule;
  if (!mod.PDFParse) {
    throw new ExtractError('E_PARSE_FAILED', 'pdf-parse module missing PDFParse export');
  }

  let result: PdfParseTextResult;
  let instance: PdfParseInstance | undefined;
  try {
    instance = new mod.PDFParse({ data: buffer });
    result = await instance.getText();
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'pdf-parse failed', err);
  } finally {
    try {
      await instance?.destroy?.();
    } catch {
      // ignore cleanup errors
    }
  }

  const allPages: Array<{ index: number; text: string; error?: string }> = (result.pages ?? []).map((p) => ({
    index: p.num,
    text: p.text ?? '',
  }));

  const fromIdx = options?.pages?.from ? options.pages.from : 1;
  const toIdx = options?.pages?.to ? options.pages.to : result.total;
  const filtered = allPages.filter((p) => p.index >= fromIdx && p.index <= toIdx);

  const text = filtered.map((p) => p.text).filter(Boolean).join('\n\n');

  return {
    text,
    meta: { kind: 'pdf', pageCount: result.total, pages: filtered },
  };
}
