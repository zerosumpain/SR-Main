#!/usr/bin/env node
/**
 * Workflow eval — `npm run eval:workflows`.
 *
 * ⚠️ LIVE LLM CALLS against the models the site is configured with. Never run
 * in CI (nothing wires it there; the gate never calls it). Needs `.env` for the
 * DB and the provider keys — the npm script passes `--env-file=.env`.
 *
 * Three suites, one score:
 *
 *   generator  the fixed prompts in src/lib/workflows/eval/cases.ts through the
 *              REAL `generateWorkflow` (what workflow_generate and Describe-it
 *              run), scored by eval/assertions.ts.
 *   chat       the CHAT path: an empty canvas and one real jkai chat turn
 *              (`generalChat`, the /jkai loop) limited to the granular workflow
 *              tools — add_node / add_edge / amend / lint. Passes when the graph
 *              it leaves behind scores clean AND it ran workflow_lint.
 *   amend      an EXISTING graph and an instruction through `proposeAmendOps`
 *              (the canvas prompt bar and the iPhone's /ask), applied through
 *              `applyNativeAmend` exactly as Apply does, then scored.
 *
 * Model: never chosen here. The generator and the ask path resolve the site
 * default (`jkai.chat.default_model`); the chat turn resolves the `chat`
 * workload. Both are recorded in the output.
 *
 * Canvases the chat and amend suites create are scratch (`eval-…` slugs) and
 * are deleted at the end — by slug, only the ones this run made.
 *
 * Flags:
 *   --suite generator,chat,amend   (default: all three)
 *   --case <text>                  only cases whose name contains <text>
 *   --out <path>                   default docs/evals/workflow-eval.json
 *   --dry                          list the cases, call nothing
 *
 * Runs module code through Vite's SSR loader, as evaluate-intelligence.mjs
 * does, so `$lib`/`$env` resolve exactly as they do in the app. (A bare
 * `tsx src/lib/workflows/eval/run-eval.ts` could not: `$lib` is a Vite alias.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

// Own nothing: importing the workflow registry must not start the scheduler,
// WhatsApp or Home Assistant against the shared dev database.
process.env.JKAI_SERVICE_ROLE = 'builder';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? '') : null;
};
const suites = new Set((flag('suite') ?? 'generator,chat,amend').split(',').map((s) => s.trim()).filter(Boolean));
const caseFilter = flag('case');
const outPath = path.resolve(flag('out') ?? 'docs/evals/workflow-eval.json');
const dry = argv.includes('--dry');

// ———————————————————————————————————————— cases

/** Chat path on an EMPTY canvas: the model must add, wire and lint. */
const CHAT_CASES = [
  {
    name: 'chat: fetch → WhatsApp on an empty canvas',
    prompt:
      'When I press run, fetch JSON from https://api.example.com/status and send a WhatsApp message to +447700900000 with the result.',
    expect: { nodeTypes: ['http-request', 'whatsapp'], edges: [{ from: 'http-request', to: 'whatsapp' }] },
  },
  {
    name: 'chat: fetch → LLM pick → store on an empty canvas',
    prompt:
      'When I press run, fetch https://news.example.com/feed.json, have an LLM pick the three most important stories, and store them under the key "topStories".',
    expect: {
      nodeTypes: ['http-request', 'data-store'],
      nodeTypesAnyOf: [['llm-call', 'llm-agent', 'openrouter']],
    },
  },
  {
    name: 'chat: fetch → branch → WhatsApp on an empty canvas',
    prompt:
      'When I press run, fetch the weather JSON from https://api.weather.example.com/london. If the temperature is below 5, send a WhatsApp warning to +447700900000; otherwise do nothing.',
    expect: {
      nodeTypes: ['http-request', 'whatsapp'],
      nodeTypesAnyOf: [['conditional', 'llm-router']],
    },
  },
];

const PHONE = '+447700900000'; // Ofcom drama range — never a real recipient.

/** Amend an EXISTING graph: seed, instruction, and what must hold afterwards. */
const AMEND_CASES = [
  {
    name: 'amend: put a 5-minute wait before the WhatsApp send',
    seed: [
      { ref: 'fetch', type: 'http-request', label: 'Fetch status', config: { method: 'GET', url: 'https://api.example.com/status' } },
      { ref: 'send', type: 'whatsapp', label: 'Send status', config: { to: PHONE, message: 'Status: {{input}}' } },
    ],
    instruction: 'Wait 5 minutes before sending the WhatsApp message.',
    expect: { nodeTypes: ['http-request', 'delay', 'whatsapp'], edges: [{ from: 'http-request', to: 'delay' }, { from: 'delay', to: 'whatsapp' }] },
    keep: ['fetch', 'send'],
  },
  {
    name: 'amend: send the summary by WhatsApp instead of email',
    seed: [
      { ref: 'fetch', type: 'http-request', label: 'Fetch news', config: { method: 'GET', url: 'https://news.example.com/feed.json' } },
      { ref: 'sum', type: 'llm-call', label: 'Summarise', config: { userPrompt: 'Summarise these stories in three bullets: {{input}}' } },
      { ref: 'mail', type: 'email', label: 'Email summary', config: { to: 'john@example.com', subject: 'News', body: '{{input}}' } },
    ],
    instruction: `Send the summary to me by WhatsApp (${PHONE}) instead of by email.`,
    expect: { nodeTypes: ['http-request', 'llm-call', 'whatsapp'], edges: [{ from: 'llm-call', to: 'whatsapp' }] },
    absent: ['email'],
    keep: ['fetch', 'sum'],
  },
];

