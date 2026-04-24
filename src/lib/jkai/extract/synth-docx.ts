// src/lib/jkai/extract/synth-docx.ts
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import { marked } from 'marked';
import type { SynthesizeResult } from './types';

export async function synthesizeDocx(markdown: string, title?: string): Promise<SynthesizeResult> {
  const tokens = marked.lexer(markdown);
  const children: Paragraph[] = [];
  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  }

  for (const t of tokens as Array<Record<string, unknown>>) {
    if (t.type === 'heading') {
      const level = t.depth as number;
      const map: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      children.push(new Paragraph({ text: (t.text as string) ?? '', heading: map[level] ?? HeadingLevel.HEADING_3 }));
    } else if (t.type === 'paragraph') {
      children.push(new Paragraph({ children: [new TextRun((t.text as string) ?? '')] }));
    } else if (t.type === 'list') {
      for (const item of (t.items as Array<Record<string, unknown>>) ?? []) {
        children.push(new Paragraph({ text: '• ' + ((item.text as string) ?? '') }));
      }
    } else if (t.type === 'code') {
      children.push(new Paragraph({ children: [new TextRun({ text: (t.text as string) ?? '', font: 'Courier New' })] }));
    } else if (t.type === 'space') {
      children.push(new Paragraph(''));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = Buffer.from(await Packer.toBuffer(doc));
  return {
    buffer,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    suggestedExtension: '.docx',
  };
}
