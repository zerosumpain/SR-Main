import { describe, expect, it } from 'vitest';
import { formatRescuePrBody } from './orchestrator';

describe('formatRescuePrBody', () => {
  it('includes the failed gate command and extracted stage diagnostics', () => {
    const body = formatRescuePrBody({
      kind: 'no_progress',
      message: '3 consecutive iterations changed no files while the gate was still failing.',
      gateCommand: 'npm run gate',
      diagnostics: [
        'The gate failed in `gate:check`.',
        'Error: Expected 2 arguments, but got 1.',
      ].join('\n'),
      attempts: 1,
    });

    expect(body).toContain('`no_progress`');
    expect(body).toContain('Command: `npm run gate`');
    expect(body).toContain('The gate failed in `gate:check`.');
    expect(body).toContain('Error: Expected 2 arguments, but got 1.');
  });
});
