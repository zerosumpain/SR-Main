import { describe, expect, it } from 'vitest';
import { formatBuildFailureNotification } from './failure-notification';

const base = { kind: 'no_progress' as const, message: 'Three iterations changed no files.', attempts: 1 };

describe('formatBuildFailureNotification', () => {
  it('uses the summary when no diagnostics are available', () => {
    expect(formatBuildFailureNotification(base)).toBe('Three iterations changed no files.');
  });

  it('adds the first non-empty diagnostic line to the summary', () => {
    expect(
      formatBuildFailureNotification({
        ...base,
        diagnostics: '\n  Error: Expected 2 arguments, but got 1.\n  at src/lib/jkai/orchestrator.ts:1',
      }),
    ).toBe('Three iterations changed no files. — Error: Expected 2 arguments, but got 1.');
  });

  it('truncates the complete notification when its first diagnostic line exceeds the budget', () => {
    const body = formatBuildFailureNotification({ ...base, diagnostics: 'x'.repeat(200) });

    expect(body).toHaveLength(140);
    expect(body).toBe(`Three iterations changed no files. — ${'x'.repeat(103)}`);
  });
});
