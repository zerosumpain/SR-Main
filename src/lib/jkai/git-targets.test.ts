import { describe, it, expect } from 'vitest';
import { ALLOWED_GIT_TARGETS, resolveGitTarget, SR_MAIN_GIT_TARGET } from './git-targets';

/*
 * These pin the boundary that makes it safe for /jkai/builds/new to offer a
 * repo lane at all. The endpoint takes a KEY and looks it up here; it never
 * accepts a repoUrl. Without that, "start a build" becomes "push to any repo
 * the host's deploy key can reach".
 */
describe('git target allow-list', () => {
  it('resolves only the keys in the allow-list', () => {
    expect(resolveGitTarget('sr-main')).toEqual(SR_MAIN_GIT_TARGET);
    for (const key of Object.keys(ALLOWED_GIT_TARGETS)) {
      expect(resolveGitTarget(key)).not.toBeNull();
    }
  });

  it('declines anything else, including a plausible-looking repo url', () => {
    expect(resolveGitTarget('git@github.com:someone/else.git')).toBeNull();
    expect(resolveGitTarget('SR-Main')).toBeNull(); // case-sensitive on purpose
    expect(resolveGitTarget('')).toBeNull();
    expect(resolveGitTarget('__proto__')).toBeNull();
    expect(resolveGitTarget('constructor')).toBeNull();
  });

  it('never returns a target whose repoUrl was not written in this file', () => {
    for (const key of Object.keys(ALLOWED_GIT_TARGETS)) {
      expect(resolveGitTarget(key)!.repoUrl).toMatch(/^git@github\.com:zerosumpain\//);
    }
  });
});

describe('the SR-Main gate proves what a repo build can break', () => {
  /*
   * A repo build has NO path allowlist — the clone is the whole repo, so it can
   * edit `packages/jkai-builder/**`, the agent's own harness. `gate:build` is a
   * vite build of the SITE and says nothing about the sidecar bundle, so a
   * change breaking it would open a green PR and only fail later in
   * ci-stage-builder.sh.
   */
  it('runs the builder bundle in the final gate', () => {
    expect(SR_MAIN_GIT_TARGET.finalGateCommand).toContain('build:builder');
  });

  it('still proves the site build too', () => {
    expect(SR_MAIN_GIT_TARGET.finalGateCommand).toContain('gate:build');
  });

  it('opens a PR rather than pushing to the base branch', () => {
    // The agent's output is always a proposal. There is no auto-merge here.
    expect(SR_MAIN_GIT_TARGET.openPr).toBe(true);
    expect(SR_MAIN_GIT_TARGET.baseBranch).toBe('master');
    expect(SR_MAIN_GIT_TARGET.branchPrefix).toBe('agent/');
  });
});
