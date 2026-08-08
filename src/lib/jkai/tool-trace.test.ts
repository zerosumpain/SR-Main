import { describe, it, expect } from 'vitest';
import { createTraceRecorder, capDeep, TRACE_CAPS, isUniformRows, coerceJsonString } from './tool-trace';
import type { JobEvent } from '$lib/workflows/chat/job-store';

/** A clock that advances a fixed step per read, so durations are deterministic. */
function fakeClock(startMs = 1_000, stepMs = 100) {
  let t = startMs - stepMs;
  return () => {
    t += stepMs;
    return t;
  };
}

describe('createTraceRecorder', () => {
  it('pairs a tool_start with its tool_result by toolCallId', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'web_search', args: { query: 'lords' }, toolCallId: 'c1' });
    rec.observe({ type: 'tool_result', tool: 'web_search', result: { hits: 3 }, status: 'done', toolCallId: 'c1' });

    const trace = rec.snapshot();
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({
      seq: 1,
      toolCallId: 'c1',
      tool: 'web_search',
      status: 'done',
      args: { query: 'lords' },
      result: { hits: 3 },
    });
    expect(trace.steps[0].durationMs).toBe(100);
  });

  it('keeps args from the start event when the result event carries none (the MCP bus case)', () => {
    // jsonrpc.ts publishes args only on `started`; completed/failed carry no args.
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'file_search', args: { q: 'invoice' }, toolCallId: 'b1' });
    rec.observe({ type: 'tool_result', tool: 'file_search', result: { data: { hits: [] } }, status: 'done', toolCallId: 'b1' });

    expect(rec.snapshot().steps[0].args).toEqual({ q: 'invoice' });
  });

  it('correlates by tool name when toolCallId is absent, newest running first', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'fetch_url', args: { url: 'a' } });
    rec.observe({ type: 'tool_start', tool: 'fetch_url', args: { url: 'b' } });
    rec.observe({ type: 'tool_result', tool: 'fetch_url', result: 'B', status: 'done' });

    const steps = rec.snapshot().steps;
    // The most recent running step of that name resolves first.
    expect(steps[1].result).toBe('B');
    expect(steps[1].status).toBe('done');
    expect(steps[0].status).toBe('running');
  });

  it('does not let one result close two same-named concurrent calls', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'web_search', args: { q: 'x' }, toolCallId: 'c1' });
    rec.observe({ type: 'tool_start', tool: 'web_search', args: { q: 'y' }, toolCallId: 'c2' });
    rec.observe({ type: 'tool_result', tool: 'web_search', result: 'first', status: 'done', toolCallId: 'c2' });

    const steps = rec.snapshot().steps;
    expect(steps.find((s) => s.toolCallId === 'c2')?.result).toBe('first');
    expect(steps.find((s) => s.toolCallId === 'c1')?.status).toBe('running');
  });

  it('records a result with no preceding start as its own step', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_result', tool: 'orphan', result: 'r', status: 'done', toolCallId: 'z9' });

    const steps = rec.snapshot().steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ tool: 'orphan', status: 'done', args: {} });
  });

  it('marks a failed step and lifts its error message', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'gmail_send', args: {}, toolCallId: 'e1' });
    rec.observe({ type: 'tool_result', tool: 'gmail_send', result: { error: 'auth expired' }, status: 'error', toolCallId: 'e1' });

    const step = rec.snapshot().steps[0];
    expect(step.status).toBe('error');
    expect(step.error).toBe('auth expired');
    expect(rec.snapshot().errorCount).toBe(1);
  });

  it('unwraps the jkai_extended meta-tool into the real sub-tool for display', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({
      type: 'tool_start',
      tool: 'mcp_jkai_jkai_extended',
      args: { operation: 'invoke', name: 'workflow_get_run', args: { runId: 'r1' } },
      toolCallId: 'm1',
    });

    const step = rec.snapshot().steps[0];
    expect(step.displayTool).toBe('workflow_get_run');
    expect(step.args).toEqual({ runId: 'r1' });
    expect(step.tool).toBe('mcp_jkai_jkai_extended');
  });

  it('assigns a category to every step', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'web_search', args: {}, toolCallId: 'a' });
    expect(rec.snapshot().steps[0].category).toBe('WEB');
  });

  it('stamps offsetMs so a step can be placed on the turn timeline', () => {
    const rec = createTraceRecorder({ now: fakeClock(5_000, 250) });
    rec.observe({ type: 'tool_start', tool: 't1', args: {}, toolCallId: '1' }); // 5000
    rec.observe({ type: 'tool_result', tool: 't1', result: 1, status: 'done', toolCallId: '1' }); // 5250
    rec.observe({ type: 'tool_start', tool: 't2', args: {}, toolCallId: '2' }); // 5500

    const trace = rec.snapshot();
    expect(trace.steps[0].offsetMs).toBe(0);
    expect(trace.steps[1].offsetMs).toBe(500);
  });

  it('leaves an unfinished step as running and still snapshots', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'hanging', args: {}, toolCallId: 'h1' });

    const trace = rec.snapshot();
    expect(trace.steps[0].status).toBe('running');
    expect(trace.steps[0].durationMs).toBeUndefined();
    expect(trace.stepCount).toBe(1);
  });

  it('ignores events that are not tool activity', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'token', delta: 'hello' });
    rec.observe({ type: 'status', text: 'thinking' });
    rec.observe({ type: 'heartbeat', summary: 'x', phase: 'thinking', elapsedMs: 10 });
    expect(rec.snapshot().steps).toHaveLength(0);
    expect(rec.hasSteps()).toBe(false);
  });

  it('nests sub-agent calls under their delegate step', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'delegate_task', args: { goal: 'research' }, toolCallId: 'd1' });
    rec.observe({ type: 'subagent_start', agentId: 'sub-0', parentStepId: 'd1', task: 'find sources' });
    rec.observe({
      type: 'subagent_event',
      agentId: 'sub-0',
      event: { type: 'tool_start', tool: 'web_search', args: { q: 'a' } },
    });
    rec.observe({
      type: 'subagent_event',
      agentId: 'sub-0',
      event: { type: 'tool_result', tool: 'web_search', result: 'ok', status: 'done' },
    });
    rec.observe({ type: 'subagent_done', agentId: 'sub-0', summary: 'found 3', result: {} });
    rec.observe({ type: 'tool_result', tool: 'delegate_task', result: '1 sub-agent task(s)', status: 'done', toolCallId: 'd1' });

    const trace = rec.snapshot();
    expect(trace.subAgents).toHaveLength(1);
    expect(trace.subAgents[0]).toMatchObject({ agentId: 'sub-0', task: 'find sources', status: 'done', summary: 'found 3' });
    expect(trace.subAgents[0].steps).toHaveLength(1);
    expect(trace.subAgents[0].steps[0]).toMatchObject({ tool: 'web_search', status: 'done', result: 'ok' });
    expect(trace.subAgents[0].parentStepId).toBe('d1');
  });

  it('tolerates a sub-agent event arriving before its start', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({
      type: 'subagent_event',
      agentId: 'ghost',
      event: { type: 'tool_start', tool: 'web_search', args: {} },
    });
    const trace = rec.snapshot();
    expect(trace.subAgents).toHaveLength(1);
    expect(trace.subAgents[0].agentId).toBe('ghost');
  });

  it('stops recording new steps past the cap but counts what it dropped', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    for (let i = 0; i < TRACE_CAPS.maxSteps + 5; i++) {
      rec.observe({ type: 'tool_start', tool: `t${i}`, args: {}, toolCallId: `c${i}` });
    }
    const trace = rec.snapshot();
    expect(trace.steps).toHaveLength(TRACE_CAPS.maxSteps);
    expect(trace.droppedSteps).toBe(5);
  });

  it('reports the turn wall-clock span', () => {
    const rec = createTraceRecorder({ now: fakeClock(1_000, 100) });
    rec.observe({ type: 'tool_start', tool: 'a', args: {}, toolCallId: '1' }); // 1000
    rec.observe({ type: 'tool_result', tool: 'a', result: 1, status: 'done', toolCallId: '1' }); // 1100
    rec.observe({ type: 'tool_start', tool: 'b', args: {}, toolCallId: '2' }); // 1200
    rec.observe({ type: 'tool_result', tool: 'b', result: 2, status: 'done', toolCallId: '2' }); // 1300

    const trace = rec.snapshot();
    expect(trace.startedAt).toBe(1_000);
    expect(trace.endedAt).toBe(1_300);
    expect(trace.durationMs).toBe(300);
  });
});

