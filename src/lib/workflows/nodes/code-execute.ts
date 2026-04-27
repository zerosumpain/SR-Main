import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { ensureSandboxRunning, execInSandbox, writeFileInSandbox } from '$lib/jkai/sandbox';
import { loadKeys } from '$lib/deepdive/keys';
import { getOpenRouterApiKey } from '$lib/server/models/settings';

export { codeExecuteDef } from './code-execute.def';

/**
 * Collect API keys from /admin/keys storage (keys.json file + app_settings DB)
 * and map them to conventional env-var names so sandbox code can reference them
 * (e.g. `process.env.TAVILY_API_KEY`). Single source of truth: /admin/keys.
 */
async function collectSandboxEnv(): Promise<Record<string, string>> {
  const keys = loadKeys();
  const env: Record<string, string> = {};
  if (keys.tavilyApiKey) env.TAVILY_API_KEY = keys.tavilyApiKey;
  if (keys.zaiApiKey) env.ZAI_API_KEY = keys.zaiApiKey;
  if (keys.elevenlabsApiKey) env.ELEVENLABS_API_KEY = keys.elevenlabsApiKey;
  // OpenRouter lives in the DB (primary) with keys.json fallback
  try {
    const orKey = await getOpenRouterApiKey();
    if (orKey) env.OPENROUTER_API_KEY = orKey;
  } catch { /* non-fatal */ }
  return env;
}

export const codeExecuteExecutor: NodeExecutor = {
  type: 'code-execute',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const language = (config.language as string) || 'javascript';
    const code = config.code as string;
    const logs: string[] = [];

    if (!code) {
      return { output: { error: 'No code provided' }, logs: ['No code provided'], rowCount: 1 };
    }

    await ensureSandboxRunning();

    const sandboxEnv = await collectSandboxEnv();
    const inputJson = JSON.stringify(input);
    let wrappedCode: string;
    let filename: string;

    if (language === 'python') {
      filename = `workflow_${context.runId}.py`;
      const envLines = Object.entries(sandboxEnv).map(
        ([k, v]) => `os.environ[${JSON.stringify(k)}] = ${JSON.stringify(v)}`,
      );
      wrappedCode = [
        'import json, sys, os',
        ...envLines,
        `input = json.loads(${JSON.stringify(inputJson)})`,
        code,
      ].join('\n');
    } else if (language === 'bash') {
      filename = `workflow_${context.runId}.sh`;
      const envLines = Object.entries(sandboxEnv).map(
        ([k, v]) => `export ${k}=${JSON.stringify(v)}`,
      );
      wrappedCode = [
        ...envLines,
        `export WORKFLOW_INPUT=${JSON.stringify(inputJson)}`,
        code,
      ].join('\n');
    } else {
      filename = `workflow_${context.runId}.mjs`;
      const envLines = Object.entries(sandboxEnv).map(
        ([k, v]) => `process.env[${JSON.stringify(k)}] = ${JSON.stringify(v)};`,
      );
      wrappedCode = [
        ...envLines,
        `const input = ${inputJson};`,
        `(async () => {`,
        `  const __r = await (async () => {`,
        code,
        `  })();`,
        `  if (__r !== undefined) console.log(JSON.stringify(__r));`,
        `})().catch(e => { console.error(e && e.stack || String(e)); process.exit(1); });`,
      ].join('\n');
    }

    const workDir = `/home/jkai/workspace/workflow-runs/${context.runId}`;
    const fullPath = `${workDir}/${filename}`;
    await execInSandbox(`mkdir -p ${workDir}`);
    await writeFileInSandbox(fullPath, wrappedCode);

    let execCmd: string;
    if (language === 'python') {
      execCmd = `cd ${workDir} && python3 ${filename}`;
    } else if (language === 'bash') {
      execCmd = `cd ${workDir} && bash ${filename}`;
    } else {
      execCmd = `cd ${workDir} && node ${filename}`;
    }

    const result = await execInSandbox(execCmd);

    if (result.stderr) {
      logs.push(result.stderr);
    }

    if (result.exitCode !== 0) {
      return {
        output: { error: result.stderr || 'Non-zero exit code', exitCode: result.exitCode },
        logs,
        rowCount: 1,
      };
    }

    // Try to parse the last line of stdout as JSON output
    const stdoutLines = result.stdout.trim().split('\n');
    const lastLine = stdoutLines[stdoutLines.length - 1];
    let output: Record<string, unknown>;

    try {
      output = JSON.parse(lastLine);
    } catch {
      output = { stdout: result.stdout };
    }

    if (stdoutLines.length > 1) {
      logs.push(stdoutLines.slice(0, -1).join('\n'));
    }

    return { output, logs: logs.length > 0 ? logs : undefined, rowCount: 1 };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available as `input` variable in code' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    if (config.outputSchema && typeof config.outputSchema === 'object') {
      return config.outputSchema as JsonSchema;
    }
    return {
      type: 'object',
      properties: {
        result: { type: 'object', description: 'Return value from the code', additionalProperties: true },
        stdout: { type: 'string', description: 'Standard output from execution' },
        stderr: { type: 'string', description: 'Standard error from execution' },
      },
    };
  },
};

