import { expect, it } from 'vitest';
import { DEVELOPMENT_LIMITS, developmentDeadline, developmentFailureKind, DevelopmentFailure, developmentFeedback, developmentTools } from './development-cycle';
it('holds checkpoints across restarts and allows more time only after a working preview', () => {
  const start = '2026-09-08T00:00:00Z';
  expect(developmentDeadline(start, false) - Date.parse(start)).toBe(600_000);
  expect(developmentDeadline(start, true) - Date.parse(start)).toBe(1_200_000);
  expect(DEVELOPMENT_LIMITS.turnMs).toBeLessThan(DEVELOPMENT_LIMITS.firstPreviewMs);
});
it('only explicitly identified feature failures may enter repair turns', () => {
  expect(developmentFailureKind(new Error('Docker connection lost'))).toBe('infrastructure');
  expect(developmentFailureKind(new DevelopmentFailure('bad markup', 'feature'))).toBe('feature');
  expect(developmentFailureKind(new DevelopmentFailure('expired', 'deadline'))).toBe('deadline');
});
it('keeps new feedback without repeating the repository listing', () => {
  expect(developmentFeedback('Fix selection.\n\nWorkspace state after this iteration:\n' + 'large-file\n'.repeat(500))).toBe('Fix selection.\n\n');
  expect(developmentFeedback('a'.repeat(5000))).toHaveLength(2400);
});
it('keeps discovery and owner decisions while dropping unrelated task tools', () => {
  expect(developmentTools(['ask_owner', 'workflow_inspect', 'tool_search', 'tool_describe', 'send_email', 'create_deck'])).toEqual(['ask_owner', 'workflow_inspect', 'tool_search', 'tool_describe']);
});