describe('capDeep', () => {
  it('passes small values through untouched', () => {
    const v = { a: 1, b: 'two', c: [1, 2, 3], d: null, e: true };
    expect(capDeep(v).value).toEqual(v);
    expect(capDeep(v).truncated).toBe(false);
  });

  it('truncates a long string and marks it', () => {
    const long = 'x'.repeat(TRACE_CAPS.maxString + 100);
    const out = capDeep({ body: long });
    expect(out.truncated).toBe(true);
    const body = (out.value as { body: string }).body;
    expect(body.length).toBeLessThanOrEqual(TRACE_CAPS.maxString + 32);
    // The marker states how much was dropped, not just that something was.
    expect(body).toContain('…');
    expect(body.endsWith('[+100 chars]')).toBe(true);
  });

  it('caps a long array and appends a marker element', () => {
    const arr = Array.from({ length: TRACE_CAPS.maxArray + 20 }, (_, i) => i);
    const out = capDeep(arr);
    expect(out.truncated).toBe(true);
    const got = out.value as unknown[];
    expect(got).toHaveLength(TRACE_CAPS.maxArray + 1);
    expect(got[TRACE_CAPS.maxArray]).toMatchObject({ __truncated__: true, omitted: 20 });
  });

  it('caps object keys and records how many were dropped', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < TRACE_CAPS.maxKeys + 7; i++) obj[`k${i}`] = i;
    const out = capDeep(obj);
    expect(out.truncated).toBe(true);
    const got = out.value as Record<string, unknown>;
    expect(Object.keys(got)).toHaveLength(TRACE_CAPS.maxKeys + 1);
    expect(got.__truncated__).toMatchObject({ omittedKeys: 7 });
  });

  it('stops at max depth rather than recursing forever', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < TRACE_CAPS.maxDepth + 5; i++) deep = { next: deep };
    const out = capDeep(deep);
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out.value)).toContain('__depth_capped__');
  });

  it('survives a circular reference', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = capDeep(a);
    expect(() => JSON.stringify(out.value)).not.toThrow();
    expect(JSON.stringify(out.value)).toContain('__circular__');
  });

  it('replaces a value that is huge even after capping', () => {
    // 200 keys each holding a near-max string blows the per-value byte budget.
    const obj: Record<string, string> = {};
    for (let i = 0; i < 200; i++) obj[`k${i}`] = 'y'.repeat(3_000);
    const out = capDeep(obj, TRACE_CAPS.maxValueBytes);
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out.value).length).toBeLessThanOrEqual(TRACE_CAPS.maxValueBytes + 512);
  });

  it('handles undefined and functions without throwing', () => {
    expect(capDeep(undefined).value).toBeUndefined();
    expect(() => capDeep(() => 1)).not.toThrow();
  });
});

