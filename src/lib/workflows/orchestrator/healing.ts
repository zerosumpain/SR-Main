import { getLLMClient } from '$lib/llm/client';
import { resolveDoctorModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import type { HealingContext, HealingDiagnosis, NodeDefinition } from '../types';

export function buildHealingPrompt(context: HealingContext): string {
  const prevAttemptsBlock = context.previousAttempts.length > 0
    ? `\n## Previous Fix Attempts (DO NOT repeat these)\n\n${context.previousAttempts.map((a, i) =>
        `### Attempt ${i + 1}\n- Diagnosis: ${a.diagnosis}\n- Fix applied: ${a.fixApplied}\n- Result: ${a.resultError}`
      ).join('\n\n')}\n`
    : '';

  const upstreamBlock = Object.entries(context.workflowContext.upstreamOutputs)
    .map(([id, out]) => `  ${id}: ${JSON.stringify(out).slice(0, 500)}`)
    .join('\n');

  return `## Failed Node

**Type:** ${context.nodeType}
**Label:** ${context.nodeLabel}
**Error:** ${context.error}

**Node Config:**
\`\`\`json
${JSON.stringify(context.nodeConfig, null, 2)}
\`\`\`

**Input Data Received:**
\`\`\`json
${JSON.stringify(context.inputData, null, 2).slice(0, 2000)}
\`\`\`

**Node Definition:**
${context.nodeDefinition.description}
${(context.nodeDefinition as any).llmDescription || ''}

**Inputs:** ${context.nodeDefinition.inputs.map(p => `${p.name}: ${p.type}`).join(', ') || 'none'}
**Outputs:** ${context.nodeDefinition.outputs.map(p => `${p.name}: ${p.type}`).join(', ') || 'none'}

## Workflow Context

**Nodes:** ${context.workflowContext.nodes.map(n => `${n.label} (${n.type})`).join(' → ')}
**Edges:** ${context.workflowContext.edges.map(e => `${e.sourceNodeId} → ${e.targetNodeId}`).join(', ')}

**Upstream Outputs:**
${upstreamBlock}
${prevAttemptsBlock}`;
}

const HEALING_SYSTEM_PROMPT = `You are a workflow debugging expert. A node in a workflow has failed during execution. Your job is to diagnose the root cause and propose a fix.

## Diagnosis Categories

1. **config_fix** — The node's configuration is wrong (bad expression, wrong URL, template error, missing field). You can fix this by providing a corrected config.
2. **rewire_fix** — The workflow graph is wrong (missing transform node, wrong edge connections). You can fix this by describing nodes to insert or edges to change.
3. **environment_issue** — The server environment is misconfigured (missing SMTP server, missing API key, external service down). You CANNOT auto-fix this. Provide clear instructions for what needs to be configured and where, plus an alternative workaround if one exists.
4. **unknown** — You cannot determine the root cause. Provide your best analysis.

## Important

- For config_fix: provide the COMPLETE new config object for the node (all fields, not just changed ones)
- For environment_issue: be specific about what env vars or services are needed and where to configure them
- If previous attempts are listed, DO NOT repeat the same fix — try a different approach
- Check if the input data shape matches what the node expects — data shape mismatches are common

## Output Format

Respond with a JSON object:
{
  "category": "config_fix | rewire_fix | environment_issue | unknown",
  "diagnosis": "Human-readable explanation of what went wrong",
  "reasoning": "Step-by-step thinking about the root cause",
  "fix": {
    "type": "update_config | insert_node | rewire_edge | none",
    "changes": { ... },
    "description": "What this fix does"
  } | null,
  "environmentAction": "Instructions for user (environment_issue only)",
  "alternative": "Optional workaround suggestion",
  "confidence": "high | medium | low"
}`;

export function parseHealingResponse(raw: string): HealingDiagnosis {
  try {
    const parsed = JSON.parse(raw);
    return {
      category: parsed.category || 'unknown',
      diagnosis: parsed.diagnosis || 'Could not determine the issue.',
      reasoning: parsed.reasoning || '',
      fix: parsed.fix || null,
      environmentAction: parsed.environmentAction,
      alternative: parsed.alternative,
      confidence: parsed.confidence || 'low',
    };
  } catch {
    return {
      category: 'unknown',
      diagnosis: 'Failed to parse diagnosis response.',
      reasoning: raw.slice(0, 500),
      fix: null,
      confidence: 'low',
    };
  }
}

export async function diagnoseAndFix(
  context: HealingContext,
  onProgress?: (text: string) => void,
): Promise<HealingDiagnosis> {
  // The DOCTOR role, not the site default. This diagnoses a failing canvas
  // node, which is the workflow doctor's job done at runtime instead of at
  // 05:00 — so the two ran the same task on different models purely because
  // one had a settings key and the other did not.
  const { client, model } = await getLLMClient(await resolveDoctorModel());

  const userPrompt = buildHealingPrompt(context);
  onProgress?.(`Diagnosing: ${context.error.slice(0, 100)}`);

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await withActivity('doctor', () =>
        client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: HEALING_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        }),
      );
      break;
    } catch (err: any) {
      if (err?.status === 429 && attempt < 2) {
        const wait = (attempt + 1) * 5000;
        onProgress?.(`Rate limited — waiting ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  const text = response?.choices[0]?.message?.content ?? '{}';
  const diagnosis = parseHealingResponse(text);

  onProgress?.(`Diagnosis: ${diagnosis.diagnosis}`);
  if (diagnosis.fix) {
    onProgress?.(`Proposed fix: ${diagnosis.fix.description}`);
  }

  return diagnosis;
}
