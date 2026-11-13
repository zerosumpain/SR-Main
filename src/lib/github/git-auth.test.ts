import { describe, it, expect } from 'vitest';
import { githubGitAuthEnv, githubHttpsRemote } from './git-auth';

const TOKEN = 'github_pat_fixture0123456789abcdefghij';

describe('githubGitAuthEnv', () => {
  const env = githubGitAuthEnv(TOKEN);
  const pairs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  const config = Object.fromEntries(pairs);

  it('carries the token as a Basic header scoped to github.com', () => {
    const header = config['http.https://github.com/.extraheader'];
    expect(header).toMatch(/^AUTHORIZATION: basic /);
    expect(Buffer.from(header.split(' ').pop()!, 'base64').toString()).toBe(`x-access-token:${TOKEN}`);
  });

  it('switches off hooks and other repo-configured code paths for the command', () => {
    expect(config['core.hooksPath']).toBe('/dev/null');
    expect(config['core.fsmonitor']).toBe('false');
    expect(config['credential.helper']).toBe('');
  });

  it('never puts the token in a URL', () => {
    expect(githubHttpsRemote('owner/repo')).toBe('https://github.com/owner/repo.git');
    expect(githubHttpsRemote('owner/repo')).not.toContain(TOKEN);
  });
});
