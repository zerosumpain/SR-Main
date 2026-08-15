#!/usr/bin/env tsx
/**
 * verify-turn-pairing.ts — does a jkai chat reply answer the message it was sent for?
 *
 * NOT a CI gate. It drives a live Hermes and a live dev server and sends real
 * messages. It exists because "answers one message behind" has now been
 * misdiagnosed twice from reading code, and each time the reasoning was
 * plausible and wrong:
 *
 *   - The first attempt tagged frames with "the turn currently running on this
 *     chat", set on ARRIVAL. Arrival is not execution: a message landing mid-turn
 *     took the running turn's stamp, so the tag named the newest message rather
 *     than the producing turn and separated nothing.
 *   - The written-up diagnosis blamed only the consumer racing for a shared
 *     queue. It missed that a turn's `finalize` was bound to whatever task was
 *     running when it ARRIVED — for a message landing mid-turn, the PREVIOUS
 *     turn's — so the job ended before its answer began.
 *
 * Both were found by looking at frames and rows, not by thinking harder. Hence
 * this script.
 *
 * Run:  npx vite dev --port 5189            (leave running)
 *       BASE='http://[::1]:5189' node --env-file=.env --import tsx \
 *         scripts/verify-turn-pairing.ts [section...]
 *
 * Sections: boundary · first-turn · overlap   (default: all)
 *
 * NOTE on BASE: use the IPv6 loopback. A dual-stack Vite listener reports an
 * IPv4 client as `::ffff:127.0.0.1`, which is not in the AUTH_BYPASS allow-list
 * in hooks.server.ts, so `http://127.0.0.1` gets a 401 while `[::1]` does not.
 *
 * `boundary` needs the bridge secret and talks to Hermes directly, on a chat id
 * of its own — `drain_outbound` POPS the per-chat queue, so a second subscriber
 * on a live chat would eat the UI's frames.
 */
import { mintBridgeToken } from '../src/lib/mcp/auth';

const BASE = process.env.BASE ?? 'http://[::1]:5189';
const HERMES = process.env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const SECRET = process.env.HERMES_BRIDGE_SECRET ?? '';

const wanted = process.argv.slice(2);
const runs = (name: string) => wanted.length === 0 || wanted.includes(name);

const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(6)}ms`;
const log = (...a: unknown[]) => console.log(...a);
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const SLOW = 'Count from 1 to 200, one number per line, nothing else. Do not stop early.';
const QUICK = 'Reply with exactly the word BRAVO and nothing else.';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

/** Parse an SSE body into `data:` payloads. */
async function* sse(resp: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(5).trim());
      } catch {
        /* skip malformed */
      }
    }
  }
}

interface JobOutcome {
  events: string[];
  /** Text of every `status` event, so a leaked gateway notice can be asserted on. */
  statuses: string[];
  text: string;
  finalMessage: string | null;
  closedAt: number | null;
}

/** Consume one job's SSE stream to completion. */
async function watchJob(label: string, jobId: string, quiet = false): Promise<JobOutcome> {
  const out: JobOutcome = { events: [], statuses: [], text: '', finalMessage: null, closedAt: null };
  const resp = await fetch(`${BASE}/api/workflows/orchestrator/chat/stream?jobId=${jobId}`);
  if (!resp.ok || !resp.body) return out;
  for await (const d of sse(resp)) {
    const type = String(d.type);
    if (type === 'token') {
      out.text += String(d.delta ?? '');
      continue;
    }
    if (type === 'heartbeat' || type === 'thinking') continue;
    out.events.push(type);
    if (type === 'status' && typeof d.text === 'string') out.statuses.push(d.text);
    if (!quiet) log(`${at()}  [${label}] ${type.padEnd(15)} ${JSON.stringify(d).slice(0, 100)}`);
    if (type === 'done') {
      out.finalMessage = String((d.result as Record<string, unknown>)?.message ?? out.text);
      out.closedAt = Date.now() - t0;
      return out;
    }
    if (type === 'error') {
      out.closedAt = Date.now() - t0;
      return out;
    }
  }
  return out;
}

const newConversation = () =>
  j<{ id: string }>(`${BASE}/api/jkai/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'web' }),
  });

