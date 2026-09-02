import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A tripwire for "imported but never called".
 *
 * Chat entity extraction was silently dead for nine days. The call to
 * `maybeExtractThreadConcepts` lived only inside `handleWithHermes`; removing
 * Hermes (#489) deleted that branch and took the call with it, leaving the
 * import in place. Nothing caught it: the import is still *used* as far as the
 * module graph is concerned, TypeScript has nothing to say about a function
 * that is merely never invoked, and the only visible symptom was an empty
 * knowledge graph beside every thread — which reads as a broken rail.
 *
 * A behavioural test would have to stand up the whole chat endpoint, its job
 * loop and its stream. The regression is a source-level fact, so this is a
 * source-level assertion: the surviving branch must contain the call, and it
 * must sit inside `handleWithLoop` rather than anywhere else in the file.
 */
const ENDPOINT = resolve(
  import.meta.dirname ?? __dirname,
  '../../../routes/api/workflows/orchestrator/chat/+server.ts',
);

/**
 * Drop comment LINES before anything is matched.
 *
 * The first cut of this test passed with the call commented out, because the
 * commented line still contains the text it was looking for — and the endpoint
 * carries a doc comment naming the function too. The second cut used a
 * non-greedy block-comment regex and ate the call itself, because a `/*`
 * appearing anywhere earlier in the file (a glob, a content type) opens a match
 * that runs to the next close.
 *
 * So: line-based, and only lines that are ENTIRELY comment. It cannot over-eat,
 * which is the property that matters. Both directions are checked — there is a
 * case below asserting a commented-out call does not satisfy it.
 */
function stripCommentLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

describe('the chat endpoint feeds the knowledge graph', () => {
  const src = stripCommentLines(readFileSync(ENDPOINT, 'utf8'));

  it('calls maybeExtractThreadConcepts, not merely imports it', () => {
    expect(src).toContain("import { maybeExtractThreadConcepts } from '$lib/jkai/intel/chat-extract'");
    expect(src).toMatch(/maybeExtractThreadConcepts\(/);
  });

  it('makes that call inside handleWithLoop, the branch that actually answers', () => {
    const loopAt = src.indexOf('async function handleWithLoop');
    expect(loopAt).toBeGreaterThan(-1);

    // Every call site, by index. At least one must fall after the declaration
    // of the surviving handler — a call left behind in a dead branch above it
    // is exactly the state this test exists to fail on.
    const calls: number[] = [];
    const re = /maybeExtractThreadConcepts\(/g;
    for (let m = re.exec(src); m; m = re.exec(src)) calls.push(m.index);

    expect(calls.some((i) => i > loopAt)).toBe(true);
  });

  it('fires it without awaiting, so an extraction failure cannot cost a reply', () => {
    expect(src).toMatch(/void maybeExtractThreadConcepts\([^)]*\)\.catch\(/);
  });

  it('is a test that can actually fail — a commented-out call does not count', () => {
    const commentedOut = stripCommentLines(
      "async function handleWithLoop() {\n  // void maybeExtractThreadConcepts(id, null).catch(() => {});\n}",
    );
    expect(commentedOut).not.toMatch(/maybeExtractThreadConcepts\(/);
  });
});
