/**
 * The body of the draft PR opened when a build fails with uncommitted work.
 *
 * Lives in its own module, and deliberately so. It began life inside
 * `orchestrator.ts`, which meant its unit test imported the orchestrator — and
 * that module's import graph reaches `$lib/workflows`, whose last lines are
 *
 *     const RUN_PLATFORM_SERVICES = process.env.JKAI_BUILDER_PROCESS !== '1';
 *     if (RUN_PLATFORM_SERVICES) bootWhatsApp();
 *
 * `JKAI_BUILDER_PROCESS` is not set under vitest, so merely importing the
 * orchestrator in a test connected to WhatsApp and attempted a device
 * registration, on every developer machine and in CI. A pure string formatter
 * has no business dragging platform services into a test run, so it is reachable
 * on its own. Keep it that way: this module must import nothing but types.
 */
import type { FailureEnvelope } from './types';

/**
 * Assembled as SECTIONS joined by a blank line rather than as a flat array with
 * hand-placed `''` separators. The flat shape put a separator at the head of the
 * gate block and then ran `.filter(Boolean)` over it, which threw that separator
 * away and glued `## Gate failure` onto the blockquote above it — and when there
 * was no gate block at all, the empty string it left behind became a stray blank
 * line. Sections that do not apply drop out of the list instead, so neither can
 * happen.
 */
export function formatRescuePrBody(failure: FailureEnvelope): string {
  const gateParts = [
    failure.gateCommand ? `Command: \`${failure.gateCommand}\`` : '',
    // The blank line after `Diagnostics:` is load-bearing. An indented code
    // block cannot interrupt a paragraph, so without it GitHub folds the
    // indented gate output back into the preceding paragraph and renders a
    // stack trace as running prose — verified against GitHub's own /markdown
    // endpoint. Indented rather than fenced because gate output is arbitrary
    // text and may itself contain a ``` fence.
    failure.diagnostics
      ? ['Diagnostics:', '', ...failure.diagnostics.split('\n').map((line) => `    ${line}`)].join('\n')
      : '',
  ].filter(Boolean);

  return [
    `This build **failed** (\`${failure.kind}\`) and this pull request is a rescue of the work it had already done. It is a DRAFT: the builder's gate, run in the build workspace, did not pass. CI runs its own gate on this PR and may reach a different result, so read the CI checks before judging the work.`,
    `> ${(failure.message ?? '').slice(0, 500)}`,
    ...(gateParts.length ? [['## Gate failure', ...gateParts].join('\n\n')] : []),
    'Review the diff before doing anything with it. To continue the work, resume the build rather than starting a new one — the workspace and branch are still on the VPS.',
  ].join('\n\n');
}
