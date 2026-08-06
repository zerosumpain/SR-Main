<script lang="ts">
  // FrameStream — step a real frame sequence through two accumulators side by side and
  // watch the naive one destroy the answer.
  //
  // svelte5-pitfalls §1: the timer handle is a plain `let`, never $state — this component
  // both reads and writes it from play()/stop(), which is exactly the shape that loops
  // (effect_update_depth_exceeded) if it is made reactive.
  import { onMount } from 'svelte';
  import { FRAME_SCRIPT } from '../../../lib/chat';

  let n = $state(0);              // frames delivered so far
  let playing = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;  // NOT $state — see note above

  const delivered = $derived(FRAME_SCRIPT.slice(0, n));
  const current = $derived(n > 0 ? FRAME_SCRIPT[n - 1] : null);
  const atEnd = $derived(n >= FRAME_SCRIPT.length);

  /** The broken one: one flat string. A `send` appends; a `replace` throws it all away. */
  const naive = $derived.by(() => {
    let out = '';
    for (const f of delivered) out = f.op === 'send' ? out + f.text : f.text;
    return out;
  });

  /** The fix: text kept per segment in arrival order, so a replace can only ever rewrite
   *  the segment it names — and the progress filler is routed off the text channel. */
  const segmented = $derived.by(() => {
    const segs: Array<{ id: string; text: string; status: boolean }> = [];
    for (const f of delivered) {
      let s = segs.find((x) => x.id === f.seg);
      if (!s) { s = { id: f.seg, text: '', status: !!f.status }; segs.push(s); }
      s.text = f.op === 'send' ? s.text + f.text : f.text;
    }
    return segs;
  });

  const reply = $derived(segmented.filter((s) => !s.status).map((s) => s.text).join(' '));
  const statusLine = $derived(segmented.find((s) => s.status)?.text ?? null);

  function stepOn() { if (!atEnd) n += 1; else { n = 0; } }
  function play() {
    if (atEnd) n = 0;
    playing = true;
    clearInterval(timer);
    timer = setInterval(() => {
      if (n >= FRAME_SCRIPT.length) { stop(); return; }
      n += 1;
    }, 900);
  }
  function stop() { playing = false; clearInterval(timer); }
  function reset() { stop(); n = 0; }

  onMount(() => () => clearInterval(timer));
</script>

<div class="fs">
  <div class="fs-bar">
    <span class="k">Frame {n} of {FRAME_SCRIPT.length}</span>
    <div class="tp">
      <!-- One button, not two: swapping elements on play/pause throws keyboard focus to body. -->
      <button class:primary={!playing} onclick={() => (playing ? stop() : play())}>
        <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        {playing ? 'pause' : atEnd ? 'again' : 'play'}
      </button>
      <button onclick={stepOn}><span aria-hidden="true">▸❙</span> step</button>
      <button onclick={reset} disabled={n === 0} aria-label="Reset to the first frame">
        <span aria-hidden="true">⟲</span>
      </button>
    </div>
  </div>

  <!-- Stable live region: announcing requires the container to exist before the text changes. -->
  <div class="frame-live" aria-live="polite" aria-atomic="true">
    {#if current}
      <div class="frame" class:status={current.status}>
        <span class="f-seg">{current.seg}</span>
        <span class="f-op" data-op={current.op}>{current.op}</span>
        <code class="f-text">{current.text}</code>
        <span class="f-note">{current.note}</span>
      </div>
    {:else}
      <div class="frame idle"><span class="f-note">Press play. Seven frames; two are not the reply.</span></div>
    {/if}
  </div>

  <div class="panes">
    <div class="pane bad">
      <span class="p-lab">One flat string <em>— before</em></span>
      <div class="p-body" class:empty={!naive}>{naive || '…'}</div>
      {#if atEnd}
        <p class="p-verdict bad">The answer is gone, overwritten by a progress line — on screen <b>and in the database</b>.</p>
      {/if}
    </div>

    <div class="pane good">
      <span class="p-lab">Text per segment <em>— after</em></span>
      <div class="p-body" class:empty={!reply}>{reply || '…'}</div>
      {#if statusLine}
        <div class="p-status">routed off the text channel: <code>{statusLine}</code></div>
      {/if}
      {#if atEnd}
        <p class="p-verdict good">Intact. A replace can only rewrite the segment it names.</p>
      {/if}
    </div>
  </div>

  <p class="fs-foot">
    <b>Source-agnostic:</b> it holds for any future misbehaving frame, not just this one.
  </p>
</div>

<style>
  .fs { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .fs-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .k { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.11em; text-transform: uppercase; color: var(--accent-ink); }
  .tp { display: flex; gap: 5px; }
  .tp button { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-primary); background: rgba(255,255,255,0.65);
    border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round); padding: 6px 11px; cursor: pointer; }
  .tp button:hover:not(:disabled) { background: rgba(28,22,17,0.07); }
  .tp button.primary { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
  .tp button:disabled { opacity: 0.4; cursor: default; }

  .frame { display: grid; grid-template-columns: 44px 62px minmax(0, 1fr); gap: 4px 9px; align-items: baseline;
    border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.6); padding: 9px 12px; min-height: 54px; }
  .frame.status { background: rgba(196,87,10,0.07); border-color: rgba(196,87,10,0.3); }
  .frame.idle { grid-template-columns: minmax(0, 1fr); }
  .f-seg { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: var(--accent-ink); }
  .f-op { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-align: center; padding: 1px 0; border-radius: var(--radius-sharp); }
  .f-op[data-op='send'] { color: #2d7a3a; background: rgba(45,122,58,0.12); }
  .f-op[data-op='replace'] { color: #c44; background: rgba(196,68,68,0.12); }
  .f-text { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-primary); min-width: 0; overflow-wrap: anywhere; }
  .f-note { grid-column: 1 / 4; font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.62); }

  .panes { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin-top: 10px; }
  .pane { min-width: 0; border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); padding: 10px 13px; }
  .pane.bad { background: rgba(196,68,68,0.05); border-color: rgba(196,68,68,0.26); }
  .pane.good { background: rgba(45,122,58,0.05); border-color: rgba(45,122,58,0.28); }
  .p-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.6); }
  .p-lab em { font-style: normal; text-transform: none; letter-spacing: 0; color: rgba(28,22,17,0.42); }
  .p-body { margin-top: 6px; min-height: 48px; font-size: 13px; line-height: 1.5; color: var(--text-primary);
    background: rgba(255,255,255,0.7); border-radius: var(--radius-sharp); padding: 8px 10px; overflow-wrap: anywhere; }
  .p-body.empty { color: rgba(28,22,17,0.3); }
  .p-status { margin-top: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); overflow-wrap: anywhere; }
  .p-status code { font-size: 9px; background: rgba(28,22,17,0.06); padding: 1px 4px; border-radius: var(--radius-sharp); }
  .p-verdict { margin: 7px 0 0; font-size: 12px; line-height: 1.5; }
  .p-verdict.bad { color: #a33; }
  .p-verdict.good { color: #2d7a3a; }
  .p-verdict b { font-weight: 700; }

  .fs-foot { margin: 11px 0 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 92ch; }
  .fs-foot b { color: rgba(28,22,17,0.82); }
</style>