// ———————————————————————————————————————— run

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'warn' });
const load = (p) => server.ssrLoadModule(p);
const created = []; // slugs this run made — the only canvases cleanup touches
const results = [];
const models = {};

function pick(list) {
  return caseFilter ? list.filter((c) => c.name.includes(caseFilter)) : list;
}

/** A canvas graph (DB rows) → the shape the scorer reads. The unwired chat panel is not a step. */
function toEvalGraph({ nodes, edges }, trigger) {
  const keep = nodes.filter((n) => n.type !== 'chat');
  const ids = new Set(keep.map((n) => n.id));
  return {
    nodes: keep.map((n) => ({ id: n.id, type: n.type, label: n.label, config: n.config, position: n.position ?? { x: 0, y: 0 } })),
    edges: edges
      .filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId))
      .map((e) => ({ id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle ?? undefined })),
    trigger,
  };
}

function failed(message) {
  return { passed: false, failures: [{ kind: 'verify-error', message }], warnings: [], verifyIssues: [] };
}

async function scratchCanvas(label) {
  const { allocateCanvasName, createCanvas } = await load('/src/lib/canvas/adapter.server.ts');
  const { slug } = await allocateCanvasName(`eval-${label}-${Date.now().toString(36)}`);
  const { workflowId } = await createCanvas(slug, `[eval] ${label}`);
  created.push(slug);
  return { slug, workflowId };
}

