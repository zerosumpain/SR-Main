import { exec } from 'child_process';
import { mkdirSync } from 'fs';
import os from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { emitLog } from './log-emitter';

const execAsync = promisify(exec);

const CONTAINER_NAME = 'jkai-sandbox';
const IMAGE_NAME = 'jkai-sandbox:latest';

const SCRAPER_PROFILES_HOST = join(os.homedir(), '.openclaw', 'scraper-profiles');

/**
 * Host-mode dispatch: when JKAI_BUILDS_HOSTMODE=1, this module runs all
 * `execInSandbox` / `writeFileInSandbox` calls directly on the host shell
 * instead of through `docker exec jkai-sandbox …`. Used on the VPS where
 * builds run as user johnk, no container, with the same workspace path
 * (`/home/jkai/workspace/<id>/` — created on the host with the right
 * ownership by deploy-builder.sh / deploy.sh).
 *
 * Scraper code paths (homeserv) leave HOST_MODE off so they keep talking
 * to the jkai-sandbox container, where Chromium + Playwright + the
 * residential-IP scraping environment lives.
 */
const HOST_MODE = process.env.JKAI_BUILDS_HOSTMODE === '1';

export interface SandboxStatus {
  running: boolean;
  containerId?: string;
  image?: string;
  uptime?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// --- Container Management ---

export async function getSandboxStatus(): Promise<SandboxStatus> {
  if (HOST_MODE) {
    // No container — synthetic status so existing UI surfaces still render
    // something sensible. Uptime is the parent process uptime as a proxy.
    return {
      running: true,
      containerId: 'host-mode',
      image: 'host',
      uptime: formatUptime(process.uptime() * 1000),
    };
  }
  try {
    const { stdout } = await execAsync(
      `docker inspect --format '{{.State.Running}}|{{.Id}}|{{.Config.Image}}|{{.State.StartedAt}}' ${CONTAINER_NAME} 2>/dev/null`,
    );
    const [running, id, image, startedAt] = stdout.trim().split('|');
    if (running === 'true') {
      const started = new Date(startedAt);
      const uptime = formatUptime(Date.now() - started.getTime());
      return { running: true, containerId: id.slice(0, 12), image, uptime };
    }
    return { running: false, containerId: id.slice(0, 12), image };
  } catch {
    return { running: false };
  }
}

export async function ensureSandboxRunning(): Promise<void> {
  // Host mode: nothing to ensure — workspace is the host filesystem and the
  // shell is already available. Idempotent.
  if (HOST_MODE) return;
  // Verify-then-fix: trust nothing, always re-inspect before every launch.
  const status = await getSandboxStatus();
  if (status.running) return;

  try {
    await execAsync(`docker image inspect ${IMAGE_NAME} 2>/dev/null`);
  } catch {
    await buildSandboxImage();
  }

  await execAsync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null`).catch(() => {});

  mkdirSync(SCRAPER_PROFILES_HOST, { recursive: true });

  await execAsync(
    `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped ` +
    `--memory 2g --cpus 2 ` +
    `--network bridge -v jkai-workspace:/home/jkai/workspace ` +
    `-v ${SCRAPER_PROFILES_HOST}:/home/jkai/scraper-profiles ${IMAGE_NAME}`,
  );
  clearContainerIpCache();

  // Post-condition check: make sure the container actually came up. A failed
  // `docker run` can succeed at the CLI level but leave the container stopped
  // (e.g. bad image, port conflict). Don't let callers proceed into a dead pipe.
  const after = await getSandboxStatus();
  if (!after.running) {
    throw new Error(
      `Sandbox container ${CONTAINER_NAME} failed to start after docker run`,
    );
  }
}

export async function buildSandboxImage(): Promise<void> {
  const { join } = await import('path');
  const dockerfilePath = join(process.cwd(), 'docker', 'jkai-sandbox');
  await execAsync(`docker build -t ${IMAGE_NAME} ${dockerfilePath}`, { timeout: 300000 });
}

// --- Container IP ---

let cachedContainerIp: string | null = null;

export async function getContainerIp(): Promise<string> {
  // Host mode: the build's preview server runs on the VPS host; reach it via
  // loopback. The /api/jkai/proxy/<id>/* route uses this to locate the build's
  // preview server.
  if (HOST_MODE) return '127.0.0.1';
  if (cachedContainerIp) return cachedContainerIp;
  const { stdout } = await execAsync(
    `docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${CONTAINER_NAME}`,
  );
  cachedContainerIp = stdout.trim();
  return cachedContainerIp;
}

export function clearContainerIpCache(): void {
  cachedContainerIp = null;
}

// --- Code Execution ---

export async function execInSandbox(
  command: string,
  timeout = 120000,
): Promise<ExecResult> {
  // Host mode: run directly on the host shell. The base-64 envelope still
  // applies — agent-supplied commands have arbitrary newlines / quotes.
  if (HOST_MODE) {
    try {
      const b64 = Buffer.from(command).toString('base64');
      const { stdout, stderr } = await execAsync(
        `bash -c "echo '${b64}' | base64 -d | bash"`,
        { timeout, maxBuffer: 5 * 1024 * 1024 },
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code || 1,
      };
    }
  }
  try {
    // Base64-encode the command to preserve newlines and special characters
    const b64 = Buffer.from(command).toString('base64');
    const { stdout, stderr } = await execAsync(
      `docker exec ${CONTAINER_NAME} bash -c "echo '${b64}' | base64 -d > /tmp/jkai-exec.sh && bash /tmp/jkai-exec.sh"`,
      { timeout, maxBuffer: 5 * 1024 * 1024 },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
    };
  }
}

export async function execInSandboxChecked(
  command: string,
  timeout = 120000,
): Promise<ExecResult> {
  const result = await execInSandbox(command, timeout);
  // Detect container-level failures vs normal command failures
  if (result.exitCode !== 0 && (
    result.stderr.includes('No such container') ||
    result.stderr.includes('is not running') ||
    result.stderr.includes('Cannot connect to the Docker daemon')
  )) {
    // Container is dead — try to restart it
    console.error('[jkai] Container appears dead, attempting restart...');
    clearContainerIpCache();
    await ensureSandboxRunning();
    // Retry the command once
    return execInSandbox(command, timeout);
  }
  return result;
}

export async function execBuildCommand(
  command: string,
  workdir: string,
): Promise<ExecResult> {
  return execInSandbox(`cd ${workdir} && ${command}`, 300000);
}

// --- Workspace Management ---

export async function writeFileInSandbox(
  filePath: string,
  content: string,
  timeout = 30000,
): Promise<ExecResult> {
  // Host mode: skip the base-64 shell round-trip and use fs directly. Faster
  // and handles content of any size without bash arg-list limits.
  if (HOST_MODE) {
    try {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return { stdout: `Successfully wrote ${Buffer.byteLength(content)} bytes to ${filePath}`, stderr: '', exitCode: 0 };
    } catch (err: any) {
      return { stdout: '', stderr: err.message ?? String(err), exitCode: 1 };
    }
  }
  // Use base64 encoding to safely pass any content through bash
  const b64 = Buffer.from(content).toString('base64');
  return execInSandbox(
    `echo '${b64}' | base64 -d > ${filePath}`,
    timeout,
  );
}

export async function ensureWorkspace(buildId: string): Promise<string> {
  const base = `/home/jkai/workspace/${buildId}`;
  await execInSandbox(`mkdir -p ${base}/dev ${base}/live`);
  return `${base}/dev`;
}

// --- Git-target workspace (Brass & Rails Forge — flagged) ---
//
// All functions below are only reached when a build carries a non-null
// `gitTargetConfig`. Normal builds never touch this code. Instead of the
// empty dev/live skeleton above, a git-target build clones a real git repo
// into dev/, branches off the base branch, and (at the end) publishes via a
// GitHub PR rather than the static-file publish path.

export interface GitTargetConfig {
  repoUrl: string;
  baseBranch: string;
  branchPrefix: string;
  gateCommand: string;
  openPr: boolean;
  prTitlePrefix?: string;
  /**
   * GitHub issue this build implements, when it came from `request_change`.
   * Appended to the PR body as `Closes #n` so the issue closes on merge even
   * if the agent's own summary forgets to mention it — that link is what makes
   * the history self-documenting (what changed, and why it was asked for).
   */
  issueNumber?: number;
}

// Git identity used for the autonomous commit. The host already has the
// `zerosumpain` SSH key authed for push (see plan prereq 2); this only sets
// the author/committer name+email so `git commit` doesn't fail on a missing
// identity inside the sandbox / under the build user.
const FORGE_GIT_NAME = 'jkai-forge';
const FORGE_GIT_EMAIL = 'forge@strangeramblings.com';

/**
 * Deterministic branch name for a git-target build. Same build id always
 * yields the same branch, so a restart re-uses (and force-updates) the same
 * branch rather than orphaning a new one. Short id keeps the ref readable.
 */
export function gitTargetBranchName(buildId: string, cfg: GitTargetConfig): string {
  const shortId = buildId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'build';
  return `${cfg.branchPrefix}${shortId}`;
}

/**
 * Clone the target repo into the build's dev/ workspace, branch off the base
 * branch, and install deps. Returns the dev path (same contract as
 * `ensureWorkspace`) so the rest of the iteration loop is unchanged.
 */
export async function ensureGitWorkspace(buildId: string, cfg: GitTargetConfig): Promise<string> {
  const base = `/home/jkai/workspace/${buildId}`;
  const dev = `${base}/dev`;
  const branch = gitTargetBranchName(buildId, cfg);

  // Fresh, isolated clone. Wipe any prior dev/ so a restart starts clean.
  await execInSandbox(`mkdir -p ${base} && rm -rf ${dev} && mkdir -p ${base}/live`, 30000);

  // When a GitHub token is provided (the VPS has no `gh` and can't reach the
  // private repo over SSH), clone over token-authenticated HTTPS. Otherwise
  // fall back to the configured repoUrl (homeserv: SSH with the authed key).
  const token = process.env.FORGE_GITHUB_TOKEN;
  const effectiveRemote = token ? tokenRemoteUrl(cfg.repoUrl, token) : cfg.repoUrl;
  const cloneRes = await execInSandbox(
    `git clone --depth 50 --branch ${cfg.baseBranch} ${effectiveRemote} ${dev} 2>&1`,
    300000,
  );
  if (cloneRes.exitCode !== 0) {
    // Redact the token from the command echo (effectiveRemote) and any output.
    throw new Error(
      redactToken(`git clone failed: ${cloneRes.stdout}\n${cloneRes.stderr}`).slice(0, 2000),
    );
  }

  // Configure identity locally + create/reset the work branch off base. When a
  // token is in play, also pin the origin remote to the tokenless SSH URL so no
  // credential is ever persisted in `.git/config` (push re-supplies the token
  // explicitly below).
  const setupRes = await execInSandbox(
    `cd ${dev} && ` +
      `git config user.name "${FORGE_GIT_NAME}" && ` +
      `git config user.email "${FORGE_GIT_EMAIL}" && ` +
      (token ? `git remote set-url origin ${tokenlessRemoteUrl(cfg.repoUrl)} && ` : '') +
      `git checkout -B ${branch} ${cfg.baseBranch} 2>&1`,
    60000,
  );
  if (setupRes.exitCode !== 0) {
    throw new Error(
      redactToken(`git branch setup failed: ${setupRes.stdout}\n${setupRes.stderr}`).slice(0, 2000),
    );
  }

  // Exclude the build harness's own droppings locally (NOT via the repo's
  // tracked .gitignore) so the later `git add -A` in publishViaGit can never
  // stage them into the PR:
  //   serve.json    — preview-server config
  //   index.html    — app-build scaffolding at the repo root
  //   design-system/— the read-only reference mounted by syncDesignAssets
  // The repo-mode system prompt now tells the agent not to create the first two
  // at all; this is the belt to that pair of braces, and it also covers the
  // mounted directory, which the agent does not control.
  await execInSandbox(
    `cd ${dev} && printf '%s\\n' 'serve.json' '/index.html' 'design-system/' >> .git/info/exclude`,
    30000,
  );

  // `--include=dev` is required: the builder runs under NODE_ENV=production,
  // which makes a plain `npm install` skip devDependencies → the gate's
  // `vite build` would fail (exit 127, vite missing). The gate needs devDeps.
  const installRes = await execInSandbox(`cd ${dev} && npm install --include=dev 2>&1 | tail -5`, 300000);
  if (installRes.exitCode !== 0) {
    throw new Error(`npm install failed in git workspace: ${installRes.stdout}\n${installRes.stderr}`.slice(0, 2000));
  }

  return dev;
}

export interface PublishViaGitOptions {
  /** Open the PR as a draft — used to rescue the work of a FAILED build. */
  draft?: boolean;
  summary?: string;
  /**
   * PR title + commit-message subject. This is the build's own `title` column
   * (set at create-time to `Forge: <prompt slice>`), used verbatim so the PR
   * isn't titled with the agent's verbose evaluation text. Already carries any
   * `Forge:` prefix, so `prTitlePrefix` is NOT re-applied when this is set.
   */
  title?: string;
  /** Extra body content for the PR (gate report + diff stat, etc.). */
  body?: string;
}

export interface PublishViaGitResult {
  branch: string;
  prUrl?: string;
  branchRef?: string;
}

/**
 * Commit the agent's work on the build's branch, push it, and (when
 * cfg.openPr) open a GitHub PR. Returns the PR URL (openPr) or the branch
 * ref (push-only). Returns null with a log line when there's nothing to
 * commit. NEVER merges — the human merges on GitHub.
 */
export async function publishViaGit(
  buildId: string,
  cfg: GitTargetConfig,
  opts: PublishViaGitOptions = {},
): Promise<PublishViaGitResult | null> {
  const dev = `/home/jkai/workspace/${buildId}/dev`;
  const branch = gitTargetBranchName(buildId, cfg);
  const summary = (opts.summary ?? 'autonomous changes').replace(/\r?\n/g, ' ').slice(0, 200);
  // Prefer the build's own title (already prefixed) for the PR title + commit
  // subject so we don't surface the agent's verbose evaluation. Fall back to
  // prTitlePrefix+summary, then a sensible default.
  const cleanTitle = (opts.title ?? '').replace(/\r?\n/g, ' ').trim().slice(0, 200);
  const commitMessage =
    cleanTitle || `${cfg.prTitlePrefix ?? ''}${summary}`.trim() || 'Forge: automated change';
  const prTitle = commitMessage;

  // Detect changes before committing. `git status --porcelain` is empty when
  // nothing changed → nothing to publish.
  const statusRes = await execInSandbox(`cd ${dev} && git status --porcelain 2>&1`, 30000);
  if (statusRes.exitCode === 0 && !statusRes.stdout.trim()) {
    await emitLog(buildId, 'system', 'publishViaGit: no changes to commit — skipping publish.');
    return null;
  }

  // Commit (identity is set locally in ensureGitWorkspace; re-assert with -c
  // so a re-clone or fresh checkout can still commit).
  const commitB64 = Buffer.from(commitMessage).toString('base64');
  const commitRes = await execInSandbox(
    `cd ${dev} && git add -A && ` +
      `git -c user.name="${FORGE_GIT_NAME}" -c user.email="${FORGE_GIT_EMAIL}" ` +
      `commit -m "$(echo '${commitB64}' | base64 -d)" 2>&1`,
    60000,
  );
  if (commitRes.exitCode !== 0) {
    // "nothing to commit" can still surface here if only ignored files changed.
    if (/nothing to commit/i.test(commitRes.stdout + commitRes.stderr)) {
      await emitLog(buildId, 'system', 'publishViaGit: nothing to commit after add — skipping publish.');
      return null;
    }
    throw new Error(`git commit failed: ${commitRes.stdout}\n${commitRes.stderr}`.slice(0, 2000));
  }

  // Push the branch. With a token, push to the explicit token-authenticated
  // HTTPS URL (origin is pinned tokenless so nothing leaks into .git/config).
  // Without a token, push to origin (homeserv: SSH with the authed key).
  const token = process.env.FORGE_GITHUB_TOKEN;
  const pushTarget = token ? tokenRemoteUrl(cfg.repoUrl, token) : 'origin';
  const pushRes = await execInSandbox(
    `cd ${dev} && git push -u ${pushTarget} ${branch} --force-with-lease 2>&1`,
    180000,
  );
  if (pushRes.exitCode !== 0) {
    throw new Error(
      redactToken(`git push failed: ${pushRes.stdout}\n${pushRes.stderr}`).slice(0, 2000),
    );
  }
  await emitLog(
    buildId,
    'system',
    `publishViaGit: pushed branch ${branch} to ${redactToken(
      token ? tokenRemoteUrl(cfg.repoUrl, token) : tokenlessRemoteUrl(cfg.repoUrl),
    )}`,
  );

  if (!cfg.openPr) {
    const branchRef = `${cfg.baseBranch}...${branch}`;
    await emitLog(buildId, 'system', `publishViaGit: pushed branch ${branch} (no PR requested).`);
    return { branch, branchRef };
  }

  // Open a PR. The repo slug is derived from the configured repoUrl so the
  // API's hard scope (brass-and-rails only) is the single source of truth.
  const repoSlug = repoSlugFromUrl(cfg.repoUrl);
  let bodyText = opts.body ?? `Autonomous change proposed by the Forge.\n\n${summary}`;
  // Close the originating change-request issue on merge. Added here rather than
  // relying on the agent's summary so the link cannot be lost to phrasing.
  if (cfg.issueNumber) {
    bodyText += `\n\nCloses #${cfg.issueNumber}`;
  }

  // Preferred path: REST API via Node `fetch` with the token. This keeps the
  // token out of the shell/logs entirely and works without `gh`.
  if (token) {
    const prUrl = await openPrViaRestApi(buildId, repoSlug, {
      title: prTitle,
      head: branch,
      base: cfg.baseBranch,
      body: bodyText,
      token,
      draft: opts.draft === true,
    });
    await emitLog(buildId, 'system', `publishViaGit: PR ready → ${prUrl}`);
    return { branch, prUrl };
  }

  // Fallback path (homeserv): no token, but `gh` is available + authed.
  if (!(await ghAvailable())) {
    throw new Error(
      'publishViaGit: cannot open PR — no FORGE_GITHUB_TOKEN and gh unavailable. ' +
        'Set FORGE_GITHUB_TOKEN (VPS) or install/auth gh (homeserv).',
    );
  }
  const bodyB64 = Buffer.from(bodyText).toString('base64');
  const titleB64 = Buffer.from(prTitle).toString('base64');
  const prRes = await execInSandbox(
    `cd ${dev} && gh pr create --repo ${repoSlug} ` +
      `--base ${cfg.baseBranch} --head ${branch} ` +
      `--title "$(echo '${titleB64}' | base64 -d)" ` +
      `--body "$(echo '${bodyB64}' | base64 -d)" 2>&1`,
    120000,
  );
  // gh prints the PR URL on success; on "already exists" it still exits
  // non-zero but the URL is usually in the output — try to recover it.
  const urlMatch = (prRes.stdout + '\n' + prRes.stderr).match(/https:\/\/github\.com\/\S+\/pull\/\d+/);
  if (prRes.exitCode !== 0 && !urlMatch) {
    throw new Error(`gh pr create failed: ${prRes.stdout}\n${prRes.stderr}`.slice(0, 2000));
  }
  const prUrl = urlMatch ? urlMatch[0] : prRes.stdout.trim();
  await emitLog(buildId, 'system', `publishViaGit: PR ready → ${prUrl}`);
  return { branch, prUrl };
}

/**
 * Open a GitHub PR via the REST API using a token. Runs Node-side (`fetch`),
 * never the shell, so the token never touches a command line or a log. Handles
 * the 422 "A pull request already exists" case idempotently by fetching the
 * existing PR for `head` and returning its `html_url`.
 */
async function openPrViaRestApi(
  buildId: string,
  repoSlug: string,
  args: { title: string; head: string; base: string; body: string; token: string; draft?: boolean },
): Promise<string> {
  const { title, head, base, body, token, draft } = args;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'jkai-forge',
  };

