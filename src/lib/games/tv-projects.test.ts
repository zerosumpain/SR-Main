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

describe('the addresses', () => {
  it('match the /projects cards', async () => {
    const { PROJECT_CARDS } = await import('../../routes/projects/cards');
    for (const p of tvProjects(() => true)) expect(PROJECT_CARDS.find((c) => c.key === p.key)?.href, p.key).toBe(p.href);
  });
});
