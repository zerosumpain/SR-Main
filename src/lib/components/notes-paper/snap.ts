// snap.ts — keeps a block a whole number of the page's rules tall, so whatever
// follows it starts on a line and the ruling reads as one continuous sheet.
// The notes-paper twin of the landing showcase's snap (which is fixed at 32px):
// this one reads the pitch from the ruled region it sits in (`--np-l`, a
// registered length in notes-paper.css), so it follows the reader's text size.
//
//   <figure use:snapToRule> … </figure>
//
// It pads the block's foot by the shortfall through `--np-snap`, which the
// block's CSS adds to its padding-bottom (`.np-snap` does it). A padding change
// leaves the content box alone, so the observer never feeds itself. Without
// JavaScript nothing breaks: every ruled block anchors its own ruling
// (`.np-lined`), so text stays on its lines either way; snapping only makes
// the lines between blocks continuous.
export function snapToRule(node: HTMLElement): { destroy(): void } {
  if (typeof ResizeObserver !== 'function') return { destroy() {} };
  node.classList.add('np-snap');
  const fit = () => {
    node.style.setProperty('--np-snap', '0px');
    const rule = parseFloat(getComputedStyle(node).getPropertyValue('--np-l')) || 32;
    const h = node.getBoundingClientRect().height;
    if (!h) return;
    const extra = (rule - (h % rule)) % rule;
    node.style.setProperty('--np-snap', `${Math.round(extra * 100) / 100}px`);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(node);
  return { destroy: () => ro.disconnect() };
}
