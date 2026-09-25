<script lang="ts">
  // A canvas that is being built from a description (Describe it, on the
  // list or the iPhone). The graph lands in one write when the generator
  // finishes; the /live stream's `build_complete` reloads the page, and this
  // polls the build state as a backstop for a tab that opened late or lost
  // its stream. A failed build says why, and points at the prompt bar. A build
  // that stopped on a question asks it here; answering (or skipping) restarts
  // it through POST /api/canvas/:slug/build-answer — the phone's /answer too.
  import { untrack } from 'svelte';

  type Props = {
    slug: string;
    building: boolean;
    buildError: string | null;
    /** jkai's question when the build is waiting on the owner. */
    question?: string | null;
    /** The build settled (either way) — reload the canvas. */
    onSettled: () => void;
  };
  let { slug, building, buildError, question = null, onSettled }: Props = $props();

  let answer = $state('');
  let sending = $state(false);
  let answerError = $state<string | null>(null);

  async function send(skip: boolean, e?: Event) {
    e?.preventDefault();
    const text = answer.trim();
    if (sending || (!skip && !text)) return;
    sending = true;
    answerError = null;
    try {
      const res = await fetch(`/api/canvas/${encodeURIComponent(slug)}/build-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skip ? { skip: true } : { answer: text }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) onSettled(); // answered elsewhere (the phone) — show what it is now
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      answer = '';
      onSettled();
    } catch (err) {
      answerError = err instanceof Error ? err.message : String(err);
    } finally {
      sending = false;
    }
  }

  const POLL_MS = 4000;
  let elapsed = $state(0);

  $effect(() => {
    // Tracked: only whether a build is in flight, and for which canvas.
    const active = building;
    const s = slug;
    if (!active) return;
    // Internal handles — never read by the template (svelte5-pitfalls §1).
    let stopped = false;
    const started = Date.now();
    const tick = setInterval(() => (elapsed = Math.round((Date.now() - started) / 1000)), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/canvas/${encodeURIComponent(s)}/build-state`);
        if (!res.ok || stopped) return;
        const state = (await res.json()) as { building?: boolean };
        if (state.building === false && !stopped) {
          stopped = true;
          untrack(() => onSettled());
        }
      } catch {
        /* offline — the next tick tries again */
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  });
</script>

{#if building}
  <section class="bstate bstate--building" aria-live="polite">
    <span class="bstate-dot" aria-hidden="true"></span>
    <span class="bstate-hd">Building from your description</span>
    <span class="bstate-text">jkai is choosing the steps and checking them — they land here together when it is done.</span>
    <span class="bstate-time">{elapsed}s</span>
  </section>
{:else if question}
  <form class="bstate bstate--question" aria-label="jkai has a question" onsubmit={(e) => send(false, e)}>
    <span class="bstate-hd">jkai has a question before it can build this</span>
    <label class="bstate-q" for="build-answer">{question}</label>
    <textarea
      id="build-answer"
      class="bstate-input"
      rows="2"
      placeholder="Your answer"
      bind:value={answer}
      disabled={sending}
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(false, e);
      }}
    ></textarea>
    {#if answerError}<span class="bstate-text bstate-err" role="alert">{answerError}</span>{/if}
    <span class="bstate-actions">
      <button type="submit" class="bstate-btn" disabled={sending || !answer.trim()}>{sending ? 'Sending…' : 'Answer'}</button>
      <button type="button" class="bstate-skip" disabled={sending} onclick={() => send(true)}>Skip — use your best guess</button>
    </span>
  </form>
{:else if buildError}
  <section class="bstate bstate--failed" role="alert">
    <span class="bstate-hd">{buildError.startsWith('built, but') ? 'Built — did not pass its test run' : 'Build did not finish'}</span>
    <span class="bstate-text">{buildError}</span>
    <span class="bstate-text bstate-muted">Say what to change in the prompt bar below, or add steps by hand.</span>
  </section>
{/if}

<style>
  .bstate {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 14px;
    border-bottom: 1px solid var(--line-hair);
    flex-shrink: 0;
  }
  .bstate--building {
    background: var(--accent-tint-08);
  }
  .bstate--question {
    display: grid;
    gap: 8px;
    background: var(--accent-tint-08);
    border-left: 3px solid var(--accent);
    padding: 10px 14px;
  }
  .bstate-q {
    font-size: var(--fs-body, 1rem);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .bstate-input {
    width: 100%;
    max-width: 44rem;
    resize: vertical;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-primary);
    background: var(--bg);
    border: 1.5px solid var(--text-primary);
    padding: 8px 10px;
    outline: none;
  }
  .bstate-input:focus {
    border-color: var(--accent);
  }
  .bstate-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .bstate-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 14px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    cursor: pointer;
  }
  .bstate-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .bstate-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .bstate-skip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .bstate-skip:hover:not(:disabled) {
    text-decoration: underline;
  }
  .bstate-text.bstate-err {
    color: var(--error);
  }
  .bstate--failed {
    background: var(--error-bg);
    border-left: 3px solid var(--error);
  }
  .bstate-dot {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    background: var(--accent);
    align-self: center;
    animation: bstate-pulse 1.2s ease-in-out infinite;
  }
  .bstate-hd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-primary);
  }
  .bstate--failed .bstate-hd {
    color: var(--error);
  }
  .bstate-text {
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .bstate-muted {
    color: var(--text-muted);
  }
  .bstate-time {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  @keyframes bstate-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @media (prefers-reduced-motion: reduce) {
    .bstate-dot { animation: none; }
  }
</style>
