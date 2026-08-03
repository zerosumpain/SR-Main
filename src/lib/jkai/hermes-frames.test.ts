import { describe, it, expect } from 'vitest';
import {
  classifyHermesStatusText,
  createHermesTextAccumulator,
  HERMES_HOME_CHANNEL_NOTICE_PREFIX,
  type HermesTextFrame,
} from './hermes-frames';

function send(message_id: string, content: string): HermesTextFrame {
  return { kind: 'send', message_id, content };
}
function replace(message_id: string, content: string): HermesTextFrame {
  return { kind: 'replace', message_id, content };
}

describe('classifyHermesStatusText', () => {
  it('catches the current long-running notifier format and drops the counter', () => {
    const s = classifyHermesStatusText('⏳ Working — 12 min — iteration 5/90, mcp_jkai_jkai_extended');
    expect(s?.kind).toBe('progress');
    expect(s?.text).toBe('⏳ Working — 12 min — mcp_jkai_jkai_extended');
    expect(s?.elapsedMin).toBe(12);
    expect(s?.detail).toBe('mcp_jkai_jkai_extended');
  });

  it('catches the legacy notifier format too — production holds both', () => {
    const s = classifyHermesStatusText('⏳ Still working... (12 min elapsed — iteration 5/90…)');
    expect(s?.kind).toBe('progress');
    expect(s?.text).not.toContain('iteration');
    expect(s?.elapsedMin).toBe(12);
  });

  it('drops the counter from the busy-ack but keeps the useful sentence', () => {
    const s = classifyHermesStatusText(
      "⚡ Interrupting current task (12 min elapsed, iteration 1/90, running: mcp_jkai_jkai_extended). I'll respond to your message shortly.",
    );
    expect(s?.kind).toBe('notice');
    expect(s?.text).toBe(
      "⚡ Interrupting current task (12 min elapsed, running: mcp_jkai_jkai_extended). I'll respond to your message shortly.",
    );
    expect(s?.detail).toBe('mcp_jkai_jkai_extended');
  });

  it('tidies the brackets when the counter was the only detail', () => {
    const s = classifyHermesStatusText("⏳ Queued for the next turn (iteration 1/90). I'll respond once the current task finishes.");
    expect(s?.kind).toBe('notice');
    expect(s?.text).toBe("⏳ Queued for the next turn. I'll respond once the current task finishes.");
  });

  it('catches the queued-behind-a-subagent and inactivity lines', () => {
    expect(classifyHermesStatusText('⏳ Subagent working — your message is queued for when it finishes.')?.kind).toBe('notice');
    expect(classifyHermesStatusText('⏱️ Agent inactive for 30 min — no tool calls or API responses.')?.kind).toBe('notice');
  });

  it('catches the gateway restart/reload guards whatever the gerund', () => {
    expect(
      classifyHermesStatusText('⏳ Gateway restarting — queued for the next turn after it comes back.')?.kind,
    ).toBe('notice');
    expect(
      classifyHermesStatusText('⏳ Gateway is reloading and is not accepting another turn right now.')?.kind,
    ).toBe('notice');
    expect(classifyHermesStatusText("⏳ Agent is running — `/model` can't run mid-turn.")?.kind).toBe('notice');
  });

  it('catches the provider rate-limit notice in either glyph form', () => {
    const withSelector = classifyHermesStatusText(
      '⏱️ The model provider is rate-limiting requests. Please wait a moment and try again.',
    );
    expect(withSelector?.kind).toBe('notice');
    expect(
      classifyHermesStatusText('⏱ The model provider is rate-limiting requests. Please wait a moment and try again.')
        ?.kind,
    ).toBe('notice');
  });

  it('leaves ordinary replies that open with a glyph alone', () => {
    expect(classifyHermesStatusText('✅ Corrected: the figure is £4.2m, not £42m.')).toBeNull();
    expect(classifyHermesStatusText('🥇 WINNER: the second option.')).toBeNull();
    expect(classifyHermesStatusText('⏳ is the hourglass emoji, in case you wondered.')).toBeNull();
    expect(classifyHermesStatusText('Working — 12 min — iteration 5/90')).toBeNull();
  });
});

