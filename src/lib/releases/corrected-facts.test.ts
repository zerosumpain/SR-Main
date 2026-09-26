import { describe, expect, it } from 'vitest';
import { correctedFacts, correctedStats } from './corrected-facts';

describe('8 August release boundary', () => {
  const sha = '34aa25fa616c4e1a4ec1ad9ddb9ba9964df12024';
  const original = { commits: 2418, files: 2967, insertions: 646059, deletions: 0, prs: [150] };

  it('uses the actual previous deploy diff for totals and owner evidence', () => {
    expect(correctedStats(sha, original)).toMatchObject({ commits: 1, files: 8, insertions: 235, deletions: 12 });
    const facts = correctedFacts(sha, null, [
      { sha, short: '34aa25fa', author: 'John', date: '', subject: 'Real change', body: '', pr: 150 },
      { sha: 'older', short: 'older', author: 'John', date: '', subject: 'Old change', body: '', pr: null },
    ], []);
    expect(facts.prevSha).toBe('c75b8be5c60bdf263d7f1e084137af9c6d95e1ab');
    expect(facts.commits).toHaveLength(1);
    expect(facts.files.reduce((sum, file) => sum + file.insertions, 0)).toBe(235);
    expect(facts.files.reduce((sum, file) => sum + file.deletions, 0)).toBe(12);
    expect(facts.corrected).toBe(true);
  });
});
