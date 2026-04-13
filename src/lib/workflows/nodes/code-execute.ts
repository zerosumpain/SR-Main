import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { ensureSandboxRunning, execInSandbox, writeFileInSandbox } from '$lib/jkai/sandbox';

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
      return { output: { error: 'No code provided' }, logs: ['No code provided'] };
    }

    await ensureSandboxRunning();

    const inputJson = JSON.stringify(input);
    let wrappedCode: string;
    let filename: string;

    if (language === 'python') {
      filename = `workflow_${context.runId}.py`;
      wrappedCode = [
        'import json, sys, os',
        `input = json.loads(${JSON.stringify(inputJson)})`,
        code,
      ].join('\n');
    } else if (language === 'bash') {
      filename = `workflow_${context.runId}.sh`;
      wrappedCode = [
        `export WORKFLOW_INPUT=${JSON.stringify(inputJson)}`,
        code,
      ].join('\n');
    } else {
      filename = `workflow_${context.runId}.mjs`;
      wrappedCode = [
        `const input = ${inputJson};`,
        code,
      ].join('\n');
    }

    const workDir = `/home/jkai/workspace/workflow-runs/${context.runId}`;
    const fullPath = `${workDir}/${filename}`;
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

    return { output, logs: logs.length > 0 ? logs : undefined };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available as `input` variable in code' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    if (config.outputSchema && typeof config.outputSchema === 'object') {
      return config.outputSchema as JsonSchema;
    }
    return { type: 'object', description: 'Last line of stdout parsed as JSON, or { stdout: string }' };
  },
};

export const codeExecuteDef: NodeDefinition = {
  type: 'code-execute',
  label: 'Code Execute',
  category: 'core',
  description: 'Run JavaScript, Python, or Bash code in a sandboxed environment.',
  configSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Language: javascript, python, or bash',
      },
      code: {
        type: 'string',
        description: 'Code to execute. Input data is available as `input` variable.',
      },
      outputSchema: {
        type: 'object',
        description: 'Optional: declare the output shape so downstream nodes get autocomplete. e.g. { "score": { "type": "number" }, "label": { "type": "string" } }',
      },
    },
    required: ['code'],
  },
  defaultConfig: { language: 'javascript', code: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
};
