import { describe, it, expect } from 'vitest';
import {
  classifyHermesStatusText,
  createHermesTextAccumulator,
  frameBelongsToTurn,
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

describe('classifyHermesStatusText — notices that were being persisted as answers', () => {
  it('recognises the redirect notice, not just the steer one', () => {
    // Both come from the same busy-ack in run.py; only ⏩ Steered was listed, so
    // under busy_input_mode: interrupt every superseding message's reply opened
    // with "↪ Redirected current run. I'll adjust using your correction."
    const hit = classifyHermesStatusText("↪ Redirected current run. I'll adjust using your correction.");
    expect(hit?.kind).toBe('notice');
  });

  it('recognises the /model ack the chat sends itself', () => {
    // The re-pin after a gateway restart replies with a settings dump. It was
    // drained by the next job and persisted as that turn's answer — a reply
    // nobody had asked a question to get.
    const hit = classifyHermesStatusText(
      'Model switched to `z-ai/glm-5.1`\nProvider: OpenRouter\nContext: 204,800 tokens',
    );
    expect(hit?.kind).toBe('notice');
    expect(hit?.text).toBe('Model switched to `z-ai/glm-5.1`');
  });

  it('leaves a real reply that merely mentions switching models alone', () => {
    expect(classifyHermesStatusText('You can switch models with /model — Model switched to what?')).toBeNull();
  });

  it('still passes ordinary replies through', () => {
    expect(classifyHermesStatusText('BRAVO')).toBeNull();
    expect(classifyHermesStatusText('✅ Corrected: the total is 42')).toBeNull();
  });
});

describe('frameBelongsToTurn', () => {
  it('accepts a frame stamped with this turn', () => {
    expect(frameBelongsToTurn({ metadata: { turn_id: 'job-a' } }, 'job-a')).toBe(true);
  });

  it("rejects a frame stamped with another turn", () => {
    // The production failure (2026-08-08): a superseded turn's reply was left
    // in the shared per-chat queue, the next job drained it, rendered it as its
    // own answer and took its `finalize` as its own completion — so every reply
    // after it landed one message behind and never resynchronised.
    expect(frameBelongsToTurn({ metadata: { turn_id: 'job-a' } }, 'job-b')).toBe(false);
  });

  it('accepts untagged frames', () => {
    // Gateway status bubbles and cron pushes are produced outside any inbound
    // turn. So is EVERY frame if the plugin hasn't been restarted since this
    // shipped — rejecting by default would turn a stale gateway into a chat
    // that silently streams nothing.
    expect(frameBelongsToTurn({ metadata: {} }, 'job-a')).toBe(true);
    expect(frameBelongsToTurn({ metadata: null }, 'job-a')).toBe(true);
    expect(frameBelongsToTurn({}, 'job-a')).toBe(true);
  });

  // --- strict mode -------------------------------------------------------
  // Untagged frames are accepted by default because a gateway that has not been
  // restarted stamps nothing, and rejecting by default would make a stale
  // gateway a silent total outage. Once the gateway REPORTS that it stamps at
  // execution (`turn_tagging: 'execution'` on /health), untagged frames are
  // foreign — and they have to be, because the model-pin notice is one: it was
  // being taken as a turn's answer and persisted against the wrong question.

  it('rejects untagged frames once the gateway reports execution-accurate stamps', () => {
    expect(frameBelongsToTurn({ metadata: {} }, 'job-a', { strict: true })).toBe(false);
    expect(frameBelongsToTurn({ metadata: null }, 'job-a', { strict: true })).toBe(false);
    expect(frameBelongsToTurn({}, 'job-a', { strict: true })).toBe(false);
  });

  it('still matches on the stamp in strict mode', () => {
    expect(frameBelongsToTurn({ metadata: { turn_id: 'job-a' } }, 'job-a', { strict: true })).toBe(true);
    expect(frameBelongsToTurn({ metadata: { turn_id: 'job-b' } }, 'job-a', { strict: true })).toBe(false);
  });

  it('treats a malformed stamp as absent, so strict mode drops it', () => {
    // A non-string tag is not evidence of ownership. Lenient mode keeps the
    // frame (better a stray bubble than a lost reply); strict mode does not.
    expect(frameBelongsToTurn({ metadata: { turn_id: 42 } }, 'job-a', { strict: true })).toBe(false);
    expect(frameBelongsToTurn({ metadata: { turn_id: '' } }, 'job-a', { strict: true })).toBe(false);
  });

  // --- inherited turns ---------------------------------------------------
  // A second message while the agent is answering does NOT start a second run.
  // Hermes either redirects the running one (busy_input_mode: interrupt) or
  // merges the text into it (queue) — both deliberate, and both mean two user
  // messages produce ONE run carrying the FIRST turn's stamp. The endpoint also
  // supersedes the earlier job, so without inheriting its id the newest job
  // rejects the very output that is answering it and shows only the gateway's
  // "↪ Redirected current run" notice.

  it('accepts frames from a turn this one superseded', () => {
    expect(
      frameBelongsToTurn({ metadata: { turn_id: 'job-a' } }, 'job-b', {
        strict: true,
        inherited: ['job-a'],
      }),
    ).toBe(true);
  });

  it('still rejects a turn it did not supersede', () => {
    // The model-pin notice, and any turn that completed on its own. Inheriting
    // is specifically about the run that was redirected INTO this message.
    expect(
      frameBelongsToTurn({ metadata: { turn_id: 'model-pin:chat_1' } }, 'job-b', {
        strict: true,
        inherited: ['job-a'],
      }),
    ).toBe(false);
  });

  it("ignores an inherited turn's ending until this turn has said something", () => {
    // Two inherited turns end very differently.
    //
    // The model re-pin is a DIFFERENT request: its run finishes before ours has
    // produced a word, so its terminator is not ours — taking it closed the job
    // at +611ms with an empty reply and pushed the answer onto the next turn.
    //
    // A turn we SUPERSEDED is the same run continuing: Hermes redirects it to
    // answer us, so it never gets a terminator of its own and the superseded
    // turn's is the only one there will be. By then we have streamed content.
    //
    // "Have we said anything yet" separates them without guessing.
    const inherited = ['other-turn'];
    const finalize = { kind: 'finalize', metadata: { turn_id: 'other-turn' } };

    expect(frameBelongsToTurn(finalize, 'job-b', { strict: true, inherited })).toBe(false);
    expect(
      frameBelongsToTurn(finalize, 'job-b', {
        strict: true,
        inherited,
        acceptInheritedEnd: true,
      }),
    ).toBe(true);
  });

  it("takes an inherited turn's output regardless", () => {
    // The job that ends on a foreign `finalize` is the whole "closes in
    // milliseconds" symptom: the model re-pin's turn finished, emitted its
    // terminator, and the user's job took it as its own completion — closing
    // before the answer had started, so the answer landed on the NEXT turn.
    const inherited = ['model-pin:chat_1'];
    expect(
      frameBelongsToTurn({ kind: 'send', metadata: { turn_id: 'model-pin:chat_1' } }, 'job-b', {
        strict: true,
        inherited,
      }),
    ).toBe(true);
    expect(
      frameBelongsToTurn({ kind: 'finalize', metadata: { turn_id: 'model-pin:chat_1' } }, 'job-b', {
        strict: true,
        inherited,
      }),
    ).toBe(false);
  });

  it('still ends on its own finalize', () => {
    expect(
      frameBelongsToTurn({ kind: 'finalize', metadata: { turn_id: 'job-b' } }, 'job-b', {
        strict: true,
        inherited: ['job-a'],
      }),
    ).toBe(true);
  });

  it('inherits nothing by default', () => {
    expect(frameBelongsToTurn({ metadata: { turn_id: 'job-a' } }, 'job-b')).toBe(false);
  });

  it('does not let inheritance resurrect an untagged frame in strict mode', () => {
    expect(
      frameBelongsToTurn({ metadata: {} }, 'job-b', { strict: true, inherited: ['job-a'] }),
    ).toBe(false);
  });

  it('ignores a non-string or empty tag rather than dropping the frame', () => {
    expect(frameBelongsToTurn({ metadata: { turn_id: 42 } }, 'job-a')).toBe(true);
    expect(frameBelongsToTurn({ metadata: { turn_id: '' } }, 'job-a')).toBe(true);
  });
});
