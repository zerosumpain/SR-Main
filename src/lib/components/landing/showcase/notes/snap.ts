// snap.ts — keeps a block a whole number of the notebook's 32px rules tall, so
// whatever follows it starts on a line and the page's ruling never slips out
// of step with the writing.
//
//   <div use:snap> … </div>
//
// Everything written on the pages already comes in whole rules (32px line
// boxes, gaps and paddings); this is for the few things whose height the
// browser decides (a drawing scaled to its column, a receipt whose names
// wrap). It pads the block's foot by the shortfall, through `--snap`, which
// the notebook's CSS adds to its padding-bottom. A padding change leaves the
// content box alone, so the observer never feeds itself. On the server and
// without JavaScript the block keeps its own height.
export const RULE = 32;

export function snap(node: HTMLElement): { destroy(): void } {
  if (typeof ResizeObserver !== 'function') return { destroy() {} };
  node.setAttribute('data-snap', '');
  const fit = () => {
    node.style.setProperty('--snap', '0px');
    const h = Math.round(node.getBoundingClientRect().height);
    if (!h) return;
    const extra = (RULE - (h % RULE)) % RULE;
    node.style.setProperty('--snap', `${extra}px`);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(node);
  return { destroy: () => ro.disconnect() };
}
