// src/lib/jkai/extract/synth-pdf.ts
import PDFDocument from 'pdfkit';
import type { SynthesizeResult } from './types';

export async function synthesizePdf(text: string, title?: string): Promise<SynthesizeResult> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  if (title) {
    doc.fontSize(20).text(title, { underline: false });
    doc.moveDown();
  }
  doc.fontSize(12).text(text, { align: 'left' });
  doc.end();
  await done;

  return {
    buffer: Buffer.concat(chunks),
    mimeType: 'application/pdf',
    suggestedExtension: '.pdf',
  };
}
