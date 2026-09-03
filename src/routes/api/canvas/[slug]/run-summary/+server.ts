import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveLLMClient } from '$lib/workflows/nodes/llm-helpers';
import { withActivity } from '$lib/context/activity';

type NodeIn = {
  id: string;
  name: string;
  type: string;
  status: string;
  error: string | null;
  outputPreview: string | null;
};

type Body = {
  state: 'completed' | 'completed_with_errors' | 'failed';
  durationMs: number;
  nodes: NodeIn[];
  runError?: string | null;
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || !Array.isArray(body.nodes)) {
    return json({ error: 'Invalid body' }, { status: 400 });
  }

  const ranNodes = body.nodes.filter(
    (n) => n.status === 'completed' || n.status === 'ok' || n.status === 'failed' || n.status === 'running',
  );
  if (ranNodes.length === 0) {
    return json({ overall: 'No nodes ran in this workflow.', perNode: {} });
  }

  const sysPrompt =
    'You explain workflow run results to a non-technical user. ' +
    'Reply with strict JSON only — no prose, no code fences. Shape: ' +
    '{"overall": string, "perNode": {<nodeId>: string}}. ' +
    'Each summary is one short sentence in plain English describing what the node did, ' +
    'or — if it failed — what went wrong, in language a non-technical user can understand. ' +
    'Do not mention JSON, payloads, or technical jargon. Do not quote raw error messages verbatim.';

  const userPrompt = JSON.stringify({
    runState: body.state,
    runDurationMs: body.durationMs,
    runError: body.runError ?? null,
    nodes: ranNodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      status: n.status,
      error: n.error,
      output: n.outputPreview,
    })),
  });

  try {
    const { client, model } = await resolveLLMClient(undefined);
    // `resolveLLMClient(undefined)` above means this runs on the `workflow-node`
    // role. The summary is written AFTER the run, so there is no execution
    // context to give it `source: workflow` — it needs the tag explicitly.
    const resp = await withActivity('workflow-node', () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    );
    const raw = resp.choices[0]?.message?.content ?? '';
    let parsed: { overall?: string; perNode?: Record<string, string> } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          /* ignore */
        }
      }
    }
    return json({
      overall: typeof parsed.overall === 'string' ? parsed.overall : '',
      perNode:
        parsed.perNode && typeof parsed.perNode === 'object'
          ? (parsed.perNode as Record<string, string>)
          : {},
    });
  } catch (err) {
    console.error('[run-summary] llm call failed', err);
    return json({ error: 'summary_failed' }, { status: 502 });
  }
};