const post = (conversationId: string, message: string) =>
  j<{ jobId: string }>(`${BASE}/api/workflows/orchestrator/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId }),
  });

const rows = (conversationId: string) =>
  j<{ messages: Array<{ role: string; content: string }> }>(
    `${BASE}/api/jkai/conversations/${conversationId}`,
  );

function printRows(msgs: Array<{ role: string; content: string }>) {
  log('  ---- persisted ----');
  for (const m of msgs) {
    log(`  ${m.role.padEnd(9)} ${JSON.stringify(m.content.replace(/\s+/g, ' ').slice(0, 84))}`);
  }
}

// ------------------------------------------------------------------ boundary --
// What the gateway itself emits, and under whose name. Isolates Hermes from the
// endpoint: if the stamps are wrong here, no consumer-side change can fix them.
if (runs('boundary')) {
  log('\n=== boundary: what Hermes stamps on its own frames ===');
  if (!SECRET) {
    check('HERMES_BRIDGE_SECRET available', false, 'run with --env-file=.env');
  } else {
    const chatId = `verify-turn-pairing-${Date.now()}`;
    const token = () =>
      mintBridgeToken(
        { sessionId: chatId, kind: 'manual', kindId: chatId, expiresAt: Date.now() + 3_600_000 },
        SECRET,
      );
    const send = async (text: string, turnId: string) => {
      const r = await fetch(`${HERMES}/platforms/jkai/msg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bridge-Token': token() },
        body: JSON.stringify({
          chat_id: chatId, text, kind: 'manual', kind_id: chatId, session_id: chatId,
          turn_id: turnId, origin: 'homeserv',
          mcp_url: 'http://127.0.0.1:5173/api/mcp/local',
        }),
      });
      if (!r.ok) throw new Error(`inbound ${r.status}`);
    };

    const health = await fetch(`${HERMES}/platforms/jkai/health`).then((r) => r.json());
    check('the gateway advertises execution-accurate stamps',
      health.turn_tagging === 'execution',
      `turn_tagging=${JSON.stringify(health.turn_tagging)} — restart jkai-hermes if absent`);

    const seen: Array<{ kind: string; turn: string; off: number }> = [];
    const abort = new AbortController();
    const reader = (async () => {
      const resp = await fetch(
        `${HERMES}/platforms/jkai/out?chat_id=${encodeURIComponent(chatId)}`,
        { headers: { 'Bridge-Token': token() }, signal: abort.signal },
      );
      for await (const f of sse(resp)) {
        const meta = (f.metadata ?? {}) as Record<string, unknown>;
        seen.push({
          kind: String(f.kind),
          turn: typeof meta.turn_id === 'string' ? meta.turn_id : '—',
          off: Date.now() - t0,
        });
      }
    })().catch(() => {});

    await new Promise((r) => setTimeout(r, 500));
    await send(SLOW, 'turn-A');
    // Land the second message while the first is still generating. A gap that
    // lets the first FINISH proves nothing — the first run of this probe used 6s
    // against a 3.3s answer and reported all clear.
    await new Promise((r) => setTimeout(r, 2500));
    await send(QUICK, 'turn-B');
    await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS ?? 60_000)));
    abort.abort();
    await reader;

    const aFrames = seen.filter((f) => f.turn === 'turn-A');
    const bFrames = seen.filter((f) => f.turn === 'turn-B');
    log(`  frames: ${seen.length}  turn-A: ${aFrames.length}  turn-B: ${bFrames.length}`);
    check("the running turn keeps its own name when a message lands mid-flight",
      aFrames.length > 0,
      'zero frames under turn-A means the arriving turn claimed the running one\'s output');
    check('nothing is emitted unattributed',
      seen.filter((f) => f.turn === '—').length === 0,
      `${seen.filter((f) => f.turn === '—').length} untagged frames`);
  }
}

