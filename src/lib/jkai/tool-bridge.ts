import crypto from 'node:crypto';
import {
  executeTool,
  getTool,
  getToolDefinitions,
  getToolsetManifest,
} from '$lib/workflows/site-tools/registry';

const SECRET_RAW = process.env.JKAI_BRIDGE_SECRET ?? 'jkai-bridge-dev-secret';

function secret(): string {
  return SECRET_RAW;
}

export function signBridgeToken(buildId: string): string {
  const payload = `${buildId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyBridgeToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [buildId, ts, sig] = parts;
    const expected = crypto
      .createHmac('sha256', secret())
      .update(`${buildId}.${ts}`)
      .digest('hex');
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    return buildId;
  } catch {
    return null;
  }
}

export async function invokeTool(name: string, args: unknown): Promise<unknown> {
  if (!getTool(name)) throw new Error(`unknown tool: ${name}`);
  const result = await executeTool(name, (args ?? {}) as Record<string, unknown>);
  if (!result.success) {
    throw new Error(result.error ?? 'tool execution failed');
  }
  return result;
}

export function manifestForBuild(enabledToolsets: string[]) {
  const all = getToolsetManifest();
  if (enabledToolsets.includes('all')) return all;
  return all.filter((t) => enabledToolsets.includes(t.toolset));
}

export function definitionsForBuild(enabledToolsets: string[]) {
  const allDefs = getToolDefinitions();
  if (enabledToolsets.includes('all')) return allDefs;
  const allowedSets = manifestForBuild(enabledToolsets).map((m) => m.toolset);
  const allowedNames = new Set(
    manifestForBuild(enabledToolsets).flatMap((m) => m.tools.map((t) => t.name)),
  );
  return allDefs.filter((d) => allowedNames.has(d.function.name) || allowedSets.length === 0);
}
