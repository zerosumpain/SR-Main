/**
 * Making the assessment print.
 *
 * Two things CSS cannot do on its own, and both were silently wrong.
 *
 * A closed `<details>` hides its content through the browser's own rendering,
 * not through a rule an author stylesheet can outrank — so every disclosure on
 * the page (the gaps this assessment could not establish, the interplay table,
 * the interaction models, the graph) was simply absent from the PDF. Opening
 * them is a DOM operation, so it happens here.
 *
 * The second is the print lifecycle itself: `beforeprint` covers the reader
 * pressing Ctrl+P, and the page's own button covers the button. Both paths must
 * restore what they opened, or a reader comes back from the print dialog to a
 * page that has quietly unfolded itself.
 */

/** Open every closed disclosure. Returns the undo. */
export function openDisclosures(root: ParentNode = document): () => void {
  const closed = [...root.querySelectorAll('details:not([open])')] as HTMLDetailsElement[];
  for (const d of closed) d.open = true;
  return () => { for (const d of closed) d.open = false; };
}

/**
 * Wire the browser's own print lifecycle. Returns a teardown for `onMount`.
 *
 * Safari fires neither event reliably, which is why the button below does the
 * same work explicitly rather than trusting this to run.
 */
export function wirePrint(): () => void {
  if (typeof window === 'undefined') return () => {};
  let restore: (() => void) | null = null;
  const before = () => { restore ??= openDisclosures(); };
  const after = () => { restore?.(); restore = null; };
  window.addEventListener('beforeprint', before);
  window.addEventListener('afterprint', after);
  return () => {
    window.removeEventListener('beforeprint', before);
    window.removeEventListener('afterprint', after);
    after();
  };
}

/** The print button: open everything, print, put it back. */
export function printNow(): void {
  const restore = openDisclosures();
  try { window.print(); } finally { restore(); }
}
