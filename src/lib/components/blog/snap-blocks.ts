// snap-blocks.ts: keeps the odd-height furniture of a post (figures, tables,
// code, call-outs, embeds) a whole number of the page's rules tall, so the
// paragraph after each one starts on a line and the margins read as one
// continuous sheet. Text blocks never need it: they are set on the rules by
// CSS alone, and each carries its own ruling, so nothing here is on the path
// to legible text. Without JavaScript the furniture simply sits where it falls.
//
//   <div use:snapBlocks={articleHtml}><ProseContent>{@html articleHtml}</ProseContent></div>
//
// The parameter is the rendered HTML: a client-side navigation from one post
// to another replaces the children without remounting the element, so a
// change of key is the cue to let go of the old blocks and measure the new.
import { snapToRule } from '$lib/components/notes-paper/snap';

/** The direct children whose height the browser decides rather than the rules. */
export const ODD_BLOCKS = 'figure, table, pre, aside, details, section, iframe, video, div, img';
/** Set whole-rule by CSS and turned a degree off true: a rotated box measures
 *  taller than it is, so measuring it would pad it wrongly. */
const SKIP = 'aside.pull-quote';

/** The blocks that scroll sideways when they are wider than the column. */
const SCROLLERS = 'table, pre';

/**
 * Lets a keyboard reach a box that scrolls sideways (code with a long line, a
 * table on a phone), and names it, only while it does scroll: a box that fits
 * is not a stop on the tab order. A `pre` becomes a named region; a table
 * keeps its table semantics (a role on <table> would replace them) and is
 * only made focusable and named.
 */
export function reachable(el: HTMLElement): { destroy(): void } {
  if (typeof ResizeObserver !== 'function') return { destroy() {} };
  const isTable = el.tagName === 'TABLE';
  const label = isTable
    ? `${el.querySelector('caption')?.textContent?.trim() || 'Table'}, scrolls sideways`
    : 'Code, scrolls sideways';
  let on = false;
  const set = (scrolls: boolean) => {
    if (scrolls === on) return;
    on = scrolls;
    if (scrolls) {
      el.tabIndex = 0;
      el.setAttribute('aria-label', label);
      if (!isTable) el.setAttribute('role', 'region');
    } else {
      el.removeAttribute('tabindex');
      el.removeAttribute('aria-label');
      if (!isTable) el.removeAttribute('role');
    }
  };
  const check = () => {
    const ox = getComputedStyle(el).overflowX;
    set((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1);
  };
  const ro = new ResizeObserver(check);
  ro.observe(el);
  return {
    destroy() {
      ro.disconnect();
      set(false);
    },
  };
}

export function snapBlocks(node: HTMLElement, _key?: unknown): { update(key?: unknown): void; destroy(): void } {
  let held: { destroy(): void }[] = [];
  let frame = 0;

  const release = () => {
    for (const h of held) h.destroy();
    held = [];
  };

  // A paragraph that is only a picture (Markdown without a title) is odd too.
  // `:has` is new enough that a browser without it would throw on the query.
  const isOdd = (el: HTMLElement) => {
    if (el.matches(SKIP)) return false;
    if (el.matches(ODD_BLOCKS)) return true;
    try {
      return el.matches('p:has(> img)');
    } catch {
      return false;
    }
  };

  const scan = () => {
    release();
    // The blocks are the children of the prose root inside this wrapper (or
    // of the node itself, if it is the root).
    const root = node.querySelector(':scope > .prose') ?? node;
    for (const child of Array.from(root.children)) {
      if (child instanceof HTMLElement && isOdd(child)) {
        held.push(snapToRule(child));
      }
      if (child instanceof HTMLElement && child.matches(SCROLLERS)) {
        held.push(reachable(child));
      }
    }
  };

  // After the browser has laid the new children out, not during the update.
  const later = () => {
    if (typeof requestAnimationFrame !== 'function') return scan();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(scan);
  };

  later();
  return {
    update: later,
    destroy() {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      release();
    },
  };
}