  const createRes = await fetch(`https://api.github.com/repos/${repoSlug}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, head, base, body, draft: draft === true }),
  });

  if (createRes.ok) {
    const json: any = await createRes.json().catch(() => ({}));
    if (typeof json.html_url === 'string') return json.html_url;
    throw new Error('GitHub PR API returned 2xx but no html_url');
  }

  // 422 "already exists" → re-runs are idempotent; recover the existing PR url.
  if (createRes.status === 422) {
    const errJson: any = await createRes.json().catch(() => ({}));
    const alreadyExists = JSON.stringify(errJson).toLowerCase().includes('pull request already exists');
    if (alreadyExists) {
      // owner is the slug's first segment; GitHub's `head` filter wants `owner:branch`.
      const owner = repoSlug.split('/')[0];
      const listUrl =
        `https://api.github.com/repos/${repoSlug}/pulls` +
        `?head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}&state=open`;
      const listRes = await fetch(listUrl, { headers });
      if (listRes.ok) {
        const prs: any = await listRes.json().catch(() => []);
        if (Array.isArray(prs) && prs.length > 0 && typeof prs[0].html_url === 'string') {
          await emitLog(
            buildId,
            'system',
            `publishViaGit: PR already exists for ${head} — reusing it.`,
          );
          return prs[0].html_url;
        }
      }
    }
    throw new Error(`GitHub PR API 422: ${JSON.stringify(errJson).slice(0, 1000)}`);
  }

  const text = await createRes.text().catch(() => '');
  throw new Error(`GitHub PR API ${createRes.status}: ${text.slice(0, 1000)}`);
}

