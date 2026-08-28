// The working set of chat threads — which conversations are open as tabs, which
// one is on screen, and what the others are doing while you are not looking.
//
// The conversation rail is the LIBRARY: every thread that has ever existed,
// searchable, bucketed by recency. This is the WORKING SET: the two or three
// you are actually running. They are deliberately separate ideas, because the
// only reason to want tabs is to set a long answer going in one thread and read
// another while it finishes.
//
// Each open tab keeps its own mounted ChatArea, so a pane is bound to one
// conversation for its entire life. That is what makes concurrent turns correct
// rather than merely possible: the chat stream, composer draft, tool cards and
// progress bubble all belong to the pane that started them, and there is no
// path by which a running job's frames can land in another thread's transcript.
// (Before tabs, `chatStream` was closed only by an explicit cancel — switching
// thread mid-reply left the old job attached and rendering into the new one.)
//
// Titles are NOT stored here. They live in the page's conversation list, which
// is already the thing rename/pin/delete update, and the strip reads labels
// from there — two copies would drift the moment a thread was renamed.

/** `reply` means a turn finished while this tab was in the background. */
export type TabActivity = 'idle' | 'running' | 'reply' | 'error';

export interface ChatTab {
  id: string;
  activity: TabActivity;
}

/** What the strip renders. Labels are resolved by the page, not stored here. */
export interface TabView {
  id: string;
  label: string;
  activity: TabActivity;
  /** Hover text — the full title, plus what the dot means. */
  title: string;
}

/**
 * Five is a UI limit, not an engine one — the server has no cap on concurrent
 * chat jobs (they are scoped per conversation) and each thread gets its
 * own session. Five tabs is where the strip stops being readable at 1100px, and
 * it keeps the multiplexed follow-up stream plus one job stream per running tab
 * inside the browser's six-connection HTTP/1.1 budget on the dev server.
 */
export const MAX_TABS = 5;

const STORAGE_KEY = 'jkai.openTabs';
/** Same window the single-thread resume used — a day-old tab set is noise. */
const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;

export const openTabs = $state({
  items: [] as ChatTab[],
  activeId: null as string | null,
  /** Set when an open was refused for want of room, so the strip can say so. */
  limitHit: false,
});

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ids: openTabs.items.map((t) => t.id),
        activeId: openTabs.activeId,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Private mode / quota — tabs just won't survive the reload.
  }
}

/**
 * The tab set from the last visit, newest-first as it was left.
 *
 * Returns ids only: the caller filters them against the conversations that
 * actually still exist, because a thread deleted from another device would
 * otherwise restore as a tab that 404s on open.
 */
export function readStoredTabs(): { ids: string[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ids: [], activeId: null };
    const parsed = JSON.parse(raw) as { ids?: unknown; activeId?: unknown; savedAt?: unknown };
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (Date.now() - savedAt > RESTORE_WINDOW_MS) return { ids: [], activeId: null };
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((x): x is string => typeof x === 'string') : [];
    const activeId = typeof parsed.activeId === 'string' ? parsed.activeId : null;
    return { ids, activeId };
  } catch {
    return { ids: [], activeId: null };
  }
}

export function hasTab(id: string): boolean {
  return openTabs.items.some((t) => t.id === id);
}

/**
 * Open `id` as a tab and put it on screen. Already open → just activate it,
 * which is what makes clicking a rail row for an open thread feel right rather
 * than spawning a duplicate.
 *
 * Returns false when the strip is full, so the caller can leave the rail
 * selection alone instead of appearing to do nothing.
 */
export function openTab(id: string): boolean {
  if (hasTab(id)) {
    activateTab(id);
    return true;
  }
  if (openTabs.items.length >= MAX_TABS) {
    openTabs.limitHit = true;
    return false;
  }
  openTabs.limitHit = false;
  openTabs.items = [...openTabs.items, { id, activity: 'idle' }];
  openTabs.activeId = id;
  persist();
  return true;
}

export function activateTab(id: string): void {
  if (!hasTab(id)) return;
  openTabs.activeId = id;
  // Looking at it is what clears "a reply landed" — the badge is about the
  // threads you are NOT reading.
  setTabActivity(id, 'idle', { only: 'reply' });
  persist();
}

/**
 * Close a tab. The thread's job is NOT cancelled — that is the whole point of
 * being able to close one. The rail keeps showing its live dot, and reopening
 * re-attaches to the running job through the pane's own active-job lookup.
 */
export function closeTab(id: string): void {
  const idx = openTabs.items.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const remaining = openTabs.items.filter((t) => t.id !== id);
  openTabs.items = remaining;
  openTabs.limitHit = false;
  if (openTabs.activeId === id) {
    // Land on the neighbour to the right, or the last tab if this was it —
    // the same place a browser puts you.
    const next = remaining[Math.min(idx, remaining.length - 1)];
    openTabs.activeId = next?.id ?? null;
  }
  persist();
}

/**
 * @param only Apply the change only if the tab is currently in this state.
 *   `activateTab` uses it to clear a `reply` badge without stamping over a
 *   thread that started running again in the meantime.
 */
export function setTabActivity(
  id: string,
  activity: TabActivity,
  opts: { only?: TabActivity } = {},
): void {
  openTabs.items = openTabs.items.map((t) => {
    if (t.id !== id) return t;
    if (opts.only && t.activity !== opts.only) return t;
    return { ...t, activity };
  });
}

/** Restore a saved set. Ids are assumed already filtered to live threads. */
export function restoreTabs(ids: string[], activeId: string | null): void {
  openTabs.items = ids.map((id) => ({ id, activity: 'idle' as TabActivity }));
  openTabs.activeId = activeId && ids.includes(activeId) ? activeId : (ids[0] ?? null);
  persist();
}

/** Drop a thread that no longer exists (deleted from the rail). */
export function forgetTab(id: string): void {
  closeTab(id);
}

export function cycleTab(delta: 1 | -1): void {
  const items = openTabs.items;
  if (items.length < 2) return;
  const idx = items.findIndex((t) => t.id === openTabs.activeId);
  if (idx < 0) return;
  const next = items[(idx + delta + items.length) % items.length];
  activateTab(next.id);
}
