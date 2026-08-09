import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from '../registry';
import { isPathAllowed, NODE_BUILDER_PATH_ALLOWLIST, runProcess } from './node-builder-shared';


register({
  name: 'node_builder_check_clean',
  description:
    'Pre-flight check before building a new workflow node. Confirms the repo working tree is clean, on master, and not in a merge state. Returns { ok: true } or { ok: false, reason }.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: async () => {
    const status = await runProcess('git', ['status', '--porcelain'], {});
    if (!status.ok) {
      return { success: false, error: `git status failed: ${status.stderr}` };
    }
    if (status.stdout.trim().length > 0) {
      return {
        success: true,
        data: { ok: false, reason: 'working tree is dirty' },
      };
    }

    const branch = await runProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {});
    if (!branch.ok) {
      return { success: false, error: `git rev-parse failed: ${branch.stderr}` };
    }
    if (branch.stdout.trim() !== 'master') {
      return {
        success: true,
        data: {
          ok: false,
          reason: `on branch ${branch.stdout.trim()}, not master`,
        },
      };
    }

    if (existsSync(path.join(process.cwd(), '.git/MERGE_HEAD'))) {
      return {
        success: true,
        data: { ok: false, reason: 'merge in progress' },
      };
    }

    return { success: true, data: { ok: true } };
  },
});

register({
  name: 'node_builder_list_existing',
  description:
    'Lists every registered workflow node type so the caller can decide whether an existing node covers a request before generating a new one.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: async () => {
    const { registry } = await import('$lib/workflows');
    const nodes = registry
      .listDefinitions()
      .map((d) => ({ type: d.type, description: d.description ?? '' }))
      .sort((a, b) => a.type.localeCompare(b.type));
    return { success: true, data: { nodes } };
  },
});

register({
  name: 'node_builder_write_files',
  description:
    'Generates all files for a new workflow node from a NodeSpec JSON object. Writes the definition, executor, panel, registry patches, and sr-docs markdown via the node-builder codegen.',
  parameters: {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        description:
          'Complete NodeSpec — must conform to the TypeScript shape in src/lib/node-builder/spec/types.ts. Required fields: type, displayName, description, category, inputs, outputs, uiSchema, testCases.',
      },
    },
    required: ['spec'],
  },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: async (args) => {
    const spec = args.spec;
    const srDocsDir = process.env.SR_DOCS_DIR ?? path.join(os.homedir(), 'sr-docs');
    try {
      const { writeNodeFiles } = await import('$lib/node-builder/codegen/write-files');
      const { written } = await writeNodeFiles(spec as never, srDocsDir);
      return { success: true, data: { written } };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

register({
  name: 'node_builder_validate',
  description:
    'Runs `npm run build` and `svelte-check --threshold error` to verify the working tree builds and typechecks. Reports failure only on real type errors — pre-existing warnings (e.g. deprecation notices) do not fail validation.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: async () => {
    // Build first — if it fails, no point typechecking.
    const build = await runProcess('npm', ['run', 'build'], { timeoutMs: 5 * 60_000 });
    if (!build.ok) {
      return {
        success: true,
        data: {
          ok: false,
          errors: `npm run build failed:\n${build.stderr || build.stdout}`,
        },
      };
    }
    // svelte-check directly with --threshold error so pre-existing warnings
    // (the repo currently has 578) don't cause the validate gate to misfire.
    // svelte-kit sync runs first so `$types` files are fresh.
    const sync = await runProcess('npx', ['svelte-kit', 'sync'], {
      env: { NODE_OPTIONS: '--max-old-space-size=8192' },
      timeoutMs: 60_000,
    });
    if (!sync.ok) {
      return {
        success: true,
        data: {
          ok: false,
          errors: `svelte-kit sync failed:\n${sync.stderr || sync.stdout}`,
        },
      };
    }
    const check = await runProcess(
      'npx',
      ['svelte-check', '--tsconfig', './tsconfig.json', '--threshold', 'error'],
      {
        env: { NODE_OPTIONS: '--max-old-space-size=8192' },
        timeoutMs: 5 * 60_000,
      },
    );
    if (!check.ok) {
      return {
        success: true,
        data: {
          ok: false,
          errors: `svelte-check found errors:\n${check.stderr || check.stdout}`,
        },
      };
    }
    return { success: true, data: { ok: true } };
  },
});

register({
  name: 'node_builder_diff',
  description:
    'Returns the current `git diff --stat` summary AND full `git diff` against HEAD. Use to present the user with what node_builder_write_files produced before asking for commit approval.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: async () => {
    // Intent-to-add untracked files so they show in diff.
    const status = await runProcess('git', ['status', '--porcelain'], {});
    if (!status.ok) return { success: false, error: `git status failed: ${status.stderr}` };

    const untracked = status.stdout
      .split('\n')
      .filter((line) => line.startsWith('?? '))
      .map((line) => line.slice(3));
    for (const f of untracked) {
      await runProcess('git', ['add', '-N', f], {});
    }

    const stat = await runProcess('git', ['diff', '--stat', 'HEAD'], {});
    const diff = await runProcess('git', ['diff', 'HEAD'], {});

    return {
      success: true,
      data: {
        stat: stat.stdout,
        diff: diff.stdout,
      },
    };
  },
});