describe('coerceJsonString', () => {
  it('parses a JSON object handed back as a string', () => {
    const out = coerceJsonString('{"results":[{"url":"a"}]}');
    expect(out.wasJsonString).toBe(true);
    expect(out.value).toEqual({ results: [{ url: 'a' }] });
  });

  it('parses a JSON array string', () => {
    expect(coerceJsonString("[1,2,3]")).toEqual({ value: [1, 2, 3], wasJsonString: true, clipped: false });
  });

  it('leaves ordinary prose alone', () => {
    const out = coerceJsonString('Ben Nevis is 1,345 m high.');
    expect(out.wasJsonString).toBe(false);
    expect(out.value).toBe('Ben Nevis is 1,345 m high.');
  });

  it('flags a JSON string that was cut off upstream rather than dropping it', () => {
    // Exactly what Hermes' 600-char native-tool preview produces.
    const out = coerceJsonString('{"results": [{"url": "https://example.com", "content": "half a sen');
    expect(out.wasJsonString).toBe(false);
    expect(out.clipped).toBe(true);
    expect(typeof out.value).toBe('string');
  });

  it('does not flag ordinary prose as clipped', () => {
    expect(coerceJsonString('Reykjavik has about 140,000 people.').clipped).toBe(false);
  });

  it('does not coerce a bare scalar string that happens to parse', () => {
    // "123" parses to a number — not an object, so it stays a string.
    expect(coerceJsonString('123').wasJsonString).toBe(false);
  });

  it('passes non-strings through untouched', () => {
    const obj = { a: 1 };
    expect(coerceJsonString(obj)).toEqual({ value: obj, wasJsonString: false, clipped: false });
  });
});

