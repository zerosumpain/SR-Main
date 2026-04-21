import { describe, it, expect } from 'vitest';
import {
  compatibility,
  scoreCandidate,
  rankForWorkflow,
  type HandleKind,
  type NodeHandles,
} from '$lib/canvas/handles';

const chat: NodeHandles = {
  inputs: [{ id: 'trigger', kinds: ['trigger-signal', 'text'] }],
  outputs: [{ id: 'out', kinds: ['text'] }],
};
const llm: NodeHandles = {
  inputs: [{ id: 'in', kinds: ['text'] }],
  outputs: [{ id: 'out', kinds: ['text'] }],
};
const webpage: NodeHandles = {
  inputs: [{ id: 'src', kinds: ['url', 'research-result', 'text'] }],
  outputs: [
    { id: 'currentUrl', kinds: ['url'] },
    { id: 'selectedText', kinds: ['text'] },
    { id: 'extractedText', kinds: ['text'] },
  ],
};
const stats: NodeHandles = {
  inputs: [{ id: 'data', kinds: ['dataset'] }],
  outputs: [],
};

describe('compatibility', () => {
  it('returns 1 when any output kind intersects any input kind', () => {
    expect(compatibility(chat.outputs, llm.inputs)).toBe(1);
  });
  it('returns 0 when no output kinds intersect', () => {
    expect(compatibility(chat.outputs, stats.inputs)).toBe(0);
  });
  it("treats 'any' as wildcard on either side", () => {
    const anyIn: NodeHandles['inputs'] = [{ id: 'x', kinds: ['any'] }];
    expect(compatibility(chat.outputs, anyIn)).toBe(1);
    const anyOut: NodeHandles['outputs'] = [{ id: 'x', kinds: ['any'] }];
    expect(compatibility(anyOut, stats.inputs)).toBe(1);
  });
  it('handles empty output arrays', () => {
    expect(compatibility([], llm.inputs)).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('sums compatibility across all canvas nodes', () => {
    const onCanvas = [chat, chat, llm];
    expect(scoreCandidate(llm, onCanvas, 0, 0)).toBe(3);
  });
  it('adds recent-usage boost capped at +3', () => {
    expect(scoreCandidate(llm, [], 5, 0)).toBe(3);
    expect(scoreCandidate(llm, [], 2, 0)).toBe(2);
  });
  it('adds default-weight tiebreaker', () => {
    expect(scoreCandidate(llm, [], 0, 0.5)).toBeCloseTo(0.5);
  });
});

describe('rankForWorkflow', () => {
  it('returns top N candidates sorted by score', () => {
    const candidates = [
      { type: 'llm-call', handles: llm, defaultWeight: 0.5 },
      { type: 'stats-summary', handles: stats, defaultWeight: 0 },
      { type: 'webpage', handles: webpage, defaultWeight: 0.2 },
    ];
    const ranked = rankForWorkflow(candidates, [chat], {}, 2);
    expect(ranked.map((c) => c.type)).toEqual(['llm-call', 'webpage']);
  });
  it('samples the 50 most recent nodes when >50 on canvas', () => {
    const many = Array.from({ length: 100 }, () => stats);
    const candidates = [{ type: 'llm-call', handles: llm, defaultWeight: 0 }];
    const ranked = rankForWorkflow(candidates, many, {}, 1);
    expect(ranked.length).toBe(1);
  });
});
