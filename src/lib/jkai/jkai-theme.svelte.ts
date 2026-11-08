// The /jkai family's theme — night by default, paper on request.
//
// Modelled on SR-Health's `health-theme.svelte.ts`, and for the same reasons:
//
// ONE PER REQUEST, NEVER A MODULE SINGLETON. The value lives in a `$state`
// created by the /jkai layout and handed down through context; a module-level
// store would be shared by every request the server renders, so one visitor's
// toggle would repaint the next visitor's page.
//
// The choice is a cookie scoped to `/jkai`, read by the layout's server load,
// so the SERVER renders the right ground. A localStorage flag would paint the
// default first and flip after hydration.

import { getContext, setContext } from 'svelte';

export type JkaiTheme = 'day' | 'night';

export const JKAI_THEME_COOKIE = 'sr_jkai_theme';
const KEY = Symbol('jkai-theme');

export interface JkaiThemeState {
  readonly value: JkaiTheme;
  set(next: JkaiTheme): void;
}

/** Night unless paper was chosen. Any other value is ignored. */
export function themeFromCookie(value: string | undefined): JkaiTheme {
  return value === 'day' ? 'day' : 'night';
}

export function provideJkaiTheme(initial: JkaiTheme): JkaiThemeState {
  let value = $state<JkaiTheme>(initial);
  const theme: JkaiThemeState = {
    get value() {
      return value;
    },
    set(next) {
      value = next;
      const year = 60 * 60 * 24 * 365;
      document.cookie = `${JKAI_THEME_COOKIE}=${next}; path=/jkai; max-age=${year}; samesite=lax`;
      stamp(next);
    },
  };
  setContext(KEY, theme);
  return theme;
}

/** The theme, from any component under /jkai; null outside it. */
export function useJkaiTheme(): JkaiThemeState | null {
  return getContext<JkaiThemeState | undefined>(KEY) ?? null;
}

/**
 * The <html> signal. Modals portal to <body>, outside `.jkai-root`, so the
 * class on the root cannot reach them; this attribute can. Removed again when
 * the layout unmounts so the rest of the site keeps its paper.
 */
export function stamp(theme: JkaiTheme | null): void {
  if (typeof document === 'undefined') return;
  if (theme === 'night') document.documentElement.setAttribute('data-jkai-theme', 'night');
  else document.documentElement.removeAttribute('data-jkai-theme');
}