describe('recorder parses JSON-string results before capping', () => {
  it('keeps a big JSON-string result table-ifiable instead of truncating it into garbage', () => {
    // web_extract's real shape: a JSON string far longer than maxString. Capping
    // first would slice it mid-structure and leave unparseable text.
    const rows = Array.from({ length: 8 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `Doc ${i}`,
      content: 'z'.repeat(TRACE_CAPS.maxString + 1_000),
    }));
    const payload = JSON.stringify({ results: rows });
    expect(payload.length).toBeGreaterThan(TRACE_CAPS.maxString);

    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 'web_extract', args: { urls: ['x'] }, toolCallId: 'w1' });
    rec.observe({ type: 'tool_result', tool: 'web_extract', result: payload, status: 'done', toolCallId: 'w1' });

    const step = rec.snapshot().steps[0];
    expect(step.resultJsonString).toBe(true);
    // Structure survived: still an object with an array of 8 rows.
    const result = step.result as { results: Record<string, unknown>[] };
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results).toHaveLength(8);
    expect(result.results[0].url).toBe('https://example.com/0');
    // Individual long fields were capped, not the whole payload.
    expect(String(result.results[0].content)).toContain('…');
    expect(isUniformRows(result.results)).toBe(true);
    // Size is reported against what the tool actually sent.
    expect(step.resultBytes).toBe(JSON.stringify(payload).length);
  });

  it('does not flag a result that was already an object', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    rec.observe({ type: 'tool_start', tool: 't', args: {}, toolCallId: '1' });
    rec.observe({ type: 'tool_result', tool: 't', result: { ok: true }, status: 'done', toolCallId: '1' });
    expect(rec.snapshot().steps[0].resultJsonString).toBeUndefined();
  });
});

describe('isUniformRows', () => {
  it('accepts an array of objects sharing keys', () => {
    expect(isUniformRows([{ a: 1, b: 2 }, { a: 3, b: 4 }])).toBe(true);
  });

  it('accepts rows with mostly-overlapping keys', () => {
    expect(isUniformRows([{ a: 1, b: 2 }, { a: 3, b: 4, c: 5 }])).toBe(true);
  });

  it('rejects arrays of scalars', () => {
    expect(isUniformRows([1, 2, 3])).toBe(false);
    expect(isUniformRows(['a', 'b'])).toBe(false);
  });

  it('rejects a single-row array (a table of one adds nothing)', () => {
    expect(isUniformRows([{ a: 1 }])).toBe(false);
  });

  it('rejects rows whose values are themselves deep objects', () => {
    expect(isUniformRows([{ a: { deep: { deeper: 1 } } }, { a: { deep: { deeper: 2 } } }])).toBe(false);
  });

  it('rejects disjoint shapes', () => {
    expect(isUniformRows([{ a: 1 }, { z: 2 }])).toBe(false);
  });

  it('rejects non-arrays and empties', () => {
    expect(isUniformRows(null)).toBe(false);
    expect(isUniformRows([])).toBe(false);
    expect(isUniformRows({ a: 1 })).toBe(false);
  });
});

describe('recorder → JSON round trip', () => {
  it('produces a snapshot that survives JSON.stringify for the jsonb column', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    rec.observe({ type: 'tool_start', tool: 'weird', args: circular as Record<string, unknown>, toolCallId: 'w1' });
    rec.observe({ type: 'tool_result', tool: 'weird', result: circular, status: 'done', toolCallId: 'w1' });

    const trace = rec.snapshot();
    expect(() => JSON.stringify(trace)).not.toThrow();
  });

  it('keeps the whole trace under the total byte budget', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    for (let i = 0; i < 120; i++) {
      rec.observe({ type: 'tool_start', tool: `t${i}`, args: { blob: 'z'.repeat(20_000) }, toolCallId: `c${i}` });
      rec.observe({ type: 'tool_result', tool: `t${i}`, result: { blob: 'z'.repeat(20_000) }, status: 'done', toolCallId: `c${i}` });
    }
    const trace = rec.snapshot();
    expect(JSON.stringify(trace).length).toBeLessThanOrEqual(TRACE_CAPS.maxTotalBytes);
    expect(trace.payloadsDropped).toBeGreaterThan(0);
    // Metadata for every step survives even when payloads are shed.
    expect(trace.steps).toHaveLength(120);
    expect(trace.steps.every((s) => s.tool && s.status)).toBe(true);
  });
});

// A JobEvent that the recorder must ignore rather than crash on — proves the
// observe() switch is total over the union.
describe('observe is total over JobEvent', () => {
  it('accepts every event type without throwing', () => {
    const rec = createTraceRecorder({ now: fakeClock() });
    const events: JobEvent[] = [
      { type: 'token', delta: 'a' },
      { type: 'replace_bubble', content: 'b' },
      { type: 'thinking', delta: 'c' },
      { type: 'status', text: 'd' },
      { type: 'heartbeat', summary: 'e', phase: 'thinking', elapsedMs: 1 },
      { type: 'done', result: {} },
      { type: 'error', message: 'f' },
    ];
    for (const e of events) expect(() => rec.observe(e)).not.toThrow();
  });
});
