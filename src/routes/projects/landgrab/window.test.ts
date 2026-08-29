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

import { describe, expect, it } from 'vitest';
import { DATE_WINDOWS, DEFAULT_WINDOW, windowOf, windowPhrase } from './identity';

describe('landgrab date window', () => {
  it('offers exactly the four durations, all time last and default', () => {
    expect(DATE_WINDOWS.map((w) => w.key)).toEqual(['24h', '7d', '30d', 'all']);
    expect(DEFAULT_WINDOW).toBe('all');
    expect(windowOf(DEFAULT_WINDOW).ms).toBeNull();
  });

  it('resolves the window John asked for', () => {
    expect(windowOf('7d').ms).toBe(7 * 86_400_000);
    expect(windowPhrase('7d')).toBe('the last 7 days');
  });

  it('falls back to all time on anything it does not recognise', () => {
    for (const bad of [null, undefined, '', 'week', '7', '7D', 'last-7-days', '../..']) {
      expect(windowOf(bad).key).toBe('all');
      expect(windowOf(bad).ms).toBeNull();
    }
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
