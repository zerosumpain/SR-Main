/**
 * Credentials for a git clone/push to GitHub over HTTPS, delivered through the
 * child's ENVIRONMENT rather than its command line or the remote URL.
 *
 * The token used to ride in `https://x-access-token:<token>@github.com/…`,
 * which put it in the process's argv (readable by any process of the account
 * via /proc), in git's own error text, and briefly in `.git/config` after a
 * clone. Git 2.31+ reads `-c`-equivalent config from GIT_CONFIG_COUNT /
 * GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n, so the header reaches git without
 * touching argv or disk.
 *
 * The header is scoped to `https://github.com/`, so a repo-level
 * `url.<x>.insteadOf` that rewrites the remote elsewhere does not carry it.
 * Hooks are switched off for the same command: these run in workspaces the
 * build agent writes, and a planted `pre-push` hook would otherwise run with
 * the credential in its environment.
 */
export function githubGitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  const config: Array<[string, string]> = [
    ['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${basic}`],
    ['core.hooksPath', '/dev/null'],
    ['core.fsmonitor', 'false'],
    ['credential.helper', ''],
  ];
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(config.length), GIT_TERMINAL_PROMPT: '0' };
  config.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/** Token-free HTTPS remote for `owner/repo` — the URL the auth env is scoped to. */
export function githubHttpsRemote(slug: string): string {
  return `https://github.com/${slug}.git`;
}
