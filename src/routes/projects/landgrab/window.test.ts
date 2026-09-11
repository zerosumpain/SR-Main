// The date window's vocabulary, which is the half of the filter that runs in
// the browser.
//
// Small, but it guards a real rule: an unrecognised `?window=` must fall back
// to ALL TIME. The filter's whole job is to remove evidence, so a typo, a stale
// bookmark or a hand-edited URL failing towards a NARROWER window would quietly
// show less ground than the ledger holds, with the chip bar agreeing that
// nothing is selected. Failing towards all time is the fail-open direction here
// precisely because the page is already owner-gated — nothing is disclosed by
// showing more, and something is hidden by showing less.
//
// An ABSENT window is a different case and gets a different answer: no query
// string at all is somebody opening the page, and they get DEFAULT_WINDOW. The
// distinction is the whole point — the default narrowed to 30 days so that two
// ledgers of very different lengths are compared over the same period, and a
// typo must not be able to do the same thing by accident.

import { describe, expect, it } from 'vitest';
import { DATE_WINDOWS, DEFAULT_WINDOW, windowOf, windowPhrase } from './identity';

describe('landgrab date window', () => {
  it('offers exactly the four durations, all time last', () => {
    expect(DATE_WINDOWS.map((w) => w.key)).toEqual(['24h', '7d', '30d', 'all']);
  });

  it('defaults to a bounded window, not all time', () => {
    // The default has to be finite or it is comparing a 420-day ledger with a
    // 40-day one, which is what it did until 2026-09-11.
    expect(DEFAULT_WINDOW).toBe('30d');
    expect(windowOf(DEFAULT_WINDOW).ms).toBe(30 * 86_400_000);
  });

  it('reads an absent window as the default, and a bad one as all time', () => {
    for (const absent of [null, undefined]) {
      expect(windowOf(absent).key).toBe(DEFAULT_WINDOW);
    }
    for (const bad of ['', 'week', '7', '7D', 'last-7-days', '../..', '30']) {
      expect(windowOf(bad).key).toBe('all');
      expect(windowOf(bad).ms).toBeNull();
    }
  });

  it('resolves the window John asked for', () => {
    expect(windowOf('7d').ms).toBe(7 * 86_400_000);
    expect(windowPhrase('7d')).toBe('the last 7 days');
  });

  it('every window has a positive duration except all time', () => {
    for (const w of DATE_WINDOWS) {
      if (w.key === 'all') expect(w.ms).toBeNull();
      else expect(w.ms).toBeGreaterThan(0);
    }
    // Strictly widening, which is the order the chip bar reads in.
    const spans = DATE_WINDOWS.filter((w) => w.ms !== null).map((w) => w.ms as number);
    expect([...spans].sort((a, b) => a - b)).toEqual(spans);
  });
});
