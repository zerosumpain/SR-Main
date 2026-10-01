import { expect, it } from 'vitest';
import { DEVELOPMENT_CEILING_FACTOR, DEVELOPMENT_LIMITS, developmentCeiling, developmentDeadline, developmentFailureKind, DevelopmentFailure, developmentFeedback, developmentTools } from './development-cycle';
it('holds checkpoints across restarts and allows more time only after a working preview', () => {
  const start = '2026-09-08T00:00:00Z';
  expect(developmentDeadline({ startedAt: start }, false) - Date.parse(start)).toBe(600_000);
  expect(developmentDeadline({ startedAt: start, previewMs: 0, verificationMs: 0 }, true) - Date.parse(start)).toBe(1_200_000);
  expect(DEVELOPMENT_LIMITS.turnMs).toBeLessThan(DEVELOPMENT_LIMITS.firstPreviewMs);
});
it('counts model time: recorded broker preview and verification time extends the deadline', () => {
  const start = '2026-09-08T00:00:00Z';
  // A 320s first preview and a 770s verification used to leave the model ~4 of its 10 minutes.
  expect(developmentDeadline({ startedAt: start, previewMs: 320_000, verificationMs: 0 }, false) - Date.parse(start)).toBe(920_000);
  expect(developmentDeadline({ startedAt: start, previewMs: 320_000, verificationMs: 770_000 }, true) - Date.parse(start)).toBe(2_290_000);
  // Corrupt negative timings never shorten the model's minutes.
  expect(developmentDeadline({ startedAt: start, previewMs: -5_000_000, verificationMs: 0 }, false) - Date.parse(start)).toBe(600_000);
});
it('a hung broker still ends the cycle at a hard wall-clock ceiling', () => {
  const start = '2026-09-08T00:00:00Z';
  expect(developmentCeiling(start, false) - Date.parse(start)).toBe(DEVELOPMENT_CEILING_FACTOR * 600_000);
  expect(developmentCeiling(start, true) - Date.parse(start)).toBe(DEVELOPMENT_CEILING_FACTOR * 1_200_000);
  expect(developmentDeadline({ startedAt: start, previewMs: 10 * 3_600_000, verificationMs: 0 }, false)).toBe(developmentCeiling(start, false));
  expect(developmentDeadline({ startedAt: start, previewMs: 0, verificationMs: 10 * 3_600_000 }, true)).toBe(developmentCeiling(start, true));
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