/** Derive an `owner/repo` slug from an SSH or HTTPS git URL. */
export function repoSlugFromUrl(repoUrl: string): string {
  // git@github.com:owner/repo.git  |  https://github.com/owner/repo.git
  const m = repoUrl.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : repoUrl;
}

/**
 * Build a token-authenticated HTTPS clone/push URL from any GitHub repo URL
 * (SSH or HTTPS). Used only when FORGE_GITHUB_TOKEN is set — lets clone/push
 * work on hosts (the VPS) that lack `gh` and can't reach the repo over SSH.
 * NEVER log the result directly; use `tokenlessRemoteUrl` / `redactToken` for
 * anything that reaches a log line.
 */
function tokenRemoteUrl(repoUrl: string, token: string): string {
  const slug = repoSlugFromUrl(repoUrl);
  return `https://x-access-token:${token}@github.com/${slug}.git`;
}

/** SSH-style, token-free remote URL — safe to log. */
function tokenlessRemoteUrl(repoUrl: string): string {
  const slug = repoSlugFromUrl(repoUrl);
  return `git@github.com:${slug}.git`;
}

/** Scrub any `x-access-token:<token>@` credentials out of text before logging/storing. */
function redactToken(text: string): string {
  return text.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
}

/** True when a `gh` CLI is on PATH in the sandbox/host. Cached per-process. */
let cachedGhAvailable: boolean | null = null;
async function ghAvailable(): Promise<boolean> {
  if (cachedGhAvailable !== null) return cachedGhAvailable;
  const res = await execInSandbox('command -v gh >/dev/null 2>&1 && echo yes || echo no', 10000);
  cachedGhAvailable = res.exitCode === 0 && res.stdout.trim() === 'yes';
  return cachedGhAvailable;
}