// ---------------------------------------------------------------- first-turn --
// The first message of a fresh conversation, which races the silent model re-pin.
// The likeliest real route into the bug: this answer went missing entirely and
// surfaced against the NEXT question.
if (runs('first-turn')) {
  log('\n=== first-turn: a fresh conversation races the model re-pin ===');
  const conv = await newConversation();
  const job = await post(conv.id, 'Say READY and nothing else.');
  const outcome = await watchJob('first', job.jobId, true);
  log(`  closed at +${outcome.closedAt}ms with ${JSON.stringify(outcome.finalMessage)}`);
  await new Promise((r) => setTimeout(r, 3000));
  const saved = await rows(conv.id);
  printRows(saved.messages);

  const answers = saved.messages.filter((m) => m.role === 'assistant');
  check('the first message gets an answer at all', answers.length >= 1,
    'it used to close in ~600ms on the re-pin\'s terminator, with the answer landing on the next turn');
  // The re-pin is a turn of its own and used to be sent immediately before this
  // message, so the two raced: under `interrupt` the answer came out under the
  // re-pin's id with its notice attached, and under `queue` the gateway dropped
  // the user's message entirely. The message is now held until the re-pin's own
  // terminator arrives, so a turn that took a re-pin should look no different
  // from one that did not.
  check('the re-pin leaks nothing into this turn',
    !outcome.statuses.some((t) =>
      /Model switched to|Redirected current run|Interrupting current task/.test(t)),
    `statuses seen: ${JSON.stringify(outcome.statuses)}`);
  check('and it is the answer to what was asked',
    answers.some((a) => /READY/i.test(a.content)),
    JSON.stringify(answers.map((a) => a.content.slice(0, 50))));
  check('the /model ack is not persisted as a reply',
    !answers.some((a) => /^Model switched to/i.test(a.content.trim())));
}

// ------------------------------------------------------------------- overlap --
// A second message sent while the first is still answering.
if (runs('overlap')) {
  log('\n=== overlap: a second message mid-answer ===');
  const conv = await newConversation();
  // Settle the re-pin first, so this section tests turn-vs-turn and not the
  // re-pin race that `first-turn` already covers.
  const warm = await post(conv.id, 'Say READY and nothing else.');
  await watchJob('warm', warm.jobId, true);
  await new Promise((r) => setTimeout(r, 2500));

  const jobA = await post(conv.id, SLOW);
  const watchA = watchJob('A', jobA.jobId);
  await new Promise((r) => setTimeout(r, 5000));
  const jobB = await post(conv.id, QUICK);
  const watchB = watchJob('B', jobB.jobId);
  const [a, b] = await Promise.all([watchA, watchB]);

  await new Promise((r) => setTimeout(r, 3000));
  const saved = await rows(conv.id);
  printRows(saved.messages);

  const health = await fetch(`${HERMES}/platforms/jkai/health`).then((r) => r.json()).catch(() => ({}));
  const queues = health.busy_input_mode === 'queue';
  log(`  gateway busy_input_mode = ${JSON.stringify(health.busy_input_mode)}`);

  check("the first turn's stream carries only its own output",
    !/READY/.test(a.text),
    `A streamed ${JSON.stringify(a.text.slice(0, 40))} — a leading READY is the previous turn's answer`);
  check('the second message is answered', b.finalMessage !== null && /BRAVO/.test(b.finalMessage),
    JSON.stringify(b.finalMessage?.slice(0, 60)));
  check("the second turn's answer is not the first turn's",
    b.finalMessage !== null && !/\b\d+\n\d+\n\d+/.test(b.finalMessage),
    `a run of numbers in the BRAVO reply is the first turn's count: ${JSON.stringify(b.finalMessage?.slice(0, 50))}`);
  check("the gateway's redirect notice is not part of the answer",
    b.finalMessage !== null && !/Redirected current run/.test(b.finalMessage));
  check('the second turn actually closes', b.closedAt !== null);

  if (queues) {
    // Queueing means the turn ahead runs to completion, so it must NOT be
    // superseded — cancelling it there threw away an answer that was still
    // coming, and its frames were then drained by the next job and rendered as
    // the reply to a question they did not answer.
    check('the first turn is allowed to finish rather than being superseded',
      !a.events.includes('error'),
      `A's events: ${a.events.join(',')}`);
    check('the first turn keeps a complete answer of its own',
      a.finalMessage !== null && /\b1\b/.test(a.finalMessage) && /\b40\b|\b100\b|\b200\b/.test(a.finalMessage),
      JSON.stringify(a.finalMessage?.slice(-40)));
    check('the second turn is told it is waiting rather than left silent',
      b.events.includes('status'), `B's events: ${b.events.join(',')}`);
  }

  const answers = saved.messages.filter((m) => m.role === 'assistant');
  check('every message got exactly one answer', answers.length === 3,
    `${answers.length} assistant rows: ${JSON.stringify(answers.map((m) => m.content.slice(0, 24)))}`);
  check('no row answers a question it was not asked',
    !answers.some((m) => /READY/.test(m.content) && /\d+\n\d+/.test(m.content)),
    JSON.stringify(answers.map((m) => m.content.slice(0, 40))));
}

log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join('; ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
