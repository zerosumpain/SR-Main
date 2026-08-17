import type { FailureEnvelope } from './types';

const MAX_NOTIFICATION_LENGTH = 140;

/**
 * Keeps a failure push actionable without duplicating gate output in the
 * persisted failure summary (which is rendered separately in rescue PRs).
 */
export function formatBuildFailureNotification(failure: FailureEnvelope): string {
  const firstDiagnostic = failure.diagnostics
    ?.split('\n')
    .find((line) => line.trim())
    ?.trim();
  const body = [failure.message.trim(), firstDiagnostic].filter(Boolean).join(' — ');

  return body.slice(0, MAX_NOTIFICATION_LENGTH) || 'jkai build failed';
}
