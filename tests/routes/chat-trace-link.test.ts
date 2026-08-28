import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A finished turn's `analyse` link is ONE feature served by TWO fields.
 *
 * `ChatArea` reads `result.traceId` while the turn is finishing and
 * `metadata.traceId` after a reload. The chat route once set only the second,
 * so the button vanished the moment a toolchain completed — and came back if
 * you reloaded the page, which is the shape that makes it look like a rendering
 * bug rather than a missing field.
 *
 * Grep is the right tool here for the same reason it is in
 * `delegation-rule.test.ts`: the defect was a branch that forgot, so the guard
 * has to catch the NEXT branch that forgets. There is one branch today; a
 * behavioural test would pin that one and say nothing about a second.
 */
const ROOT = process.cwd();
const ROUTE = 'src/routes/api/workflows/orchestrator/chat/+server.ts';

/** The body of one `async function <name>(` through to the next top-level one. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in ${ROUTE}`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nasync function |\nexport const |\nfunction /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('a completed toolchain always offers its trace', () => {
  const src = readFileSync(join(ROOT, ROUTE), 'utf8');

  it.each(['handleWithLoop'])(
    '%s puts traceId on job.result — the LIVE path the analyse button reads',
    (fn) => {
      const body = functionBody(src, fn);
      expect(body, `${fn} persists a trace but never exposes it on job.result`).toMatch(
        /job\.result[\s\S]{0,400}traceId|\(job\.result as [^)]*\)\.traceId/,
      );
    },
  );

  it.each(['handleWithLoop'])(
    '%s puts traceId in the assistant message metadata — the RELOAD path',
    (fn) => {
      const body = functionBody(src, fn);
      expect(body, `${fn} never stamps metadata.traceId, so the link dies on reload`).toMatch(
        /(assistantMeta|assistantMetaParts)\.traceId\s*=/,
      );
    },
  );

  it.each(['handleWithLoop'])(
    '%s back-fills jkaiToolTraces.messageId once the assistant row exists',
    (fn) => {
      const body = functionBody(src, fn);
      // Both /jkai/trace/[traceId] and the analyse endpoint fall back to a
      // lookup by messageId; a null column makes that fallback dead.
      expect(body, `${fn} never links the trace row to its message`).toMatch(
        /update\(jkaiToolTraces\)[\s\S]{0,200}messageId/,
      );
    },
  );
});