export async function listWorkspaceFiles(buildId: string): Promise<string> {
  const dir = `/home/jkai/workspace/${buildId}/dev`;
  const result = await execInSandbox(
    `find ${dir} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100 | sed 's|${dir}/||'`,
    10000,
  );
  return result.exitCode === 0 ? result.stdout.trim() : '';
}

// --- Mount helpers (design system + jkai-tools extension) ---

export async function syncDesignAssets(buildId: string): Promise<string> {
  const { buildDesignAssets } = await import('./design-assets');
  // Write inside dev/ so the agent's prompt (`./design-system/` relative to
  // workdir, which is dev/) actually resolves. Pre-host-mode this used to
  // live at <buildId>/design-system/ (one level up) — that worked in the
  // container via the workspace volume mount, but on host filesystem the
  // agent can only read paths inside its workdir.
  const dest = `/home/jkai/workspace/${buildId}/dev/design-system`;
  // In host mode, use fs directly — execInSandbox roundtrip via base64 is
  // unnecessary and harder to debug if it ever fails. In container mode,
  // execInSandbox creates the dir inside the named volume.
  if (HOST_MODE) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(`${dest}/examples`, { recursive: true });
  } else {
    await execInSandbox(`mkdir -p ${dest}/examples`);
  }
  const assets = await buildDesignAssets(process.cwd());
  let written = 0;
  let failed = 0;
  for (const [rel, body] of Object.entries(assets)) {
    const r = await writeFileInSandbox(`${dest}/${rel}`, body);
    if (r.exitCode === 0) written++;
    else failed++;
  }
  if (failed > 0) {
    throw new Error(`syncDesignAssets: ${failed}/${written + failed} writes failed (dest=${dest})`);
  }
  return dest;
}

