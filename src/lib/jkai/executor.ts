import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { buildSystemPrompt, buildIterationContext } from './prompt';
import { execInSandboxChecked, listWorkspaceFiles } from './sandbox';
import { emitLog } from './log-emitter';
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
import type { ActionRecord } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';

// --- Code Block Extraction ---

const FENCE_REGEX = /```(bash|python|sh|javascript|typescript|node)\n([\s\S]*?)```/;

function extractCodeBlock(text: string): { lang: string; code: string } | null {
  const match = text.match(FENCE_REGEX);
  if (!match) return null;
  return { lang: match[1], code: match[2].trimEnd() };
}

function hasEvaluation(text: string): boolean {
  return text.includes('## Evaluation');
}

export function extractSection(text: string, header: string): string | null {
  const regex = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

// --- Iteration Result ---

export interface IterationResult {
  goals: string | null;
  plan: string | null;
  actions: ActionRecord[];
  messages: Array<{ role: string; content: string }>;
  evaluation: string | null;
  nextSteps: string | null;
  tokensUsed: number;
}

// --- Executor ---

export async function executeIteration(
  build: JkaiBuild,
  iteration: JkaiIteration,
  prevIteration: JkaiIteration | null,
  projectPlan: string | null,
  iterationNumber: number,
  isStopped: () => boolean,
): Promise<IterationResult> {
  const { client, model } = await getLLMClient({
    provider: (build.modelProvider ?? 'zai') as 'zai' | 'openrouter',
    modelId: build.modelId ?? 'glm-5.1',
  });
  const systemPrompt = buildSystemPrompt(build.id);
  const fileList = await listWorkspaceFiles(build.id);
  const contextMessages = buildIterationContext(build.prompt, prevIteration, fileList, projectPlan, iterationNumber);

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...contextMessages,
  ];

  const actions: ActionRecord[] = [];
  let goals: string | null = null;
  let plan: string | null = null;
  let evaluation: string | null = null;
  let nextSteps: string | null = null;
  let totalTokens = 0;
  const maxTurns = 20;
  const maxTokensPerIteration = 100000; // Hard cap per iteration

  for (let turn = 0; turn < maxTurns; turn++) {
    if (isStopped()) break;

    // Progressive nudging toward evaluation
    if (turn >= 12 && !evaluation) {
      const turnsLeft = maxTurns - turn - 1;
      if (turnsLeft <= 0) {
        messages.push({
          role: 'user',
          content: 'This is your FINAL step. Write your ## Evaluation and ## Next Steps NOW. No code blocks.',
        });
      } else if (turnsLeft <= 3) {
        // Don't add extra message, but the continue prompt below will include the nudge
      }
    }

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    });

    await recordBuildUsage(
      build.id,
      parseUsage(response.usage),
      build.priceSnapshot as PriceSnapshot | null,
    );

    const assistantContent = response.choices[0]?.message?.content || '';
    totalTokens += response.usage?.total_tokens || 0;

    // Check per-iteration token cap
    if (totalTokens >= maxTokensPerIteration && !hasEvaluation(assistantContent)) {
      await emitLog(build.id, 'system', `Token cap reached (${totalTokens} tokens). Forcing evaluation.`, iteration.id);
      messages.push({
        role: 'user',
        content: 'You have exceeded the token budget for this iteration. Write your ## Evaluation and ## Next Steps NOW. No more code blocks.',
      });
      // Do one more turn to get the evaluation
      const evalResponse = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      });
      await recordBuildUsage(
        build.id,
        parseUsage(evalResponse.usage),
        build.priceSnapshot as PriceSnapshot | null,
      );
      const evalContent = evalResponse.choices[0]?.message?.content || '';
      totalTokens += evalResponse.usage?.total_tokens || 0;
      evaluation = extractSection(evalContent, 'Evaluation') || `Iteration stopped at token cap (${totalTokens} tokens). ${actions.length} actions executed.`;
      nextSteps = extractSection(evalContent, 'Next Steps') || 'Continue from where this iteration left off.';
      await emitLog(build.id, 'text', evalContent || evaluation, iteration.id);
      break;
    }

    messages.push({ role: 'assistant', content: assistantContent });

    // Persist messages incrementally
    await db
      .update(jkaiIterations)
      .set({
        messages: messages.filter((m) => m.role !== 'system'),
        tokensUsed: totalTokens,
      })
      .where(eq(jkaiIterations.id, iteration.id));

    if (turn === 0) {
      goals = assistantContent.split('\n').slice(0, 5).join('\n');
      const codeStart = assistantContent.indexOf('```');
      plan = codeStart > 0 ? assistantContent.slice(0, codeStart).trim() : assistantContent;
    }

    // Check for evaluation (signals iteration complete)
    if (hasEvaluation(assistantContent)) {
      evaluation = extractSection(assistantContent, 'Evaluation');
      nextSteps = extractSection(assistantContent, 'Next Steps');

      const textBeforeEval = assistantContent.split('## Evaluation')[0].trim();
      if (textBeforeEval) {
        await emitLog(build.id, 'text', textBeforeEval, iteration.id);
      }
      await emitLog(build.id, 'text', `## Evaluation\n${evaluation || ''}`, iteration.id);
      if (nextSteps) {
        await emitLog(build.id, 'text', `## Next Steps\n${nextSteps}`, iteration.id);
      }
      break;
    }

    // Check for code block
    const codeBlock = extractCodeBlock(assistantContent);
    if (codeBlock) {
      const textBefore = assistantContent.split('```')[0].trim();
      if (textBefore) {
        await emitLog(build.id, 'text', textBefore, iteration.id);
      }

      await emitLog(build.id, 'code', `\`\`\`${codeBlock.lang}\n${codeBlock.code}\n\`\`\``, iteration.id);

      // Execute code in the sandbox
      const workdir = `/home/jkai/workspace/${build.id}/dev`;
      let execCmd: string;
      if (['python'].includes(codeBlock.lang)) {
        const escaped = codeBlock.code.replace(/'/g, "'\\''");
        execCmd = `cd ${workdir} && cat > /tmp/jkai-code.py << 'JKAI_PYTHON_EOF'\n${codeBlock.code}\nJKAI_PYTHON_EOF\npython3 /tmp/jkai-code.py`;
      } else if (['javascript', 'typescript', 'node'].includes(codeBlock.lang)) {
        execCmd = `cd ${workdir} && cat > /tmp/jkai-code.js << 'JKAI_JS_EOF'\n${codeBlock.code}\nJKAI_JS_EOF\nnode /tmp/jkai-code.js`;
      } else {
        // Bash — executed directly (newlines preserved by execInSandbox)
        execCmd = `cd ${workdir}\n${codeBlock.code}`;
      }
      const execResult = await execInSandboxChecked(
        execCmd,
        codeBlock.code.includes('install') ? 300000 : 120000,
      );

      const action: ActionRecord = {
        lang: codeBlock.lang,
        code: codeBlock.code,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
      };
      actions.push(action);

      const outputStr = [
        execResult.stdout ? `stdout:\n${execResult.stdout}` : '',
        execResult.stderr ? `stderr:\n${execResult.stderr}` : '',
        `exit code: ${execResult.exitCode}`,
      ]
        .filter(Boolean)
        .join('\n');
      await emitLog(build.id, 'output', outputStr, iteration.id);

      const turnsRemaining = maxTurns - turn - 1;
      let outputMsg = `Command output (exit code ${execResult.exitCode}):\n${execResult.stdout}\n${execResult.stderr ? `stderr: ${execResult.stderr}` : ''}`;
      if (turnsRemaining <= 5 && turnsRemaining > 2) {
        outputMsg += `\n\n[${turnsRemaining} steps remaining — start wrapping up soon]`;
      } else if (turnsRemaining <= 2 && turnsRemaining > 0) {
        outputMsg += `\n\n[Only ${turnsRemaining} step(s) left — write your ## Evaluation and ## Next Steps next]`;
      }
      messages.push({ role: 'user', content: outputMsg });
    } else {
      // Plain text response (no code, no evaluation)
      await emitLog(build.id, 'text', assistantContent, iteration.id);

      const turnsLeft = maxTurns - turn - 1;
      let continueMsg = 'Continue with your next step. Write exactly ONE code block per response, or if you are done, write your ## Evaluation and ## Next Steps.';
      if (turnsLeft <= 5 && turnsLeft > 2) {
        continueMsg = `You have ${turnsLeft} steps remaining in this iteration. Start planning your evaluation. Continue with code or write your ## Evaluation and ## Next Steps.`;
      } else if (turnsLeft <= 2 && turnsLeft > 0) {
        continueMsg = `Only ${turnsLeft} step(s) left! Write your ## Evaluation and ## Next Steps now, or execute ONE final critical command.`;
      }
      messages.push({ role: 'user', content: continueMsg });
    }
  }

  // If we exhausted maxTurns without an evaluation, synthesize one
  if (!evaluation) {
    evaluation = `Iteration reached maximum turns (${maxTurns}) without completing evaluation. ${actions.length} actions were executed.`;
    nextSteps = 'Continue from where this iteration left off.';
    await emitLog(build.id, 'system', `Auto-evaluation: ${evaluation}`, iteration.id);
  }

  return { goals, plan, actions, messages: messages.filter((m) => m.role !== 'system'), evaluation, nextSteps, tokensUsed: totalTokens };
}
