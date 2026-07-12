// Canvas inline-editing support: which DOM elements inside each rendered
// block are directly editable (and which block field they commit to), plus
// the HTML → markdown-lite serializer for rich prose contenteditable (the
// exact inverse subset of $lib/presentation/prose renderProse: h1–h4, b/i/u,
// links, paragraphs).

export interface EditableField {
  /** Selector inside the rendered .block element. */
  selector: string;
  /** Block property the element commits to on blur. */
  field: string;
  /** Serialize innerHTML → markdown-lite instead of plain textContent. */
  rich?: boolean;
  /** Strip the rendered decorative quote marks before committing. */
  stripQuotes?: boolean;
}

export const EDITABLE_FIELDS: Record<string, EditableField[]> = {
  prose: [{ selector: '.prose, .band-inner, .prose-cards', field: 'body', rich: true }],
  headline: [
    { selector: '.hl-kicker', field: 'kicker' },
    { selector: '.hl-text', field: 'text' },
    { selector: '.hl-dek', field: 'dek' },
  ],
  quote: [
    { selector: '.q-text', field: 'text', stripQuotes: true },
    { selector: '.q-attr', field: 'attribution' },
  ],
  masthead: [
    { selector: '.mh-kicker', field: 'kicker' },
    { selector: '.mh-title', field: 'title' },
    { selector: '.mh-thesis', field: 'thesis' },
  ],
  bigNumber: [
    { selector: '.bn-label', field: 'label' },
    { selector: '.bn-sub', field: 'sub' },
  ],
};

function inlineOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  const inner = Array.from(node.childNodes).map(inlineOf).join('');
  switch (node.tagName) {
    case 'B':
    case 'STRONG':
      return inner ? `**${inner}**` : '';
    case 'I':
    case 'EM':
      return inner ? `*${inner}*` : '';
    case 'U':
      return inner ? `__${inner}__` : '';
    case 'A':
      return `[${inner}](${node.getAttribute('href') ?? ''})`;
    case 'BR':
      return '\n';
    default:
      return inner;
  }
}

/** Serialize a rich contenteditable back to the markdown-lite the prose
 *  renderer accepts. Paragraph-level: h1–h4 lines, <p>/<div> chunks (Enter in
 *  contenteditable makes divs), containers recursed (cards, band). */
export function htmlToMarkdownLite(root: HTMLElement): string {
  const paras: string[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = (child.textContent ?? '').trim();
        if (t) paras.push(t);
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const h = child.tagName.match(/^H([1-4])$/);
      if (h) {
        paras.push(`${'#'.repeat(Number(h[1]))} ${inlineOf(child).replaceAll('\n', ' ').trim()}`);
      } else if (child.tagName === 'UL' || child.tagName === 'OL') {
        const lis = Array.from(child.querySelectorAll(':scope > li'))
          .map((li) => `- ${inlineOf(li).replaceAll('\n', ' ').trim()}`)
          .filter((l) => l !== '- ');
        if (lis.length) paras.push(lis.join('\n'));
      } else if (child.tagName === 'P') {
        const t = inlineOf(child).trim();
        if (t) paras.push(t);
      } else if (['DIV', 'SECTION', 'BLOCKQUOTE'].includes(child.tagName)) {
        walk(child);
      } else {
        const t = inlineOf(child).trim();
        if (t) paras.push(t);
      }
    }
  };
  walk(root);
  return paras.filter(Boolean).join('\n\n');
}
