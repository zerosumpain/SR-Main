// src/lib/workflows/site-tools/tools/request-change.ts
//
// "Build me X" for the site's own codebase, routed through GitHub instead of
// through a shell. Opens an issue (the durable record of the ask), starts a
// git-target build that branches, implements, runs the gate, and opens a PR
// closing that issue.
//
// This exists to remove the reason agents improvise deploys. Before it, a
// request that needed real code had no working path — publish_page only writes
// a static page — so the model reached for ssh/rsync and took production down
// for 33 hours (2026-07-24). Now the honest path is one tool call, and the
// output is a reviewable diff rather than a mutated server.
//
// Deliberately `destructive: true`: it opens a public issue on the repo and
// spends model budget, so it inherits the confirmation gate like publish_page.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { createChangeRequest } from '$lib/jkai/change-request';
import { githubConfigured, REPO_SLUG } from '$lib/github/issues';

register({
  name: 'request_change',
  destructive: true,
  description:
    "Request a code change to the Strange Ramblings site itself (new page, route, component, API endpoint, workflow node, bug fix). Opens a GitHub issue recording the request, then starts an autonomous build that branches, implements it, runs `npm run gate`, and opens a pull request closing the issue. Use this whenever the ask needs REAL CODE in the site's repo. Do NOT use it for a one-off report, analysis or static page — that is `publish_page`, which is instant and needs no build. The build never merges its own work: additive changes can auto-merge after the gate passes, and anything touching auth, the database schema, deploy scripts or CI is flagged for human review.",
  toolset: 'builds',
  category: 'builds',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Short issue title describing the outcome, e.g. "Add a /projects/tide-times page". Max 250 chars.',
      },
      request: {
        type: 'string',
        description:
          "The full request in the user's own words, plus any constraints, acceptance criteria or context the implementer needs. Stored verbatim on the issue, so be specific — this is the record of intent, not a summary.",
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: "Optional GitHub labels. Defaults to ['change-request'].",
      },
    },
    required: ['title', 'request'],
  },
  // Attaches a build watcher automatically, same as build_create. Without it
  // change-request builds were the one family nothing ever reported on.
  producesLongRunningTask: { kind: 'build', idPath: 'buildId', cadenceSeconds: 300 },
  handler: async (args, toolCtx): Promise<ToolResult> => {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const request = typeof args.request === 'string' ? args.request.trim() : '';

    if (!title || !request) {
      return { success: false, error: 'Both `title` and `request` are required.' };
    }

    // Fail politely rather than throwing from deep inside the build creator —
    // the model should be able to tell the user what is missing.
    if (!githubConfigured()) {
      return {
        success: false,
        error:
          'GitHub is not configured on this host. Set GITHUB_API_TOKEN to a fine-grained PAT ' +
          `scoped to ${REPO_SLUG} with issues:write + pull_requests:write, then retry.`,
      };
    }

    try {
      const { buildId, issueNumber, issueUrl } = await createChangeRequest({
        title,
        request,
        labels: Array.isArray(args.labels)
          ? (args.labels as unknown[]).filter((l): l is string => typeof l === 'string')
          : undefined,
        // Link the build back to the chat that asked for it, so the
        // build-progress watcher can see it at all.
        conversationId: toolCtx?.conversationId,
      });

      return {
        success: true,
        data: {
          issueNumber,
          issueUrl,
          buildId,
          buildUrl: `https://strangeramblings.com/jkai/builds/${buildId}`,
          note: 'The build will open a pull request closing this issue. It will not merge protected-path changes.',
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