describe('createHermesTextAccumulator', () => {
  it('concatenates segments in arrival order', () => {
    const acc = createHermesTextAccumulator();
    expect(acc.accept(send('a', 'Hello '))).toEqual({ kind: 'append', delta: 'Hello ', text: 'Hello ' });
    expect(acc.accept(send('a', 'there'))).toEqual({ kind: 'append', delta: 'there', text: 'Hello there' });
    expect(acc.accept(send('b', '. And more'))).toEqual({
      kind: 'append',
      delta: '. And more',
      text: 'Hello there. And more',
    });
    expect(acc.text).toBe('Hello there. And more');
  });

  it('confines a replace to the segment it names — the bubble wipe', () => {
    const acc = createHermesTextAccumulator();
    acc.accept(send('prose', 'The answer is 42. '));
    // The tool-progress log gets its own message id, then re-edits itself when
    // the `(×N)` repeat counter changes — a non-monotonic edit, so the platform
    // adapter downgrades it to a `replace`.
    acc.accept(send('toollog', '⚙️ mcp_jkai_jkai_extended: "workflow_inspect"'));
    const out = acc.accept(replace('toollog', '⚙️ mcp_jkai_jkai_extended: "workflow_inspect" (×2)'));
    expect(out).toEqual({
      kind: 'rewrite',
      text: 'The answer is 42. ⚙️ mcp_jkai_jkai_extended: "workflow_inspect" (×2)',
    });
    // The prose is still there — under the old flat accumulator it was gone.
    expect(acc.text).toContain('The answer is 42.');
  });

  it('does not let an interleaved id disturb an earlier one', () => {
    const acc = createHermesTextAccumulator();
    acc.accept(send('A', 'one'));
    acc.accept(send('B', 'two'));
    acc.accept(send('A', '-more'));
    expect(acc.text).toBe('one-moretwo');
    // Growing an earlier segment moves rendered text, so consumers need the
    // whole body rather than a delta.
    expect(acc.accept(send('A', '!'))).toEqual({ kind: 'rewrite', text: 'one-more!two' });
    expect(acc.accept(replace('B', 'TWO'))).toEqual({ kind: 'rewrite', text: 'one-more!TWO' });
  });

  it('survives a flood-control retry — a genuine non-monotonic edit on the prose id', () => {
    const acc = createHermesTextAccumulator();
    acc.accept(send('prose', 'Virgin Money charge £12 a month'));
    // Hermes re-sends the whole segment after a rate-limit retry, corrected.
    const out = acc.accept(replace('prose', 'Virgin Money charge £14 a month'));
    expect(out).toEqual({ kind: 'rewrite', text: 'Virgin Money charge £14 a month' });
    expect(acc.text).toBe('Virgin Money charge £14 a month');
  });

  it('routes the elapsed-time filler off the text channel entirely', () => {
    const acc = createHermesTextAccumulator();
    acc.accept(send('prose', 'Looking into it. '));
    const first = acc.accept(send('hb', '⏳ Working — 3 min — iteration 1/90, mcp_jkai_jkai_extended'));
    const second = acc.accept(replace('hb', '⏳ Working — 6 min — iteration 1/90, mcp_jkai_jkai_extended'));
    expect(first.kind).toBe('status');
    expect(second.kind).toBe('status');
    expect(acc.text).toBe('Looking into it. ');
  });

  it('keeps a status id status even when a later delta reads as prose', () => {
    const acc = createHermesTextAccumulator();
    acc.accept(send('prose', 'The answer is 42.'));
    // The adapter emits a monotonic edit as a `send` carrying only the DELTA,
    // and the delta on its own starts with no status prefix at all.
    expect(acc.accept(send('hb', '⏳ Working — 3 min')).kind).toBe('status');
    expect(acc.accept(send('hb', ' — iteration 2/90, gmail_search')).kind).toBe('ignore');
    expect(acc.text).toBe('The answer is 42.');
    expect(acc.text).not.toContain('gmail_search');
  });

  it('does not let an unkeyed status frame condemn the unkeyed prose segment', () => {
    const acc = createHermesTextAccumulator();
    expect(acc.accept(send('', '⏳ Working — 3 min')).kind).toBe('status');
    expect(acc.accept(send('', 'Real answer.'))).toEqual({
      kind: 'append',
      delta: 'Real answer.',
      text: 'Real answer.',
    });
  });

  it('ignores the home-channel onboarding notice', () => {
    const acc = createHermesTextAccumulator();
    expect(acc.accept(send('n', `${HERMES_HOME_CHANNEL_NOTICE_PREFIX} — set one in settings.`))).toEqual({
      kind: 'ignore',
    });
    expect(acc.text).toBe('');
  });

  it('ignores non-text frames and empty sends', () => {
    const acc = createHermesTextAccumulator();
    expect(acc.accept({ kind: 'finalize', message_id: 'f', content: '' })).toEqual({ kind: 'ignore' });
    expect(acc.accept(send('a', ''))).toEqual({ kind: 'ignore' });
    expect(acc.text).toBe('');
  });
});
