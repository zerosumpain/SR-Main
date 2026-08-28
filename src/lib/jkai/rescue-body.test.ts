import { describe, expect, it } from 'vitest';
import { formatRescuePrBody } from './rescue-body';

const base = { kind: 'no_progress' as const, message: 'Gate still failing.', attempts: 1 };

describe('formatRescuePrBody', () => {
  it('includes the failed gate command and extracted stage diagnostics', () => {
    const body = formatRescuePrBody({
      ...base,
      message: '3 consecutive iterations changed no files while the gate was still failing.',
      gateCommand: 'npm run gate',
      diagnostics: ['The gate failed in `gate:check`.', 'Error: Expected 2 arguments, but got 1.'].join('\n'),
    });

    expect(body).toContain('`no_progress`');
    expect(body).toContain('Command: `npm run gate`');
    expect(body).toContain('The gate failed in `gate:check`.');
    expect(body).toContain('Error: Expected 2 arguments, but got 1.');
  });

  /*
   * An indented code block CANNOT interrupt a paragraph. Without a blank line
   * after `Diagnostics:`, GitHub folds the indented gate output back into that
   * paragraph and renders a stack trace as running prose — the indent is
   * silently discarded. Checked against GitHub's own /markdown endpoint, which
   * returned `<p>Diagnostics: The gate failed…</p>` for the un-separated form
   * and `<pre><code>` for this one.
   */
  it('leaves a blank line before the indented diagnostics so they render as a code block', () => {
    const body = formatRescuePrBody({ ...base, diagnostics: 'Error: boom\n  at thing.ts:4' });
    expect(body).toContain('Diagnostics:\n\n    Error: boom\n      at thing.ts:4');
  });

  it('separates the gate section from the quoted message', () => {
    // The section heading used to be glued directly onto the blockquote,
    // because the separator was filtered out as falsy alongside the genuinely
    // absent parts.
    const body = formatRescuePrBody({ ...base, message: 'Gate still failing.', gateCommand: 'npm run gate' });
    expect(body).toContain('> Gate still failing.\n\n## Gate failure');
  });

  /*
   * Every failure kind except `no_progress` reaches the rescue path without a
   * gate result — the gate either never ran (the agent failed first) or passed.
   * That is the majority case and it was the untested one.
   */
  it('omits the gate section entirely when there is no gate information', () => {
    const body = formatRescuePrBody({ kind: 'stalled', message: 'No liveness ping.', attempts: 1 });
    expect(body).not.toContain('## Gate failure');
    expect(body).not.toContain('Diagnostics:');
    // No stray blank run where the absent section used to leave an empty string.
    expect(body).not.toMatch(/\n{3}/);
  });

  it('emits a command-only section when the gate failed with no extractable diagnostics', () => {
    const body = formatRescuePrBody({ ...base, gateCommand: 'npm run gate', diagnostics: '' });
    expect(body).toContain('## Gate failure');
    expect(body).toContain('Command: `npm run gate`');
    expect(body).not.toContain('Diagnostics:');
    expect(body).not.toMatch(/\n{3}/);
  });

  it('truncates a runaway failure message', () => {
    const body = formatRescuePrBody({ ...base, message: 'x'.repeat(900) });
    expect(body).toContain(`> ${'x'.repeat(500)}\n`);
    expect(body).not.toContain('x'.repeat(501));
  });
});
