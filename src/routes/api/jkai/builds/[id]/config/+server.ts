/**
 * Everything about a build that is NOT a column on its row: the prompt it is
 * running, the guardrail rules that police it, the gate checks that grade it,
 * the toolsets it can reach, and whether the sidecar behind it is actually up.
 *
 * This endpoint only ever READS from the builder modules. The prompts, the lint
 * rules and the gate live in code and are shared by every build; making them
 * per-build editable would mean changing the orchestrator, which is under
 * active development in this exact area. The Blueprint panel renders this so a
 * human can see what is running without opening a second session to read the
 * source.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { connect } from 'node:net';
import {
  buildSystemPrompt,
  designSystemPromptBlock,
  type BuildPromptMode,
} from '$lib/jkai/prompt';
import { getToolsetManifest } from '$lib/workflows/site-tools/registry';
import { BUILDER_SOCKET_PATH } from '$lib/jkai/builder-client';

/**
 * The three design-lint rules, described in the terms the finding uses.
 * Mirrors src/lib/jkai/design-lint.ts — kept as prose here rather than parsed
 * out of the regexes, because a regex is not an explanation.
 */
const LINT_RULES = [
  {
    rule: 'no-raw-hex',
    summary: 'Raw hex colours outside tokens.css',
    detail:
      'A hex literal is only legal where a token is declared — inside a `--custom-property:` line, or anywhere in tokens.css. Everywhere else must reference var(--…).',
  },
  {
    rule: 'no-tailwind',
    summary: 'Tailwind utility classes',
    detail:
      'class attributes containing bg-, text-, p-N, m-N, w-N, h-N, flex or grid. The site has a design system; utility classes route around it.',
  },
  {
    rule: 'no-raw-font',
    summary: 'font-family that is not a token',
    detail: 'font-family must resolve to var(--font-*), or one of inherit/initial/unset/revert.',
  },
];

/**
 * The read-only mounts the linter must never report on. A finding inside one
 * cannot be fixed by the agent — the directory is regenerated every iteration —
 * and three unfixable findings in a row aborts the build as `design_lint_loop`.
 */
const LINT_EXEMPT_MOUNTS = ['design-system/', 'explainer-kit/'];

/**
 * The studio gate's checks, in the order a chapter meets them.
 * Rule ids match the `rule:` values emitted by scripts/studio-gate.mjs.
 */
const GATE_CHECKS = [
  { rule: 'kit-missing', scope: 'project', summary: 'The explainer kit actually mounted in the served root.' },
  { rule: 'no-design-tokens', scope: 'project', summary: 'The served pages reference the design tokens.' },
  { rule: 'no-scene', scope: 'project', summary: 'The project ships its scene asset.' },
  { rule: 'unreachable', scope: 'chapter', summary: 'The chapter route loads at all.' },
  { rule: 'still-placeholder', scope: 'chapter', summary: 'A chapter that is due no longer carries data-chapter-status="placeholder".' },
  { rule: 'unmarked', scope: 'chapter', summary: 'The root element declares data-chapter="<n>".' },
  { rule: 'chapters-not-distinct', scope: 'chapter', summary: 'Two chapters are not serving the same page.' },
  { rule: 'prose-only', scope: 'chapter', summary: 'The chapter has a visual, not just text.' },
  { rule: 'no-model', scope: 'chapter', summary: 'The chapter has an interactive model, not just a picture.' },
  { rule: 'inert-lever', scope: 'chapter', summary: 'Driving the declared lever id actually moves the declared outcome id.' },
  { rule: 'uncited', scope: 'chapter', summary: 'Claims resolve against the research brief’s fact URLs.' },
  { rule: 'absolute-internal-link', scope: 'chapter', summary: 'Internal links are relative, so they survive being served under /projects/<slug>/.' },
  { rule: 'broken-link', scope: 'chapter', summary: 'Internal links resolve.' },
  { rule: 'errored', scope: 'chapter', summary: 'The chapter threw no console errors while being driven.' },
];

