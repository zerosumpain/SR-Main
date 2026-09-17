import { describe, it, expect, vi } from 'vitest';
import {
  coerceInvokeRequest,
  createNdjsonReader,
  InvokeContractError,
  resultLine,
  statusLine,
  wantsNdjson,
  STATUS_FRAME_LIMIT,
} from './invoke-contract';

describe('coerceInvokeRequest', () => {
  it('takes a name, arguments and the six context fields chat actually sends', () => {
    const req = coerceInvokeRequest({
      name: 'site_blog_list',
      args: { limit: 5 },
      context: {
        conversationId: 'c1',
        workflowId: 'w1',
        jobId: 'j1',
        modelContext: { modelId: 'claude-opus-5' },
        thinkingLevel: 'high',
        allowedTools: ['site_blog_list', 'site_blog_get'],
      },
    });
    expect(req).toEqual({
      name: 'site_blog_list',
      args: { limit: 5 },
      context: {
        conversationId: 'c1',
        workflowId: 'w1',
        jobId: 'j1',
        modelContext: { modelId: 'claude-opus-5' },
        thinkingLevel: 'high',
        allowedTools: ['site_blog_list', 'site_blog_get'],
      },
    });
  });

  it('defaults args and context, so a no-argument tool needs neither', () => {
    expect(coerceInvokeRequest({ name: 'site_blog_list' })).toEqual({
      name: 'site_blog_list',
      args: {},
      context: {},
    });
  });

  /**
   * The whitelist is the security property, not a tidiness one.
   *
   * `ToolExecContext` has thirteen fields and four of them must never be
   * settable by a caller across the wire:
   *
   *  - `buildId`/`iterationId` attribute a tool's writes to a build. A chat
   *    process that could set them would stamp its rows with somebody else's
   *    provenance.
   *  - `depth` guards `platform.call` recursion (`registry.ts` refuses above 5).
   *    A caller that can send `depth: 0` on every hop has removed the guard.
   *  - `busKey` addresses the tool-step bus — the destructive confirmer and the
   *    credential requester are keyed by it.
   *
   * Reading only what is declared is the same rule `coercePlan` follows in the
   * self-improvement engine, and for the same reason: an unrecognised field is
   * dropped, never guessed at.
   */
  it('drops context fields that must not cross the wire', () => {
    const req = coerceInvokeRequest({
      name: 't',
      context: {
        conversationId: 'c1',
        buildId: 'b1',
        iterationId: 'i1',
        depth: 0,
        busKey: 'somebody-elses-chat',
        signal: {},
        deadline: 1,
        emit: 'nope',
      },
    });
    expect(req.context).toEqual({ conversationId: 'c1' });
  });

  it('keeps an empty allowedTools as empty, because that means nothing is allowed', () => {
    // `executeTool` reads `ctx.allowedTools && !includes(name)`, so [] refuses
    // every tool. Coercing it away to `undefined` would turn the most
    // restrictive scope into no scope at all — the fail-open the build bridge
    // already had to have removed once.
    expect(coerceInvokeRequest({ name: 't', context: { allowedTools: [] } }).context.allowedTools).toEqual([]);
  });

  it('filters non-strings out of allowedTools rather than trusting the array', () => {
    expect(
      coerceInvokeRequest({ name: 't', context: { allowedTools: ['a', 3, null, 'b'] } }).context.allowedTools,
    ).toEqual(['a', 'b']);
  });

  it('carries workflowId: null, which means an unscoped chat and is not the same as absent', () => {
    expect(coerceInvokeRequest({ name: 't', context: { workflowId: null } }).context).toEqual({
      workflowId: null,
    });
  });

  it('carries thinkingLevel: null', () => {
    expect(coerceInvokeRequest({ name: 't', context: { thinkingLevel: null } }).context).toEqual({
      thinkingLevel: null,
    });
  });

  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['an array', []],
    ['no name', { args: {} }],
    ['an empty name', { name: '' }],
    ['a non-string name', { name: 7 }],
  ])('refuses a body that is %s', (_label, body) => {
    expect(() => coerceInvokeRequest(body)).toThrow(InvokeContractError);
  });

  it('refuses args that are not an object, rather than silently emptying them', () => {
    // Silently defaulting would run the tool with no arguments and report
    // whatever that does, which reads as a tool bug rather than a caller one.
    expect(() => coerceInvokeRequest({ name: 't', args: [1, 2] })).toThrow(InvokeContractError);
    expect(() => coerceInvokeRequest({ name: 't', args: 'x' })).toThrow(InvokeContractError);
  });
});

