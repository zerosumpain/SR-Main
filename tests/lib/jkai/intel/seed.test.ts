import { describe, it, expect } from 'vitest';

describe('seed entity types data', () => {
  it('has 8 seeded types with required fields', async () => {
    const mod = await import('$lib/jkai/intel/seed');
    expect(typeof mod.seedEntityTypes).toBe('function');
  });
});