try {
  const assertions = await load('/src/lib/workflows/eval/assertions.ts');
  const { evalCases } = await load('/src/lib/workflows/eval/cases.ts');
  const plan = {
    generator: suites.has('generator') ? pick(evalCases) : [],
    chat: suites.has('chat') ? pick(CHAT_CASES) : [],
    amend: suites.has('amend') ? pick(AMEND_CASES) : [],
  };
  if (dry) {
    for (const [suite, list] of Object.entries(plan)) for (const c of list) console.log(`${suite.padEnd(9)} ${c.name}`);
    process.exit(0);
  }

  const { resolveDefaultModel } = await load('/src/lib/server/models/settings.ts');
  models.generatorAndAsk = (await resolveDefaultModel()).modelId;

  // ——— generator
  if (plan.generator.length) {
    const { generateWorkflow } = await load('/src/lib/workflows/orchestrator/index.ts');
    for (const c of plan.generator) {
      const started = Date.now();
      process.stdout.write(`\n→ [generator] ${c.name}\n`);
      let result;
      try {
        const out = await generateWorkflow(c.prompt, null, () => {}, { skipVerification: false });
        if (!out.workflow) {
          result = failed(out.followUp ? `Asked instead of building: ${out.followUp}` : 'No workflow returned.');
        } else {
          const graph = {
            name: out.workflow.name,
            nodes: out.workflow.nodes,
            edges: out.workflow.edges,
            trigger: out.workflow.trigger,
            warnings: out.workflow.warnings,
            selfHealed: (out.thinking?.debate.revisions.length ?? 0) > 0,
          };
          result = assertions.scoreGraph(graph, c.expect);
          if (c.idempotency) result = assertions.applyIdempotency(result, graph, c.idempotency);
        }
      } catch (err) {
        result = failed(`Generation threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      results.push({ suite: 'generator', name: c.name, durationMs: Date.now() - started, result });
    }
  }

  // ——— chat
  if (plan.chat.length) {
    const { generalChat } = await load('/src/lib/workflows/chat/general-chat.ts');
    const { resolveChatTurnModel } = await load('/src/lib/server/models/workload-settings.ts');
    const { loadGraph } = await load('/src/lib/workflows/native/workflows.server.ts');
    const modelContext = await resolveChatTurnModel();
    models.chat = modelContext.modelId;
    const TOOLS = [
      'workflow_inspect', 'workflow_list_node_types', 'workflow_describe_node', 'workflow_add_node',
      'workflow_update_node', 'workflow_add_edge', 'workflow_remove_edge', 'workflow_amend', 'workflow_lint',
    ];
    for (const c of plan.chat) {
      const started = Date.now();
      process.stdout.write(`\n→ [chat] ${c.name}\n`);
      const toolsCalled = [];
      let result;
      try {
        const { slug, workflowId } = await scratchCanvas('chat');
        await generalChat(
          {
            text:
              `Build this on the canvas /jkai/canvas/${slug} (workflowId ${workflowId}). It already has a manual trigger — ` +
              `wire your first step from it. ${c.prompt} Add and wire the steps with the workflow tools, then run ` +
              `workflow_lint and fix anything it reports before you finish.`,
          },
          [],
          {
            workflowId,
            conversationId: null,
            jobId: null,
            modelContext,
            priceSnapshot: null,
            useIntelContext: false,
            toolWhitelist: TOOLS,
            maxRounds: 18,
            onToolProgress: (s) => {
              if (s.status !== 'running') toolsCalled.push(s.tool);
            },
          },
        );
        const graph = toEvalGraph(await loadGraph(workflowId), { type: 'manual' });
        result = assertions.scoreGraph(graph, c.expect);
        if (!toolsCalled.includes('workflow_lint')) {
          result = { ...result, passed: false, failures: [...result.failures, { kind: 'verify-error', message: 'Never ran workflow_lint.' }] };
        }
      } catch (err) {
        result = failed(`Chat turn threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      results.push({ suite: 'chat', name: c.name, durationMs: Date.now() - started, toolsCalled, result });
    }
  }

  // ——— amend
  if (plan.amend.length) {
    const { proposeAmendOps } = await load('/src/lib/workflows/build-from-prompt.server.ts');
    const { applyNativeAmend } = await load('/src/lib/workflows/native/amend.server.ts');
    const { applyAmendOps } = await load('/src/lib/canvas/amend.server.ts');
    const { loadGraph } = await load('/src/lib/workflows/native/workflows.server.ts');
    for (const c of plan.amend) {
      const started = Date.now();
      process.stdout.write(`\n→ [amend] ${c.name}\n`);
      let result;
      let proposal = null;
      try {
        const { workflowId } = await scratchCanvas('amend');
        const triggerId = (await loadGraph(workflowId)).nodes.find((n) => n.type === 'trigger')?.id;
        const chain = [triggerId, ...c.seed.map((s) => `#${s.ref}`)];
        const seeded = await applyAmendOps({
          workflowId,
          actor: 'eval',
          reason: 'workflow eval seed',
          ops: [
            ...c.seed.map((s) => ({ op: 'add_node', ref: s.ref, type: s.type, label: s.label, config: s.config })),
            ...chain.slice(1).map((to, i) => ({ op: 'add_edge', sourceNodeId: chain[i], targetNodeId: to })),
          ],
        });
        const seedIds = Object.fromEntries(
          c.seed.map((s, i) => [s.ref, seeded.outcomes[i]?.nodeId]),
        );
        proposal = await proposeAmendOps(workflowId, c.instruction);
        if (proposal.ops.length === 0) {
          result = failed(`No ops proposed: ${proposal.summary} ${proposal.warnings.join(' ')}`.trim());
        } else {
          const applied = await applyNativeAmend({ workflowId, ops: proposal.ops, actor: 'owner' });
          if (!applied.ok) {
            result = failed(`Proposal did not apply (${applied.status}): ${applied.error}`);
          } else {
            const g = await loadGraph(workflowId);
            result = assertions.scoreGraph(toEvalGraph(g, { type: 'manual' }), c.expect);
            const have = new Set(g.nodes.map((n) => n.id));
            const types = new Set(g.nodes.map((n) => n.type));
            for (const ref of c.keep ?? []) {
              if (!have.has(seedIds[ref])) {
                result.failures.push({ kind: 'verify-error', message: `Removed and re-added "${ref}" instead of keeping it (run history lost).` });
              }
            }
            for (const t of c.absent ?? []) {
              if (types.has(t)) result.failures.push({ kind: 'missing-node-type', message: `A "${t}" step is still there.` });
            }
            result.passed = result.failures.length === 0;
          }
        }
      } catch (err) {
        result = failed(`Amend threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      results.push({
        suite: 'amend',
        name: c.name,
        durationMs: Date.now() - started,
        proposal: proposal ? { summary: proposal.summary, ops: proposal.ops.map((o) => o.op) } : null,
        result,
      });
    }
  }
} finally {
  if (created.length) {
    const { deleteCanvas } = await load('/src/lib/canvas/adapter.server.ts');
    for (const slug of created) await deleteCanvas(slug).catch(() => {});
  }
}

// ———————————————————————————————————————— report

const passed = results.filter((r) => r.result.passed).length;
const bySuite = {};
for (const r of results) {
  const s = (bySuite[r.suite] ??= { passed: 0, total: 0 });
  s.total++;
  if (r.result.passed) s.passed++;
}
const report = {
  date: new Date().toISOString(),
  models,
  suites: bySuite,
  passed,
  total: results.length,
  score: results.length ? Number((passed / results.length).toFixed(3)) : null,
  cases: results.map((r) => ({
    suite: r.suite,
    name: r.name,
    passed: r.result.passed,
    durationMs: r.durationMs,
    failures: r.result.failures.map((f) => f.message),
    warnings: r.result.warnings,
    ...(r.toolsCalled ? { toolsCalled: r.toolsCalled } : {}),
    ...(r.proposal ? { proposal: r.proposal } : {}),
  })),
};
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
for (const c of report.cases) {
  console.log(`${c.passed ? 'PASS' : 'FAIL'}  [${c.suite}] ${c.name}${c.passed ? '' : `\n      ${c.failures.join('\n      ')}`}`);
}
console.log(`\n${passed}/${results.length} passed (score ${report.score}) — written to ${path.relative(process.cwd(), outPath)}`);
await server.close();
process.exit(0);