describe('wantsNdjson', () => {
  it('reads the opt-in content type out of Accept', () => {
    expect(wantsNdjson('application/x-ndjson')).toBe(true);
    expect(wantsNdjson('application/x-ndjson, */*')).toBe(true);
    expect(wantsNdjson('Application/X-NDJSON')).toBe(true);
  });

  it('defaults to plain JSON for everything else', () => {
    expect(wantsNdjson('application/json')).toBe(false);
    expect(wantsNdjson('*/*')).toBe(false);
    expect(wantsNdjson(null)).toBe(false);
    expect(wantsNdjson(undefined)).toBe(false);
  });
});

describe('framing', () => {
  it('writes one line per frame, newline-terminated', () => {
    expect(statusLine('Launching browser')).toBe('{"status":"Launching browser"}\n');
    expect(resultLine({ success: true, data: { n: 1 } })).toBe('{"result":{"success":true,"data":{"n":1}}}\n');
  });

  /**
   * The framing has to survive the payload. A scraper stage that emits a
   * multi-line error would otherwise split into several malformed frames and
   * the caller would lose the result line behind them.
   */
  it('escapes newlines inside a status, so one emit is always one line', () => {
    const line = statusLine('stage 1\nstage 2\r\nstage 3');
    expect(line.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({ status: 'stage 1\nstage 2\r\nstage 3' });
  });

  it('bounds a single status frame', () => {
    const line = statusLine('x'.repeat(STATUS_FRAME_LIMIT * 4));
    expect(JSON.parse(line).status).toHaveLength(STATUS_FRAME_LIMIT);
  });

  it('drops an empty status rather than framing a blank line', () => {
    expect(statusLine('   ')).toBe('');
  });
});

describe('createNdjsonReader', () => {
  it('delivers statuses as they arrive, not at the end', () => {
    const onStatus = vi.fn();
    const reader = createNdjsonReader({ onStatus });
    reader.push('{"status":"one"}\n');
    expect(onStatus).toHaveBeenCalledWith('one');
    expect(onStatus).toHaveBeenCalledTimes(1);
    reader.push('{"status":"two"}\n{"result":{"success":true}}\n');
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(reader.end()).toEqual({ success: true });
  });

  it('reassembles a frame split across chunks', () => {
    const onStatus = vi.fn();
    const reader = createNdjsonReader({ onStatus });
    reader.push('{"sta');
    reader.push('tus":"hal');
    expect(onStatus).not.toHaveBeenCalled();
    reader.push('f a line"}\n{"result":{"success":true,"data":3}}\n');
    expect(onStatus).toHaveBeenCalledWith('half a line');
    expect(reader.end()).toEqual({ success: true, data: 3 });
  });

  it('accepts a final frame with no trailing newline', () => {
    const reader = createNdjsonReader({});
    reader.push('{"result":{"success":false,"error":"nope"}}');
    expect(reader.end()).toEqual({ success: false, error: 'nope' });
  });

  /**
   * A stream that ends without a result is a truncated response — the process
   * died, the connection dropped. It must not read as a successful call with no
   * data, which is what returning `{success:true}` on an empty stream would do.
   */
  it('throws when the stream ends with no result frame', () => {
    const reader = createNdjsonReader({});
    reader.push('{"status":"working"}\n');
    expect(() => reader.end()).toThrow(/no result/i);
  });

  it('ignores blank lines and unrecognised frames instead of failing the call', () => {
    const onStatus = vi.fn();
    const reader = createNdjsonReader({ onStatus });
    reader.push('\n{"noise":1}\n\n{"status":"ok"}\n{"result":{"success":true}}\n');
    expect(onStatus).toHaveBeenCalledExactlyOnceWith('ok');
    expect(reader.end()).toEqual({ success: true });
  });

  it('throws on a malformed frame rather than skipping past it', () => {
    const reader = createNdjsonReader({});
    expect(() => reader.push('{not json}\n')).toThrow(InvokeContractError);
  });
});