// Base64 of a file over roughly this many characters risks tripping Linux's
// MAX_ARG_STRLEN (128KB) once it's embedded in the `echo '<b64>' | base64 -d`
// command writeFileInSandbox's non-HOST_MODE path builds. three.min.js's
// ~893KB of base64 is the concrete case that forced this — it fails with
// "Argument list too long" as a single `echo` argument.
const CHUNKED_WRITE_B64_THRESHOLD = 60_000;

/**
 * Split a base64 string into `size`-char slices, preserving order so that
 * rejoining them (`slices.join('')`) reproduces the input exactly. Pure and
 * side-effect free so the chunked-write path can be unit-tested without a
 * sandbox.
 */
export function sliceBase64(b64: string, size = CHUNKED_WRITE_B64_THRESHOLD): string[] {
  const slices: string[] = [];
  for (let i = 0; i < b64.length; i += size) {
    slices.push(b64.slice(i, i + size));
  }
  return slices;
}

/**
 * writeFileInSandbox's non-HOST_MODE path for files whose base64 blows past
 * the shell's single-argument length cap (see CHUNKED_WRITE_B64_THRESHOLD
 * above). Writes the base64 to a side file in `printf … >>` slices, decodes it
 * in one shot, then verifies the decoded byte count — a silently truncated
 * three.min.js would be worse than a missing one, so a mismatch is a hard
 * failure rather than a logged warning.
 *
 * Every failure branch best-effort cleans up BOTH the `.b64` side file and the
 * destination path before returning. Without that, a failed write can leave a
 * corrupt (partial or wrong-length) artifact on disk instead of no artifact at
 * all — exactly the outcome the byte-count check above exists to prevent, so
 * leaving a bad file behind on the way out would undo the point of checking.
 *
 * `exec` is injectable (defaults to the real `execInSandbox`) purely so tests
 * can stub each failure mode and assert the cleanup command actually ran,
 * without needing a real sandbox.
 */
export async function writeFileInSandboxChunked(
  filePath: string,
  content: string,
  exec: typeof execInSandbox = execInSandbox,
): Promise<ExecResult> {
  const b64 = Buffer.from(content).toString('base64');
  const b64Path = `${filePath}.b64`;
  const cleanup = () => exec(`rm -f ${b64Path} ${filePath}`).catch(() => {});
  const slices = sliceBase64(b64);
  for (let i = 0; i < slices.length; i++) {
    const op = i === 0 ? '>' : '>>';
    const r = await exec(`printf '%s' '${slices[i]}' ${op} ${b64Path}`);
    if (r.exitCode !== 0) {
      await cleanup();
      return { ...r, stderr: `chunk ${i + 1}/${slices.length} write failed for ${b64Path}: ${r.stderr}` };
    }
  }
  const decode = await exec(`base64 -d < ${b64Path} > ${filePath} && rm -f ${b64Path}`);
  if (decode.exitCode !== 0) {
    await cleanup();
    return decode;
  }
  const expectedBytes = Buffer.byteLength(content);
  const check = await exec(`wc -c < ${filePath}`);
  const actualBytes = parseInt(check.stdout.trim(), 10);
  if (check.exitCode !== 0 || actualBytes !== expectedBytes) {
    await cleanup();
    return {
      stdout: check.stdout,
      stderr: `chunked write verification failed for ${filePath}: expected ${expectedBytes} bytes, decoded ${Number.isNaN(actualBytes) ? 'unknown' : actualBytes}`,
      exitCode: 1,
    };
  }
  return {
    stdout: `Successfully wrote ${expectedBytes} bytes to ${filePath} (chunked, ${slices.length} slices)`,
    stderr: '',
    exitCode: 0,
  };
}

