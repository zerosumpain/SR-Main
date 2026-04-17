import { describe, it, expect } from 'vitest';
import { parsePromoteMarkers, stripPromoteMarkers } from '$lib/jkai/promote-marker';

describe('parsePromoteMarkers', () => {
  it('extracts a single marker', () => {
    const text = 'Here is your chart. [[suggest-promote: step-3 as "render_sleep_chart"]]';
    const markers = parsePromoteMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].toolCallId).toBe('step-3');
    expect(markers[0].proposedName).toBe('render_sleep_chart');
  });

  it('extracts multiple markers', () => {
    const text = '[[suggest-promote: a as "tool_a"]] and [[suggest-promote: b as "tool_b"]]';
    expect(parsePromoteMarkers(text)).toHaveLength(2);
  });

  it('returns empty array when no markers', () => {
    expect(parsePromoteMarkers('hello world')).toEqual([]);
  });
});

describe('stripPromoteMarkers', () => {
  it('removes all markers from text', () => {
    const text = 'Here. [[suggest-promote: x as "y"]] Done.';
    expect(stripPromoteMarkers(text)).toBe('Here.  Done.');
  });
});
