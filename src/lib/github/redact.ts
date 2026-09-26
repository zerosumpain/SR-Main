// src/lib/github/redact.ts
//
// The one scrubber for GitHub credentials in text that may reach a log line, a
// build event, a stored error or a thrown message. It replaced three private
// copies (sandbox.ts `redactToken`, development-release `redactCommandOutput`,
// pr.ts `redact`) that each caught a different subset, so a path that used the
// weakest one leaked what the others would have stopped.
//
// What it removes, in order:
//
//  1. `execInSandbox`'s envelope. It runs
//     `bash -c "echo '<base64 of the whole command>' | base64 -d | bash"` and on
//     failure returns `err.stderr || err.message` — so a command that dies
//     without writing to stderr (a timeout, an exceeded buffer) comes back as
//     Node's own message quoting that envelope, with the token inside it,
//     base64-encoded, where a search for the literal string never finds it.
//  2. Any long base64 run, for the same reason.
//  3. The literal token, when the caller knows it.
//  4. `x-access-token:<anything>@` credentials in a remote URL.
//  5. Anything shaped like a GitHub token (`ghp_…`, `gho_…`, `github_pat_…`),
//     whether or not the caller knew it.

const GITHUB_TOKEN_RE = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

export function redactGitHubSecrets(text: string, token?: string | null): string {
  let out = text.replace(/Command failed:[^\n]*/g, 'The command failed.');
  out = out.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[…]');
  if (token) out = out.split(token).join('***');
  out = out.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
  return out.replace(GITHUB_TOKEN_RE, '<redacted>');
}