register({
  name: 'node_builder_abort',
  description:
    'Reverts every codegen-managed path back to HEAD and removes any untracked files within the allowlist. Use when the user rejects a generated node or validation fails irrecoverably.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: async () => {
    const revertedPaths: string[] = [];
    for (const entry of NODE_BUILDER_PATH_ALLOWLIST) {
      // Revert tracked modifications under this entry.
      const co = await runProcess('git', ['checkout', '--', entry], {});
      if (co.ok) revertedPaths.push(entry);
      // Remove untracked files within the allowlist entry.
      await runProcess('git', ['clean', '-fd', entry], {});
    }
    return { success: true, data: { ok: true, revertedPaths } };
  },
});

const commitAndPushParameters = {
  type: 'object' as const,
  properties: {
    commitMessage: {
      type: 'string',
      description: 'One-line conventional commit message (e.g. "feat(nodes): add apple_calendar node").',
    },
  },
  required: ['commitMessage'],
};

const commitAndPush = async (args: Record<string, unknown>) => {
  const lifecycle = {
    environment: 'production',
    resourceType: 'git_commit',
    resourceId: undefined as string | undefined,
    accepted: false,
    applied: false,
    verified: false,
    live: false,
    auditId: undefined as string | undefined,
    status: 'not_accepted',
    verificationEvidence: [] as string[],
  };
  const commitMessage = args.commitMessage as string;
  if (typeof commitMessage !== 'string' || commitMessage.trim().length === 0) {
    return { success: false, error: 'commitMessage is required and must be a non-empty string', data: lifecycle };
  }

  const status = await runProcess('git', ['status', '--porcelain'], {});
  if (!status.ok) return { success: false, error: `git status failed: ${status.stderr}`, data: lifecycle };

  const changedPaths = status.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3));

  if (changedPaths.length === 0) {
    return { success: false, error: 'nothing to commit — working tree is clean', data: lifecycle };
  }

  const offenders = changedPaths.filter((p) => !isPathAllowed(p));
  if (offenders.length > 0) {
    return {
      success: false,
      error: `refusing to commit — these paths are outside the node-builder allowlist: ${offenders.join(', ')}`,
      data: lifecycle,
    };
  }

  const stage = await runProcess('git', ['add', ...changedPaths], {});
  if (!stage.ok) return { success: false, error: `git add failed: ${stage.stderr}`, data: lifecycle };

  const commit = await runProcess('git', ['commit', '-m', commitMessage], {});
  if (!commit.ok) {
    return { success: false, error: `git commit failed: ${commit.stderr || commit.stdout}`, data: lifecycle };
  }
  let log = commit.stdout;

  const revision = await runProcess('git', ['rev-parse', 'HEAD'], {});
  if (revision.ok) {
    lifecycle.resourceId = revision.stdout.trim();
    lifecycle.auditId = lifecycle.resourceId;
  }

  const push = await runProcess('git', ['push', 'origin', 'master'], { timeoutMs: 60_000 });
  log += `\n${push.stdout}\n${push.stderr}`;
  if (!push.ok) return { success: true, data: { ok: false, log, ...lifecycle } };

  lifecycle.accepted = true;
  lifecycle.applied = true;
  lifecycle.status = 'accepted_unverified';
  return { success: true, data: { ok: true, log, ...lifecycle } };
};

register({
  name: 'node_builder_commit_and_push',
  destructive: true,
  description:
    'GATED: commits codegen-managed paths with the supplied message and pushes to origin/master for GitHub Actions to handle. Does not deploy directly or verify CI or production. REFUSES if any staged file is outside the codegen path allowlist. Only call after explicit user approval in the current turn.',
  parameters: commitAndPushParameters,
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: commitAndPush,
});

register({
  name: 'node_builder_commit_and_deploy',
  destructive: true,
  deprecated: true,
  replacement: 'node_builder_commit_and_push',
  description:
    'DEPRECATED compatibility alias for node_builder_commit_and_push. Commits codegen-managed paths and pushes to origin/master for GitHub Actions; it does not deploy directly or verify CI or production.',
  parameters: commitAndPushParameters,
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: commitAndPush,
});
