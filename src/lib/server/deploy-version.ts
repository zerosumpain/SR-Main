import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DeployVersion {
  sha: string | null;
  short: string;
  tree: string | null;
  builtAt: string | null;
  promotedAt: string | null;
  via: string;
}

function parseStamp(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const split = line.indexOf('=');
    if (split <= 0) continue;
    values.set(line.slice(0, split), line.slice(split + 1));
  }
  return values;
}

/** Read the stamp belonging to the build currently selected by build/. */
export function getDeployVersion(root = process.cwd()): DeployVersion {
  try {
    const values = parseStamp(readFileSync(join(root, 'build', '.deploy-sha'), 'utf8'));
    const sha = values.get('sha') ?? null;
    return {
      sha,
      short: values.get('short') ?? sha?.slice(0, 8) ?? 'unknown',
      tree: values.get('tree') ?? null,
      builtAt: values.get('built_at') ?? null,
      promotedAt: values.get('promoted_at') ?? null,
      via: values.get('via') ?? 'unknown',
    };
  } catch {
    return {
      sha: null,
      short: 'development',
      tree: null,
      builtAt: null,
      promotedAt: null,
      via: 'local',
    };
  }
}
