import { describe, it, expect } from 'vitest';
import { conceptAnchorTurn } from './thread-graph';

// Regression fixture, from a real thread on homeserv:
//
//   0 assistant  (model-switch notice, no usage stamp)
//   1 user
//   2 assistant  usage stamp -> the model node lives here
//   3 user       heartbeat trigger
//   4 assistant  heartbeat reply, no usage stamp
//
// Concepts used to anchor to index 4, so they formed a clique among themselves
// while the model sat alone on turn 2 with no edges at all — the rail showed
// "Nothing else in this thread connects to it yet" next to a 4-node graph.

describe('conceptAnchorTurn', () => {
  it('anchors to the newest turn that has structure, not the last message', () => {
    expect(conceptAnchorTurn([2], 5)).toBe(2);
  });

  it('picks the newest structural turn when several carry nodes', () => {
    expect(conceptAnchorTurn([0, 2, 6, 4], 9)).toBe(6);
  });

  it('falls back to the last message when the thread has no structure', () => {
    // Nothing to connect to, so the old behaviour is preserved.
    expect(conceptAnchorTurn([], 5)).toBe(4);
  });

  it('does not return -1 for an empty thread', () => {
    expect(conceptAnchorTurn([], 0)).toBe(0);
  });

  it('handles a structural node on turn 0', () => {
    expect(conceptAnchorTurn([0], 3)).toBe(0);
  });
});
