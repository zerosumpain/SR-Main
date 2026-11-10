// Shared state for the site map (`NavMap.svelte`): the sheet under the home
// icon that lists every room and holds the go-or-ask box.
//
// The sheet is drawn once per page, by whichever `RoomMenu` mounted first (the
// main page has five). The triggers are elsewhere: the home icon on each bar
// opens it on hover, `/` opens it from the keyboard, and a row at the foot of
// every room menu opens it on a touch screen.
import { browser } from '$app/environment';
import { LATELY_KEPT, latelyWith } from './go';

export const navMap = $state({
  open: false,
  /** Opened by resting on the home icon: it leaves when the pointer does. */
  hovered: false,
  /** The `RoomMenu` drawing the sheet. Null where no bar wears rooms: no map. */
  host: null as string | null,
});

let timer: ReturnType<typeof setTimeout> | undefined;

export function openNavMap(): void {
  clearTimeout(timer);
  navMap.hovered = false;
  navMap.open = true;
}

export function closeNavMap(): void {
  clearTimeout(timer);
  navMap.open = false;
  navMap.hovered = false;
}

/** Typing, or pressing inside it: the sheet stays until it is dismissed. */
export function pinNavMap(): void {
  clearTimeout(timer);
  navMap.hovered = false;
}

/**
 * For the home icon's `onpointerenter`. A pause first: the icon sits in the
 * corner every pointer passes on its way somewhere else.
 */
export function homeHoverOpen(e: PointerEvent): void {
  if (e.pointerType !== 'mouse' || !navMap.host) return;
  clearTimeout(timer);
  if (navMap.open) return;
  timer = setTimeout(() => {
    navMap.hovered = true;
    navMap.open = true;
  }, 320);
}

/** For `onpointerleave`, on the home icon and on the sheet. */
export function mapHoverLeave(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return;
  clearTimeout(timer);
  if (navMap.open && navMap.hovered) timer = setTimeout(closeNavMap, 220);
}

/** The pointer reached the sheet from the icon: keep it. */
export function mapHoverStay(e: PointerEvent): void {
  if (e.pointerType === 'mouse') clearTimeout(timer);
}

// "Lately" is this browser's, and only a convenience: every read and write can
// fail (private window, blocked storage), and the map draws without it.
const LATELY_KEY = 'sr-nav-lately';

export function readLately(): string[] {
  if (!browser) return [];
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(LATELY_KEY) ?? '[]');
    return Array.isArray(kept) ? kept.filter((h) => typeof h === 'string').slice(0, LATELY_KEPT) : [];
  } catch {
    return [];
  }
}

export function recordVisit(href: string): void {
  if (!browser) return;
  try {
    localStorage.setItem(LATELY_KEY, JSON.stringify(latelyWith(readLately(), href)));
  } catch {
    /* not remembered; nothing depends on it */
  }
}
