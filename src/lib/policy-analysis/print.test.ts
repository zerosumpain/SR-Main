// Opening the disclosures for print, and putting them back afterwards.
import { describe, expect, it } from 'vitest';
import { openDisclosures } from './print';

/** A `<details>` stand-in: this is DOM plumbing, not a rendering question. */
function disclosures(open: boolean[]) {
  const items = open.map((o) => ({ open: o }));
  const root = { querySelectorAll: (sel: string) => (sel.includes(':not([open])') ? items.filter((i) => !i.open) : items) } as unknown as ParentNode;
  return { items, root };
}

describe('a printed assessment carries what its disclosures hide', () => {
  it('opens every closed disclosure and restores exactly those', () => {
    // CSS cannot do this: a closed <details> hides its content through the
    // browser's own rendering, so the gaps list, the interplay table and the
    // interaction models were all simply absent from the PDF.
    const { items, root } = disclosures([false, true, false]);
    const restore = openDisclosures(root);
    expect(items.map((i) => i.open)).toEqual([true, true, true]);
    restore();
    // The one that was already open stays open — a reader coming back from the
    // print dialog must find the page as they left it.
    expect(items.map((i) => i.open)).toEqual([false, true, false]);
  });

  it('does nothing, harmlessly, when everything is already open', () => {
    const { items, root } = disclosures([true, true]);
    openDisclosures(root)();
    expect(items.map((i) => i.open)).toEqual([true, true]);
  });
});
