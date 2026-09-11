// src/lib/jkai/extract/synth-docx.ts
//
// Markdown → Word.
//
// INLINE EMPHASIS IS RENDERED, not passed through. This used to take each
// token's `.text`, which is the raw markdown source of the paragraph — so every
// `**What they get.**` reached Word as four literal asterisks, on every line of
// every document this has ever produced. `marked` already parses the inline
// tokens; walking them is the whole fix, and it is what makes a bolded lead-in
// scannable in the exported file the way it is on the page.
//
// The walk is recursive because emphasis nests (`**bold with *italic* inside**`)
// and because a link's label is itself a token list.
import { Document, Packer, Paragraph, HeadingLevel, TextRun, ExternalHyperlink } from 'docx';
import { marked } from 'marked';
import type { SynthesizeResult } from './types';

type Inline = { type: string; text?: string; raw?: string; href?: string; tokens?: Inline[] };
type Style = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };

/**
 * One markdown inline token tree → the runs Word needs.
 *
 * A token with no children contributes its own text; a token with children
 * contributes theirs, carrying whatever emphasis it adds. `text` on a parent is
 * the raw source and must NOT be used when `tokens` is present — that is the
 * bug this function exists to fix.
 */
function runs(tokens: Inline[] | undefined, style: Style = {}): (TextRun | ExternalHyperlink)[] {
  if (!tokens?.length) return [];
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        out.push(...runs(token.tokens, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...runs(token.tokens, { ...style, italics: true }));
        break;
      case 'del':
        out.push(...runs(token.tokens, { ...style, strike: true }));
        break;
      case 'codespan':
        out.push(new TextRun({ text: token.text ?? '', font: 'Courier New', ...style }));
        break;
      case 'br':
        out.push(new TextRun({ text: '', break: 1 }));
        break;
      case 'link': {
        const children = runs(token.tokens, style);
        const label = children.length ? children : [new TextRun({ text: token.text ?? token.href ?? '', ...style })];
        out.push(new ExternalHyperlink({ children: label as TextRun[], link: token.href ?? '' }));
        break;
      }
      default:
        // `text`, `escape`, `html` and anything the lexer adds later. A nested
        // token list still wins over the parent's raw source.
        if (token.tokens?.length) out.push(...runs(token.tokens, style));
        else out.push(new TextRun({ text: token.text ?? token.raw ?? '', ...style }));
    }
  }
  return out;
}

/** A paragraph from a token, falling back to its plain text when it has no children. */
function para(token: Inline, extra: Record<string, unknown> = {}): Paragraph {
  const children = runs(token.tokens);
  return new Paragraph({
    children: children.length ? children : [new TextRun(token.text ?? '')],
    ...extra,
  });
}

const HEADINGS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

export async function synthesizeDocx(markdown: string, title?: string): Promise<SynthesizeResult> {
  const tokens = marked.lexer(markdown);
  const children: Paragraph[] = [];
  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  }

  const walk = (list: Inline[], depth = 0) => {
    for (const t of list) {
      if (t.type === 'heading') {
        const level = (t as unknown as { depth: number }).depth;
        children.push(para(t, { heading: HEADINGS[level] ?? HeadingLevel.HEADING_3 }));
      } else if (t.type === 'paragraph') {
        children.push(para(t));
      } else if (t.type === 'blockquote') {
        // A quote's children are block tokens of their own.
        walk(((t as unknown as { tokens?: Inline[] }).tokens ?? []), depth);
      } else if (t.type === 'list') {
        for (const item of ((t as unknown as { items?: Inline[] }).items ?? [])) {
          // A list item's own tokens are blocks, and a LOOSE item has several:
          // taking only the first dropped every paragraph after it, silently.
          const inner = (item as unknown as { tokens?: Inline[] }).tokens ?? [];
          const blocks = inner.filter((x) => x.type === 'text' || x.type === 'paragraph');
          if (blocks.length) {
            for (const block of blocks) {
              const body = runs(block.tokens);
              children.push(
                new Paragraph({
                  children: body.length ? body : [new TextRun(block.text ?? '')],
                  bullet: { level: depth },
                }),
              );
            }
          } else {
            children.push(new Paragraph({ children: [new TextRun(item.text ?? '')], bullet: { level: depth } }));
          }
          // Nested lists under the same item.
          for (const nested of inner.filter((x) => x.type === 'list')) walk([nested], depth + 1);
        }
      } else if (t.type === 'code') {
        children.push(new Paragraph({ children: [new TextRun({ text: t.text ?? '', font: 'Courier New' })] }));
      } else if (t.type === 'hr') {
        children.push(new Paragraph({ text: '', border: { bottom: { style: 'single', size: 6, color: 'AAAAAA' } } }));
      } else if (t.type === 'space') {
        children.push(new Paragraph(''));
      }
    }
  };
  walk(tokens as unknown as Inline[]);

  const doc = new Document({ sections: [{ children }] });
  const buffer = Buffer.from(await Packer.toBuffer(doc));
  return {
    buffer,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    suggestedExtension: '.docx',
  };
}