export async function syncExplainerKit(buildId: string): Promise<string> {
  const { buildExplainerAssets } = await import('./design-assets');
  const dest = `/home/jkai/workspace/${buildId}/dev/explainer-kit`;
  if (HOST_MODE) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(`${dest}/examples`, { recursive: true });
  } else {
    await execInSandbox(`mkdir -p ${dest}/examples`);
  }
  const assets = await buildExplainerAssets(process.cwd());
  let written = 0;
  // Per-file `rel: stderr` diagnosis, not just a pass/fail count — a
  // byte-mismatch on three.min.js and a permissions error on README.md used to
  // both collapse into an identical "N/M writes failed" message, which left
  // nobody reading the build log able to tell which file broke or why.
  const failures: string[] = [];
  for (const [rel, body] of Object.entries(assets)) {
    const filePath = `${dest}/${rel}`;
    // HOST_MODE (writeFileInSandbox's fs.writeFile branch) has no arg-length
    // limit; only the shell-echo branch below it does, so chunking is only
    // ever needed off HOST_MODE.
    const needsChunking =
      !HOST_MODE && Buffer.from(body).toString('base64').length > CHUNKED_WRITE_B64_THRESHOLD;
    const r = needsChunking
      ? await writeFileInSandboxChunked(filePath, body)
      : await writeFileInSandbox(filePath, body);
    if (r.exitCode === 0) written++;
    else failures.push(`${rel}: ${r.stderr.trim()}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `syncExplainerKit: ${failures.length}/${written + failures.length} writes failed (dest=${dest}) — ${failures.join('; ')}`,
    );
  }
  return dest;
}

export async function syncJkaiExtension(buildId: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dest = `/home/jkai/workspace/${buildId}/extensions/jkai-tools`;
  await execInSandbox(`mkdir -p ${dest}`);
  // Try the source path first (dev), then the production build artifact
  // path that vite-build emits to. SvelteKit copies static/* into
  // build/client/*, so on the deployed VPS only build/client/jkai-extensions
  // exists.
  const candidates = [
    join(process.cwd(), 'static/jkai-extensions/jkai-tools.js'),
    join(process.cwd(), 'build/client/jkai-extensions/jkai-tools.js'),
  ];
  let src = '';
  for (const c of candidates) {
    try { src = await readFile(c, 'utf-8'); break; } catch { /* try next */ }
  }
  if (!src) throw new Error(`jkai-tools.js not found in any of: ${candidates.join(', ')}`);
  await writeFileInSandbox(`${dest}/index.js`, src);
  return `${dest}/index.js`;
}

// --- Read-only file inspection (Watch pane) ---

export async function listDevFiles(
  buildId: string,
): Promise<Array<{ path: string; size: number; mtime: number }>> {
  const root = `/home/jkai/workspace/${buildId}/dev`;
  const result = await execInSandbox(
    `find ${root} -maxdepth 6 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -printf '%P\\t%s\\t%T@\\n' 2>/dev/null | head -500`,
    10000,
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [p, sz, mt] = line.split('\t');
      return {
        path: p ?? '',
        size: parseInt(sz || '0', 10),
        mtime: Math.floor(parseFloat(mt || '0')),
      };
    })
    .filter((f) => f.path);
}

export async function readDevFile(buildId: string, relPath: string): Promise<string> {
  const safe = relPath.replace(/\.\./g, '').replace(/^\/+/, '');
  const result = await execInSandbox(
    `cat /home/jkai/workspace/${buildId}/dev/${safe}`,
    10000,
  );
  return result.exitCode === 0 ? result.stdout : '';
}

export async function writeDevFile(buildId: string, relPath: string, content: string): Promise<void> {
  const safe = relPath.replace(/\.\./g, '').replace(/^\/+/, '');
  if (!safe) throw new Error('relPath required');
  await writeFileInSandbox(`/home/jkai/workspace/${buildId}/dev/${safe}`, content);
}

export async function resetWorkspace(buildId: string): Promise<void> {
  const dir = `/home/jkai/workspace/${buildId}/dev`;
  await execInSandbox(`rm -rf ${dir} && mkdir -p ${dir}`);
}

export async function snapshotNow(buildId: string): Promise<number> {
  const all = await listSnapshots(buildId);
  // Out-of-band slot: highest existing slot + 1000 so it doesn't collide with
  // future iteration numbers.
  const highest = all.length > 0 ? Math.max(...all) : 0;
  const next = highest + 1000;
  await snapshotIteration(buildId, next);
  return next;
}

// --- Port Allocation ---

const PORT_RANGE_START = 8000;
const PORT_RANGE_END = 8999;

/**
 * Deterministic port per build in the 8000-8999 range.
 * Hash the build ID so the same build always gets the same port — avoids
 * races and makes restarts idempotent. Collisions between different builds
 * are resolved by scanning for a free port nearby.
 */
export async function allocatePort(buildId: string): Promise<number> {
  let hash = 0;
  for (let i = 0; i < buildId.length; i++) {
    hash = (hash * 31 + buildId.charCodeAt(i)) | 0;
  }
  const base = PORT_RANGE_START + (Math.abs(hash) % (PORT_RANGE_END - PORT_RANGE_START));

  // Probe successive ports; pick the first one not currently bound inside the sandbox.
  // Read /proc/net/tcp directly (no ss/netstat dependency) — entries have hex-encoded
  // local_port in column 2, e.g. "0100007F:1F40" = 127.0.0.1:8000.
  const probeResult = await execInSandbox(
    `awk 'NR>1 { split($2,a,":"); print strtonum("0x"a[2]) }' /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u`,
    5000,
  );
  const busy = new Set<number>(
    probeResult.stdout.split('\n').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)),
  );
  for (let offset = 0; offset < 200; offset++) {
    const port = PORT_RANGE_START + ((base - PORT_RANGE_START + offset) % (PORT_RANGE_END - PORT_RANGE_START));
    if (!busy.has(port)) return port;
  }
  return base;
}

// --- Serve Management ---

export async function readServeJson(buildId: string): Promise<any | null> {
  const dir = `/home/jkai/workspace/${buildId}/dev`;
  const result = await execInSandbox(`cat ${dir}/serve.json 2>/dev/null`, 5000);
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Kill the server owned by `buildId` (tracked via per-build pid file).
 * If called with no buildId, falls back to the legacy global pid file for
 * backwards compatibility with already-running single-build sandboxes.
 */
export async function killProjectServer(buildId?: string): Promise<void> {
  const pidFile = buildId ? `/tmp/jkai-serve-${buildId}.pid` : '/tmp/jkai-serve.pid';
  await execInSandbox(
    `if [ -f ${pidFile} ]; then kill $(cat ${pidFile}) 2>/dev/null; rm -f ${pidFile}; fi`,
    5000,
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
}

/**
 * Read the tail of the per-build server log so callers can surface the
 * last lines as a system log when the health check fails. Returns an
 * empty string on missing file.
 */
export async function readProjectServerLogTail(buildId: string, lines = 30): Promise<string> {
  const logFile = `/tmp/jkai-serve-${buildId}.log`;
  const result = await execInSandbox(
    `tail -n ${lines} ${logFile} 2>/dev/null || true`,
    5000,
  );
  return result.stdout ?? '';
}

export async function startProjectServer(
  buildId: string,
  startCommand: string,
  port: number,
  healthCheck: string,
): Promise<boolean> {
  await killProjectServer(buildId);

  const dir = `/home/jkai/workspace/${buildId}/live`;
  const pidFile = `/tmp/jkai-serve-${buildId}.pid`;
  const logFile = `/tmp/jkai-serve-${buildId}.log`;
  await execInSandbox(
    `cd ${dir} && nohup bash -c '${startCommand.replace(/'/g, "'\\''")}' > ${logFile} 2>&1 & echo $! > ${pidFile}`,
    10000,
  );

  const maxAttempts = 60; // 120 seconds total — npm run dev / framework boots can be slow
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const check = await execInSandbox(
      `curl -sf http://localhost:${port}${healthCheck} > /dev/null 2>&1 && echo OK`,
      5000,
    );
    if (check.stdout.trim() === 'OK') return true;
  }
  return false;
}

// --- Dev/Live Workspace Management ---

/**
 * Marker touched at the end of every successful promotion.
 *
 * Deliberately outside both trees: anything inside live/ is copied into dev/
 * by the seed and then served and published.
 */
const promoteMarker = (base: string) => `${base}/.last-promote`;

export async function promoteDevToLive(buildId: string): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  // Clear live (except node_modules) then copy dev contents.
  // The marker is touched LAST and only on success, so a promotion that dies
  // half way leaves the previous marker in place and `seedDevFromLive` treats
  // dev/ as unpromoted — which is the safe reading.
  await execInSandbox(
    `find ${base}/live -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + 2>/dev/null; cp -a ${base}/dev/. ${base}/live/ 2>/dev/null && touch ${promoteMarker(base)}; echo done`,
    120000,
  );
}

