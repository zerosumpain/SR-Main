import { describe, it, expect } from 'vitest';
import { isArtifact, type Artifact } from '$lib/workflows/site-tools/artifact-types';

describe('isArtifact', () => {
  it('accepts a chart artifact', () => {
    const a: Artifact = {
      type: 'chart',
      spec: { mark: 'line', encoding: {} },
      data: [{ x: 1, y: 2 }],
    };
    expect(isArtifact(a)).toBe(true);
  });

  it('accepts a map artifact with a single points layer', () => {
    const a: Artifact = {
      type: 'map',
      layers: [{ kind: 'points', points: [{ lat: 51.5, lng: -0.1 }] }],
    };
    expect(isArtifact(a)).toBe(true);
  });

  it('accepts a table artifact', () => {
    const a: Artifact = {
      type: 'table',
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ name: 'alice' }],
    };
    expect(isArtifact(a)).toBe(true);
  });

  it('rejects a plain object', () => {
    expect(isArtifact({})).toBe(false);
    expect(isArtifact({ type: 'nope' })).toBe(false);
    expect(isArtifact(null)).toBe(false);
  });
});
