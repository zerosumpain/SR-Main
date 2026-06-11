import { describe, it, expect } from 'vitest';
import { ANALYSES_BY_ID, analysesForLever, analysesForTheme } from './evidence';

describe('Milburn analyses', () => {
  it('the three Milburn analyses exist', () => {
    for (const id of ['milburn-neet-2026', 'milburn-youth-economy', 'milburn-health-driver']) {
      expect(ANALYSES_BY_ID[id]).toBeDefined();
    }
  });
  it('wire to the entry_level lever and the participation-by-design theme', () => {
    expect(analysesForLever('entry_level').map((a) => a.id)).toContain('milburn-youth-economy');
    expect(analysesForTheme('participation-by-design').map((a) => a.id)).toContain('milburn-neet-2026');
  });
});