/**
 * Restore dev/ from the last promoted state — without destroying work that was
 * never promoted.
 *
 * This function used to open with an unconditional
 * `find dev -mindepth 1 -maxdepth 1 -exec rm -rf {} +`. Promotion happens only
 * on the happy path, so any iteration that ended early — a provider 503, a
 * token cap, a failed database write — had its files deleted at the start of
 * the next one. On build 85dac418 that destroyed 57% of the tokens the build
 * ever spent, across seven iterations, while the in-code comments promised
 * "partial work is preserved in dev/".
 *
 * The orchestrator now promotes before it can return early, so in the normal
 * case nothing in dev/ is newer than the marker and the wipe is safe. This
 * guard is the backstop for the case that promotion itself did not run: if
 * dev/ holds anything written since the last promotion, overlay live/ on top
 * instead of clearing first, and keep the unpromoted work.
 */
export async function seedDevFromLive(buildId: string): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  const liveCheck = await execInSandbox(`ls ${base}/live/ 2>/dev/null | head -1`, 5000);
  if (!liveCheck.stdout.trim()) return;

  const marker = promoteMarker(base);
  // No marker at all means this build predates the marker (or has never
  // promoted). Treat that as "cannot prove dev/ is disposable" and keep it.
  const unpromoted = await execInSandbox(
    `test -e ${marker} || { echo UNPROMOTED; exit 0; }; find ${base}/dev -mindepth 1 -newer ${marker} -print -quit 2>/dev/null | head -1`,
    10000,
  );
  const keepDev = unpromoted.stdout.trim().length > 0;

  await execInSandbox(seedDevCommand(base, keepDev), 120000);
}

/**
 * The two shapes of the seed step, split out so the destructive one can be
 * pinned by a test. `keepUnpromotedWork` overlays; the other clears first.
 */
export function seedDevCommand(base: string, keepUnpromotedWork: boolean): string {
  const copy = `cp -a ${base}/live/. ${base}/dev/ 2>/dev/null; echo done`;
  if (keepUnpromotedWork) return copy;
  return `find ${base}/dev -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null; ${copy}`;
}

/**
 * How many chapters are actually finished in the promoted tree.
 *
 * A chapter counts as built when its page no longer carries the skeleton's
 * `data-chapter-status="placeholder"` marker — the same signal the studio gate
 * reads, so the two cannot disagree about what "done" means.
 *
 * This exists because the gate's deadline used to be `iterationNumber - 1`,
 * which assumes exactly one chapter per iteration. It rises whether or not a
 * chapter landed, so on build 85dac418 each delivered chapter cleared one
 * still-placeholder finding and added two others — a net +1 for succeeding.
 * Progress has to be measured against the artefact, not the clock.
 */
export async function countBuiltChapters(buildId: string): Promise<number> {
  const base = `/home/jkai/workspace/${buildId}`;
  // grep -L lists files NOT containing the marker. `|| true` because grep
  // exits non-zero when nothing matches, which is a legitimate zero here.
  const res = await execInSandbox(
    `grep -L 'data-chapter-status="placeholder"' ${base}/live/chapter-*/index.html 2>/dev/null | wc -l || true`,
    10000,
  );
  return parseBuiltChapterCount(res.stdout);
}

/**
 * Read `wc -l` output into a count.
 *
 * Anything unreadable becomes 0, which makes only chapter 1 due — the
 * conservative direction. Guessing high would invent still-placeholder
 * findings for chapters the agent has not reached, which is the exact failure
 * this whole change exists to remove.
 */
