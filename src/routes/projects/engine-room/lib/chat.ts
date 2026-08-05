// chat.ts — content for the Conversation section.
//
// The frame script below is a faithful reconstruction of the failure the segment-scoped
// accumulator exists to prevent: the runtime opens a fresh message id at every tool
// boundary, and interleaves its own progress bubbles on the SAME text channel, re-editing
// them in place against their own id. A flat accumulator treats a non-prefix edit as
// "replace everything", so the filler overwrites the answer — on screen and in the database.

export interface Frame {
  /** Which message id this frame belongs to. */
  seg: string;
  /** send = append to this segment; replace = rewrite this segment. */
  op: 'send' | 'replace';
  text: string;
  /** Is this a gateway status bubble rather than part of the reply? */
  status?: boolean;
  note: string;
}

export const FRAME_SCRIPT: Frame[] = [
  { seg: 'm1', op: 'send', text: 'Looking at your inbox now', note: 'The reply starts. Segment m1 opens.' },
  { seg: 'm1', op: 'send', text: ' — three threads need a response.', note: 'Same segment, appended.' },
  { seg: 's1', op: 'send', text: '⏳ Working — 2 min', status: true, note: 'A progress bubble opens its OWN segment. It is not the reply.' },
  { seg: 'm2', op: 'send', text: 'The first is from your accountant', note: 'A tool boundary was crossed, so the runtime opened a new segment for the reply.' },
  { seg: 's1', op: 'replace', text: '⏳ Working — 5 min, iteration 19/90', status: true, note: 'The progress bubble re-edits itself. Not a prefix of its predecessor, so this arrives as a REPLACE.' },
  { seg: 'm2', op: 'send', text: ' and needs an answer today.', note: 'The reply continues in m2, unaware any of that happened.' },
  { seg: 'm3', op: 'send', text: 'I have drafted replies to all three.', note: 'Another tool boundary, another segment. One answer, three message ids.' },
];

export const WATCHDOG = [
  { tier: 'Waiting on you', idle: '24 h', hard: '48 h', why: 'An approval card is open. There is nothing wrong; a person simply has not answered yet, and might be asleep.' },
  { tier: 'Delegating', idle: '30 min', hard: '45 min', why: 'A sub-agent is grinding through its own loop and emits nothing on the parent stream. Silence here is normal.' },
  { tier: 'Running a tool', idle: '20 min', hard: '29 min', why: 'A long scrape or a build can be legitimately quiet. Sized deliberately just UNDER the runtime’s own limit, so the two never both give up on the same turn.' },
  { tier: 'Ordinary turn', idle: '4 min', hard: '10 min', why: 'Nothing is running. Four minutes of silence means something is actually wrong.' },
];

export const STREAM_CONSTANTS = [
  { k: 'Heartbeat', v: '5 s', why: 'Proof of life on an otherwise silent stream.' },
  { k: 'Watchdog tick', v: '15 s', why: 'How often the server checks whether a turn has gone quiet.' },
  { k: 'Keepalive comment', v: '30 s', why: 'Stops intermediaries closing an idle connection.' },
  { k: 'Client gap limit', v: '12 s', why: 'How long the browser tolerates hearing nothing before reconnecting.' },
  { k: 'Reconnect attempts', v: '5', why: 'Then it stops and says so, rather than hammering forever.' },
  { k: 'Idle body timeout', v: 'disabled', why: 'The transport default of five minutes was silently killing delegated work.' },
];
