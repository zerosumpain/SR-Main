import { existsSync } from 'node:fs';
import path from 'node:path';
import { register } from '../registry';
import { runProcess } from './node-builder-shared';

const NOT_IMPLEMENTED = async () => ({
  success: false,
  error: 'not implemented yet — Phase 2 task pending',
});

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
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_validate',
  description:
    'Runs `npm run build` and `npm run check` to verify the working tree builds and typechecks. Use after node_builder_write_files to confirm the generated node compiles cleanly.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_diff',
  description:
    'Returns the current `git diff --stat` summary AND full `git diff` against HEAD. Use to present the user with what node_builder_write_files produced before asking for commit approval.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_abort',
  description:
    'Reverts every codegen-managed path back to HEAD and removes any untracked files within the allowlist. Use when the user rejects a generated node or validation fails irrecoverably.',
  parameters: { type: 'object', properties: {} },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});

register({
  name: 'node_builder_commit_and_deploy',
  description:
    'GATED: commits codegen-managed paths with the supplied message, pushes to origin/master, runs scripts/deploy.sh, and verifies the deployed site responds. REFUSES if any staged file is outside the codegen path allowlist. Only call after explicit user approval in the current turn.',
  parameters: {
    type: 'object',
    properties: {
      commitMessage: {
        type: 'string',
        description: 'One-line conventional commit message (e.g. "feat(nodes): add apple_calendar node").',
      },
    },
    required: ['commitMessage'],
  },
  category: 'Node Builder',
  toolset: 'node-builder',
  handler: NOT_IMPLEMENTED,
});
