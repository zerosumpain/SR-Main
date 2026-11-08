import { describe, expect, it } from 'vitest';
import { canonicalProject, INFRA_PROJECT, SITE_PROJECT } from './session-projects.mjs';

describe('session project names', () => {
  it('folds deleted worktrees and non-repo folders into the repository they worked on', () => {
    expect(canonicalProject('jkai-overhaul-20261028')).toBe(SITE_PROJECT);
    expect(canonicalProject('sr-daydream-redteam-20261002')).toBe(SITE_PROJECT);
    expect(canonicalProject('casebook-lanes')).toBe('casebook');
    expect(canonicalProject('policy-lab-spine')).toBe('policy-lab');
    expect(canonicalProject('SR-AppleApp-bike')).toBe('SR-AppleApp');
    expect(canonicalProject('lpn-plan-checker-20261007')).toBe('local-plan-navigator');
    expect(canonicalProject('docker')).toBe(INFRA_PROJECT);
    expect(canonicalProject('bin')).toBe(INFRA_PROJECT);
  });

  it('leaves canonical names and unknown folders alone', () => {
    for (const name of [SITE_PROJECT, 'sr-drive', 'wildmind', 'SR-AppleApp', 'marbler', 'terminal-descent', 'schools-telecoms']) {
      expect(canonicalProject(name)).toBe(name);
    }
    expect(canonicalProject('binoculars')).toBe('binoculars');
    expect(canonicalProject('')).toBe('unknown');
  });
});
