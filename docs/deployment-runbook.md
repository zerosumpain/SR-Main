# Deployment fast path

Use this order when a production page looks older than the merged code. It
separates a server release problem from a stale browser or installed PWA before
any rebuild starts.

## 1. Diagnose first

```bash
npm run deploy:status
```

The command compares the uncached public `/api/version` response with GitHub's
current `master` SHA (falling back to local `origin/master`) and prints the latest
master workflow. If the SHAs match, do not
redeploy: reopen the installed PWA or use its **Update now** notice. If they do
not match, inspect the reported workflow URL and repair or re-run only the failed
stage.

To check another environment or commit:

```bash
./scripts/deploy-status.sh https://example.test <expected-sha>
```

## 2. Validate a change once

```bash
npm run validate:change
```

This command uses the merge base with `origin/master`, supplies the public
placeholder required by SvelteKit, gives the type checker its configured heap,
starts an isolated disposable Postgres when needed, and runs scoped tests for
ordinary source changes. It also pins the test timezone to UTC, matching CI.
Wide changes still get the full non-integration suite. The production build runs
in CI, where its artifact can be promoted; repeating it locally adds time but
cannot supply that artifact.

## 3. What CI does

For a normal source PR, type checking, scoped tests, and a real production build
run in parallel. The build is stored under its Git tree hash. After merge,
master reuses it only when all of these are true:

- the artifact tree exactly equals the master tree;
- the PR run's `Gate (check + test)` job succeeded;
- the build-time public environment hash equals production;
- the artifact contains a verified adapter-node server bundle.

Master then restamps the candidate for the merge SHA and releases it. If any
condition is missing or uncertain, CI automatically falls back to the full
master checks and a fresh build. Direct pushes therefore remain fail-closed.

Superseded PR runs are cancelled to free hosted-runner capacity. Master runs are
never cancelled in progress.

## Expected timing

- Cache/PWA diagnosis: under 2 minutes, no deployment.
- PR gate: approximately the duration of the longest of build or type check.
- Green squash merge to live: artifact download, staging, and release only;
  normally around 1–2 minutes.
- Fallback/direct-push path: the previous full build-and-gate duration.
