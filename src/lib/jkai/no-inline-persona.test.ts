import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

/**
 * One soul (slice 9). Prose Main writes AS jkai takes its persona from
 * SR-Jkai-Core (`$lib/jkai/identity-client`, or a Core chat turn), never from a
 * sentence written here. The heartbeat's "You are a heartbeat-driven
 * assistant" was the last of these. Worker prompts (builder, red team,
 * reviewers) are not jkai speaking and are not matched.
 *
 * Allowed: Main's copy of the member allow-list, whose persona constant is
 * not what a member's turn runs on (Core's `surfaces/member.md` is).
 */
const ALLOWED = new Set(['src/lib/jkai/member-chat/policy.ts']);
const PERSONA = /You are (a |an )?(jkai|JKai|JKAI)\b|You are a heartbeat-driven assistant/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|js|svelte)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe('no inline jkai persona in Main', () => {
  it('finds none under src/', () => {
    const hits = walk(join(ROOT, 'src'))
      .map((f) => f.slice(ROOT.length + 1))
      .filter((f) => !ALLOWED.has(f) && PERSONA.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
