// Remote-control focus for the TV pages (sr. tv): a television has a D-pad,
// not a pointer, so every control is a button marked `data-tv`, and the
// arrow keys move focus to the nearest one in that direction. Enter is the
// button's own click. Back (Escape, Backspace, the remote's Back, which the
// Android shell sends through `window.srTvBack`) asks the page to step back;
// when the page has nowhere to go it returns false and the shell exits.
//
// Plain DOM, no reactive state (svelte5-pitfalls §1).

type Dir = 'left' | 'right' | 'up' | 'down';

const KEYS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function focusables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-tv]')].filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false;
    // Behind an overlay (the video player) a control is inert: the remote skips it.
    if (el.closest('[inert]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/** The nearest focusable from `from` in `dir`: mostly along the axis, a little across it. */
export function nearest(from: DOMRect, dir: Dir, candidates: { el: HTMLElement; rect: DOMRect }[]): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, rect } of candidates) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    if (along <= 1) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Focus the first `data-tv-first` control, else the first control, unless focus is already on one. */
export function focusFirst(force = false): void {
  const active = document.activeElement as HTMLElement | null;
  if (!force && active?.hasAttribute('data-tv') && document.contains(active)) return;
  const all = focusables();
  (all.find((el) => el.hasAttribute('data-tv-first')) ?? all[0])?.focus();
}

/**
 * Wire the remote for this page. `onBack` returns true when it stepped back
 * (closed a sheet, left the lobby), false when there is nowhere to go.
 * Returns the cleanup.
 */
export function remote(onBack: () => boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    const dir = KEYS[e.key];
    if (dir) {
      const target = e.target as HTMLElement | null;
      // A text input keeps left/right for its caret.
      if (target?.tagName === 'INPUT' && (dir === 'left' || dir === 'right')) return;
      e.preventDefault();
      const all = focusables();
      const active = document.activeElement as HTMLElement | null;
      if (!active || !all.includes(active)) {
        focusFirst(true);
        return;
      }
      const next = nearest(
        active.getBoundingClientRect(),
        dir,
        all.filter((el) => el !== active).map((el) => ({ el, rect: el.getBoundingClientRect() })),
      );
      next?.focus();
      next?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || (e.key === 'Backspace' && (e.target as HTMLElement)?.tagName !== 'INPUT')) {
      if (onBack()) e.preventDefault();
    }
  };
  const w = window as Window & { srTvBack?: () => boolean };
  w.srTvBack = onBack;
  window.addEventListener('keydown', onKey);
  // The remote can lose focus to the body (a control that disappeared); arrows put it back.
  queueMicrotask(() => focusFirst());
  return () => {
    window.removeEventListener('keydown', onKey);
    if (w.srTvBack === onBack) delete w.srTvBack;
  };
}
