import { describe, it, expect } from 'vitest';
import { parseCodeRouteMarkers, stripCodeRouteMarkers } from './code-route-marker';

describe('parseCodeRouteMarkers', () => {
  it('reads the brief out of a marker', () => {
    const text = 'That could go either way.\n\n[[code-route: "A pomodoro timer with presets"]]';
    expect(parseCodeRouteMarkers(text)).toEqual([{ brief: 'A pomodoro timer with presets' }]);
  });

  it('finds nothing in an ordinary reply', () => {
    expect(parseCodeRouteMarkers('Here is the snippet you asked for.')).toEqual([]);
  });

  it('keeps only the first when a model emits several', () => {
    const text = '[[code-route: "one"]] and [[code-route: "two"]]';
    expect(parseCodeRouteMarkers(text)).toEqual([{ brief: 'one' }]);
  });

  it('ignores an empty brief', () => {
    expect(parseCodeRouteMarkers('[[code-route: "   "]]')).toEqual([]);
  });

  it('is not fooled by prose that merely mentions the marker name', () => {
    expect(parseCodeRouteMarkers('I would emit a code-route marker here.')).toEqual([]);
  });
});

describe('stripCodeRouteMarkers', () => {
  it('removes the marker from what the user reads', () => {
    const text = 'Sure.\n\n[[code-route: "A pomodoro timer"]]';
    expect(stripCodeRouteMarkers(text)).toBe('Sure.\n\n');
    expect(stripCodeRouteMarkers(text)).not.toContain('code-route');
  });

  it('leaves a reply without a marker byte-identical', () => {
    const text = 'Nothing to strip here.';
    expect(stripCodeRouteMarkers(text)).toBe(text);
  });

  it('strips every marker when a model emitted more than one', () => {
    expect(stripCodeRouteMarkers('a [[code-route: "x"]] b [[code-route: "y"]] c')).toBe('a  b  c');
  });
});