export function parseBuiltChapterCount(stdout: string): number {
  const n = Number.parseInt((stdout ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// --- Iteration Snapshots ---

export async function snapshotIteration(buildId: string, iterationNumber: number): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  const snapDir = `${base}/snapshots/${iterationNumber}`;
  await execInSandbox(`rm -rf ${snapDir} && mkdir -p ${snapDir}`, 5000);
  // Copy dev to snapshot, excluding node_modules and .git for space
  await execInSandbox(
    `cd ${base}/dev && find . -maxdepth 1 ! -name node_modules ! -name .git ! -name . -exec cp -a {} ${snapDir}/ \\;`,
    60000,
  );
}

export async function activateSnapshot(
  buildId: string,
  iterationNumber: number,
  startCommand: string,
  port: number,
  healthCheck: string,
): Promise<boolean> {
  const base = `/home/jkai/workspace/${buildId}`;
  const snapDir = `${base}/snapshots/${iterationNumber}`;

  // Check snapshot exists
  const check = await execInSandbox(`test -d ${snapDir} && echo OK`, 5000);
  if (check.stdout.trim() !== 'OK') return false;

  // Copy snapshot to live (keep node_modules in live)
  await execInSandbox(
    `find ${base}/live -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + 2>/dev/null; cp -a ${snapDir}/. ${base}/live/ 2>/dev/null; echo done`,
    120000,
  );

  // Restart server from live (kill only this build's process)
  await killProjectServer(buildId);
  return startProjectServer(buildId, startCommand, port, healthCheck);
}

export async function listSnapshots(buildId: string): Promise<number[]> {
  const base = `/home/jkai/workspace/${buildId}`;
  const result = await execInSandbox(
    `ls -1 ${base}/snapshots/ 2>/dev/null | sort -n`,
    5000,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split('\n').map(Number).filter(n => !isNaN(n));
}

// --- Publishing (copy live files out of sandbox to local filesystem + VPS) ---

const PUBLISHED_DIR = `${process.cwd()}/data/jkai-projects`;

const VPS_HOST = '157.180.19.38';
const VPS_USER = 'johnk';
const VPS_KEY = `${process.env.HOME}/.ssh/id_ed25519`;
const VPS_PUBLISHED_DIR = '/opt/strange-rambling-svelte/data/jkai-projects';

function isRunningOnVps(): boolean {
  // If the published dir is already the VPS path, we're on the VPS
  return PUBLISHED_DIR === VPS_PUBLISHED_DIR;
}

async function syncToVps(localDir: string, slug: string): Promise<void> {
  if (isRunningOnVps()) return; // Already on VPS, files are in place
  try {
    await execAsync(
      `ssh -i ${VPS_KEY} ${VPS_USER}@${VPS_HOST} "mkdir -p ${VPS_PUBLISHED_DIR}/${slug}"`,
      { timeout: 10000 },
    );
    await execAsync(
      `rsync -avz --delete -e "ssh -i ${VPS_KEY}" ${localDir}/ ${VPS_USER}@${VPS_HOST}:${VPS_PUBLISHED_DIR}/${slug}/`,
      { timeout: 120000 },
    );
  } catch (err) {
    console.error('[jkai] VPS sync failed (non-fatal):', err);
  }
}

async function removeFromVps(slug: string): Promise<void> {
  if (isRunningOnVps()) return;
  try {
    await execAsync(
      `ssh -i ${VPS_KEY} ${VPS_USER}@${VPS_HOST} "rm -rf ${VPS_PUBLISHED_DIR}/${slug}"`,
      { timeout: 10000 },
    );
  } catch (err) {
    console.error('[jkai] VPS remove failed (non-fatal):', err);
  }
}

/**
 * Inject a <base href> into index.html so relative asset/data paths resolve correctly
 * when served from /projects/{slug}/
 */
async function injectBaseHref(destDir: string, slug: string): Promise<void> {
  const { readFileSync, writeFileSync, existsSync } = await import('fs');
  const indexPath = `${destDir}/index.html`;
  if (!existsSync(indexPath)) return;

  let html = readFileSync(indexPath, 'utf-8');
  const baseTag = `<base href="/projects/${slug}/">`;

  // Don't double-inject
  if (html.includes('<base href=')) return;

  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>${baseTag}`);
  } else if (html.includes('<head ')) {
    html = html.replace(/<head([^>]*)>/, `<head$1>${baseTag}`);
  } else if (html.includes('<html')) {
    html = html.replace(/<html([^>]*)>/, `<html$1><head>${baseTag}</head>`);
  } else {
    html = baseTag + html;
  }

  writeFileSync(indexPath, html);
}

export async function publishBuild(buildId: string, slug: string): Promise<string> {
  const { mkdirSync, rmSync, existsSync } = await import('fs');
  const destDir = `${PUBLISHED_DIR}/${slug}`;
  const liveDir = `/home/jkai/workspace/${buildId}/live`;

  // Refuse an empty workspace rather than publishing a blank directory.
  // The Publish button used to be hidden unless the build had a serveConfig,
  // which stood in for "it produced something" — but serveConfig only records
  // how to RUN a build, so that gate also hid every static site the builder
  // ever made. Promotion is now offered for any finished build, and this is the
  // check that actually matters: is there anything on disk to copy?
  const hasFiles = await execInSandbox(
    `test -d ${liveDir} && [ -n "$(ls -A ${liveDir} 2>/dev/null)" ] && echo YES`,
    5000,
  );
  if (hasFiles.stdout.trim() !== 'YES') {
    throw new Error(
      'This build has no files in its workspace, so there is nothing to publish. ' +
        'Failed builds keep their work at /home/jkai/workspace/<id>/dev — resume or restart it first.',
    );
  }

  // Try to produce a static build inside the sandbox first
  // Check for package.json with a build script
  const hasBuildScript = await execInSandbox(
    `cd ${liveDir} && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)" 2>/dev/null`,
    5000,
  );

  if (hasBuildScript.exitCode === 0) {
    // Install deps if needed and run build
    await execInSandbox(`cd ${liveDir} && npm install --prefer-offline 2>&1 | tail -3`, 120000);
    const buildResult = await execInSandbox(`cd ${liveDir} && npm run build 2>&1 | tail -20`, 120000);

    if (buildResult.exitCode === 0) {
      // Check for common build output directories
      const distCheck = await execInSandbox(
        `cd ${liveDir} && for d in dist build public/build out .next/static; do [ -d "$d" ] && echo "$d" && break; done`,
        5000,
      );
      if (distCheck.stdout.trim()) {
        // Copy build output instead of full source
        rmSync(destDir, { recursive: true, force: true });
        mkdirSync(destDir, { recursive: true });
        const buildDir = `${liveDir}/${distCheck.stdout.trim()}`;
        if (HOST_MODE) {
          await execAsync(`cp -a ${buildDir}/. ${destDir}/`, { timeout: 120000 });
        } else {
          await execAsync(`docker cp ${CONTAINER_NAME}:${buildDir}/. ${destDir}/`, { timeout: 120000 });
        }
        // Also copy index.html from root if the build dir doesn't have one
        if (!existsSync(`${destDir}/index.html`)) {
          const cpCmd = HOST_MODE
            ? `cp ${liveDir}/index.html ${destDir}/ 2>/dev/null`
            : `docker cp ${CONTAINER_NAME}:${liveDir}/index.html ${destDir}/ 2>/dev/null`;
          await execAsync(cpCmd, { timeout: 10000 }).catch(() => {});
        }
        await injectBaseHref(destDir, slug);
        await syncToVps(destDir, slug);
        return destDir;
      }
    }
    // Build failed or no dist dir — fall through to full copy
  }

  // For Python projects with templates/static dirs, try to grab those specifically
  const hasPythonTemplates = await execInSandbox(
    `test -d ${liveDir}/templates -o -d ${liveDir}/static && echo YES`,
    5000,
  );

  // Full copy — the project is either static already or we can't easily extract just the frontend
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  if (HOST_MODE) {
    await execAsync(`cp -a ${liveDir}/. ${destDir}/`, { timeout: 120000 });
  } else {
    await execAsync(`docker cp ${CONTAINER_NAME}:${liveDir}/. ${destDir}/`, { timeout: 120000 });
  }

  // Clean up server-side artifacts that won't work outside the sandbox
  rmSync(`${destDir}/node_modules`, { recursive: true, force: true });
  rmSync(`${destDir}/.git`, { recursive: true, force: true });
  rmSync(`${destDir}/__pycache__`, { recursive: true, force: true });
  rmSync(`${destDir}/.venv`, { recursive: true, force: true });

  // If it's a Python project with templates, restructure for static serving:
  // Move templates/index.html to root index.html if no root index exists
  if (hasPythonTemplates.stdout.trim() === 'YES' && !existsSync(`${destDir}/index.html`)) {
    const { readdirSync, copyFileSync } = await import('fs');
    const templatesDir = `${destDir}/templates`;
    if (existsSync(templatesDir)) {
      try {
        const templates = readdirSync(templatesDir);
        const index = templates.find(f => f === 'index.html' || f === 'base.html');
        if (index) copyFileSync(`${templatesDir}/${index}`, `${destDir}/index.html`);
      } catch {}
    }
  }

  await injectBaseHref(destDir, slug);
  await syncToVps(destDir, slug);
  return destDir;
}

export async function unpublishBuild(slug: string): Promise<void> {
  const { rmSync } = await import('fs');
  const destDir = `${PUBLISHED_DIR}/${slug}`;
  rmSync(destDir, { recursive: true, force: true });
  await removeFromVps(slug);
}

export function getPublishedDir(): string {
  return PUBLISHED_DIR;
}

// --- Utilities ---

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
