import { describe, expect, it } from 'vitest';
import { tvProjects } from './tv-projects';

describe('tvProjects', () => {
  it('offers only public projects, in row order, with their card addresses', () => {
    const out = tvProjects((key) => key !== 'archetype');
    expect(out.map((p) => p.key)).not.toContain('archetype');
    expect(out.find((p) => p.key === 'policy-engine')).toMatchObject({ title: 'Schools simulator', href: '/projects/policy-engine' });
  });

  it('offers nothing when nothing is public', () => {
    expect(tvProjects(() => false)).toEqual([]);
  });
});
