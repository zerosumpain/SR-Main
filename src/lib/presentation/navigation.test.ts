import { describe, expect, it } from 'vitest';
import { breadcrumb, buildPlanes, nextSlide, prevSlide, zoomIn, type FlatSlide } from './navigation';

// Tree: root plane [a, b, c]; b has children [b1, b2]; c → [c1]; c1 → [c11].
const rows: FlatSlide[] = [
  { id: 'b2', parentSlideId: 'b', position: 1 },
  { id: 'a', parentSlideId: null, position: 0 },
  { id: 'c', parentSlideId: null, position: 2 },
  { id: 'b1', parentSlideId: 'b', position: 0 },
  { id: 'b', parentSlideId: null, position: 1 },
  { id: 'c1', parentSlideId: 'c', position: 0 },
  { id: 'c11', parentSlideId: 'c1', position: 0 },
];

describe('buildPlanes', () => {
  it('groups by parent and sorts by position', () => {
    const planes = buildPlanes(rows);
    expect(planes.get(null)).toEqual(['a', 'b', 'c']);
    expect(planes.get('b')).toEqual(['b1', 'b2']);
  });
});

describe('nextSlide', () => {
  it('walks siblings', () => {
    expect(nextSlide(rows, 'a')).toEqual({ id: 'b', move: 'sibling' });
  });
  it('zooms out past the last child to the parent plane', () => {
    expect(nextSlide(rows, 'b2')).toEqual({ id: 'c', move: 'zoomOut' });
  });
  it('recurses zoom-out through nested last children to null at deck end', () => {
    expect(nextSlide(rows, 'c11')).toBeNull();
  });
  it('returns null at the end of the root plane', () => {
    expect(nextSlide(rows, 'c')).toBeNull();
  });
});

describe('prevSlide', () => {
  it('walks siblings backwards', () => {
    expect(prevSlide(rows, 'c')).toEqual({ id: 'b', move: 'sibling' });
  });
  it('zooms out to the parent from the first child', () => {
    expect(prevSlide(rows, 'b1')).toEqual({ id: 'b', move: 'zoomOut' });
  });
  it('returns null at the first root slide', () => {
    expect(prevSlide(rows, 'a')).toBeNull();
  });
});

describe('zoomIn', () => {
  it('enters the first child', () => {
    expect(zoomIn(rows, 'b')).toBe('b1');
  });
  it('returns null on a leaf', () => {
    expect(zoomIn(rows, 'a')).toBeNull();
  });
});

describe('breadcrumb', () => {
  it('lists ancestors root-first, including current', () => {
    expect(breadcrumb(rows, 'b2')).toEqual(['b', 'b2']);
    expect(breadcrumb(rows, 'c11')).toEqual(['c', 'c1', 'c11']);
    expect(breadcrumb(rows, 'a')).toEqual(['a']);
  });
});