/**
 * Is the jkai-builder sidecar reachable right now?
 *
 * A connect() to its Unix socket, not a stored status column — a build row says
 * nothing about whether the process behind it is alive, and that is exactly the
 * confusion this panel exists to remove. Cheap enough to run on every load: no
 * RPC is sent, the socket is opened and immediately destroyed.
 */
function probeBuilderSocket(timeoutMs = 1500): Promise<{ up: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (up: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* already gone */
      }
      resolve({ up, detail });
    };
    const sock = connect({ path: BUILDER_SOCKET_PATH });
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => done(true, `connected on ${BUILDER_SOCKET_PATH}`));
    sock.on('timeout', () => done(false, `no response within ${timeoutMs}ms`));
    sock.on('error', (err: NodeJS.ErrnoException) =>
      done(false, err.code === 'ENOENT' ? 'socket file does not exist — the service is not running' : err.message),
    );
  });
}

export const GET: RequestHandler = async ({ params }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });

  // Which prompt this build is actually running. Mirrors the orchestrator's own
  // selection: a git target makes it a repo build, origin 'studio' makes it a
  // studio build, everything else is a plain app build.
  const mode: BuildPromptMode = build.gitTargetConfig
    ? 'repo'
    : build.origin === 'studio'
      ? 'studio'
      : 'app';

  const serve = build.serveConfig as { port?: number } | null;
  const port = typeof serve?.port === 'number' ? serve.port : 0;

  // The prompt the agent actually receives, not just the base template.
  // executor.ts appends the design-system block under exactly this condition;
  // reporting the base alone under-reported what the agent was told on every
  // design-enforced non-studio build, which defeats the point of showing it.
  const enforceDesign = build.enforceDesignSystem !== false;
  const systemPrompt =
    buildSystemPrompt(build.id, port, mode) +
    (enforceDesign && mode !== 'studio' ? designSystemPromptBlock(mode) : '');

  const builder = await probeBuilderSocket();
  const repoConfig = build.gitTargetConfig as {
    gateCommand?: string;
    finalGateCommand?: string;
  } | null;

  const manifest = getToolsetManifest().map((t) => ({
    toolset: t.toolset,
    description: t.description,
    toolCount: t.tools.length,
  }));

  return json({
    mode,
    port,
    systemPrompt,
    toolsets: manifest,
    lint: {
      enabled: enforceDesign,
      // The orchestrator skips the linter entirely when the workspace holds no
      // .svelte file, with a log line rather than a status. Reported so the
      // panel does not assert an active guardrail that never executes — the
      // same trap the studio gate's `describeGateSkip` exists to close.
      svelteOnly: true,
      rules: LINT_RULES,
      exemptMounts: LINT_EXEMPT_MOUNTS,
    },
    gate: {
      // The gate only runs for studio builds, and only when it has a spine to
      // check against. describeGateSkip exists because an empty spine used to
      // disable the whole guardrail silently.
      applies: mode === 'studio',
      chapterCount: (build.chapterPlan ?? []).length,
      hasPort: port > 0,
      checks: GATE_CHECKS,
    },
    verification: {
      applies: mode === 'repo',
      steps: [
        {
          phase: 'feedback_gate',
          label: 'Structural checks, typecheck and tests',
          command: repoConfig?.gateCommand ?? null,
          owner: 'builder',
        },
        {
          phase: 'release_candidate',
          label: 'Production web and sidecar bundles',
          command: repoConfig?.finalGateCommand ?? null,
          owner: 'builder',
        },
        { phase: 'publish', label: 'Publish candidate', command: null, owner: 'builder' },
        { phase: 'ci', label: 'GitHub CI and review', command: null, owner: 'github' },
        { phase: 'deploy', label: 'Production deployment', command: null, owner: 'production' },
      ],
    },
    sidecar: {
      name: 'jkai-builder',
      socket: BUILDER_SOCKET_PATH,
      up: builder.up,
      detail: builder.detail,
    },
  });
};
