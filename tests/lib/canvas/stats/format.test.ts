import { describe, it, expect } from 'vitest';
import { formatDurationMs, formatPercent, formatRelative } from '$lib/canvas/stats/format';

describe('formatDurationMs', () => {
  it('<1s → ms', () => {
    expect(formatDurationMs(523)).toBe('523ms');
  });
  it('<60s → seconds with 1 decimal', () => {
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(12345)).toBe('12.3s');
  });
  it('<1h → m:ss', () => {
    expect(formatDurationMs(65_000)).toBe('1m 05s');
    expect(formatDurationMs(3_599_000)).toBe('59m 59s');
  });
  it('>=1h → h:mm', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h 00m');
    expect(formatDurationMs(3_720_000)).toBe('1h 02m');
  });
  it('null/0 → —', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(0)).toBe('0ms');
  });
});

describe('formatPercent', () => {
  it('renders 0..1 → integer % with a trailing sign', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.933)).toBe('93%');
  });
});

describe('formatRelative', () => {
  it('just now', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-20T11:59:50Z'), now)).toBe('just now');
  });
  it('minutes', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-20T11:55:00Z'), now)).toBe('5m ago');
  });
  it('hours', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-20T09:00:00Z'), now)).toBe('3h ago');
  });
  it('days', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-17T12:00:00Z'), now)).toBe('3d ago');
  });
});
