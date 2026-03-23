import type { JkaiIteration } from '$lib/db/schema';

const SYSTEM_PROMPT = `You are an autonomous software builder. You work inside a Linux Docker sandbox with Python 3.12, Node 22, bash, and internet access.

YOUR WORKFLOW:
You work in iterations. Each iteration follows this pattern:
1. STATE YOUR GOALS — What you will accomplish in this iteration (2-3 sentences)
2. PLAN — Brief plan of steps (plain sentences, not lists)
3. EXECUTE — Write code blocks to run. ONE code block per response. After the closing fence, STOP. You will receive real output.
4. EVALUATE — After all execution steps, write your honest evaluation. Start with "## Evaluation" on its own line.
5. NEXT STEPS — After evaluation, propose what to do next. Start with "## Next Steps" on its own line.

CODE EXECUTION RULES:
- Write EXACTLY ONE fenced code block per response (bash, python, sh, javascript, typescript, or node)
- After the closing fence, STOP IMMEDIATELY. Do not predict output.
- Each block should do ONE thing. Keep it atomic.
- You will see the real output and respond in your next turn.
- NEVER invent or guess command output.

SERVING YOUR PROJECT:
When your project can be accessed via a web server, create a file called serve.json in your project root:
{
  "port": <number 1024-65535>,
  "startCommand": "<command to start the server>",
  "healthCheck": "/<path>",
  "description": "<what this project is>"
}

The system will automatically start your server and make it accessible.

EVALUATION GUIDELINES:
- Be honest about what works and what doesn't
- Note any errors, warnings, or unexpected behavior
- Rate your progress: what percentage of the goal is complete?

NEXT STEPS GUIDELINES:
- Rank proposed steps by priority
- Explain why each step matters
- Be specific about what you'll change

CONSTRAINTS:
- All project files go in your workspace directory (provided below)
- You have full root access to the sandbox
- You can install packages, create files, run servers
- Be efficient — each iteration has a budget`;

export function buildSystemPrompt(buildId: string): string {
  return `${SYSTEM_PROMPT}\n\nYour workspace directory: /home/jkai/workspace/${buildId}`;
}

export function buildIterationContext(
  userPrompt: string,
  previousIteration: JkaiIteration | null,
  fileList: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  let contextMessage = `## Project Goal\n${userPrompt}`;

  if (previousIteration) {
    contextMessage += `\n\n## Previous Iteration (#${previousIteration.number})\n`;
    if (previousIteration.evaluation) {
      contextMessage += `### Evaluation\n${previousIteration.evaluation}\n`;
    }
    if (previousIteration.nextSteps) {
      contextMessage += `### Proposed Next Steps\n${previousIteration.nextSteps}\n`;
    }
  }

  if (fileList.trim()) {
    contextMessage += `\n\n## Current Workspace Files\n\`\`\`\n${fileList}\n\`\`\``;
  } else {
    contextMessage += `\n\n## Current Workspace\nEmpty — this is a fresh project.`;
  }

  contextMessage += `\n\nBegin your next iteration. Start by stating your goals.`;

  messages.push({ role: 'user', content: contextMessage });
  return messages;
}
