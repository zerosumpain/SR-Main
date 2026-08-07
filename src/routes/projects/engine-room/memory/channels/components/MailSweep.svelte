<script lang="ts">
  // MailSweep — the free half and the paid half, drawn to the same scale.
  //
  // The claim this instrument has to land is counter-intuitive: on this channel the CHEAPER
  // half is also the MORE trustworthy half, so it is never the thing that gets cut. Move the
  // budget to zero and the correspondence map still lands in full; the graph loses what the
  // mail was about, not who was talking to whom.
  //
  // The thread count is a worked figure, not a measurement of anyone's mailbox — the point of
  // the instrument is the ratio and the number of nights, both of which the reader sets.
  import { SWEEP, HALVES } from '../../../lib/channels';

  /** A worked mailbox, sized so the budget lands mid-scale. Stated as such on the page. */
  const THREADS = 900;

  // Typed, not inferred: SWEEP is `as const`, so the initialiser's type is the literal 150
  // and every comparison against another number reads as unintentional.
  let budget = $state<number>(SWEEP.extractBudget);
  let night = $state(1);

  const read = $derived(Math.min(THREADS, budget * night));
  const waiting = $derived(THREADS - read);
  const nightsNeeded = $derived(budget > 0 ? Math.ceil(THREADS / budget) : Infinity);
  const pct = (n: number) => (THREADS > 0 ? (n / THREADS) * 100 : 0);
</script>

<div class="ms">
  <div class="ctl">
    <label class="f">
      <span class="f-lab">Body extractions per night</span>
      <input type="range" min="0" max="300" step="10" bind:value={budget} />
      <output class="f-out">{budget}</output>
    </label>
    <label class="f">
      <span class="f-lab">Nights run</span>
      <input type="range" min="1" max="8" step="1" bind:value={night} />
      <output class="f-out">{night}</output>
    </label>
  </div>

  <div class="tracks">
    {#each HALVES as h (h.id)}
      <div class="tr">
        <div class="t-head">
          <b>{h.label}</b>
          <span class="t-cost" class:free={h.cost === 'free'}>{h.cost}</span>
          <span class="t-conf">{h.confidence}</span>
        </div>
        <div class="t-track" role="img"
             aria-label={h.id === 'structural'
               ? `All ${THREADS} threads get their correspondence map, whatever the budget.`
               : `${read} of ${THREADS} threads have had their bodies read after ${night} night${night === 1 ? '' : 's'}.`}>
          {#if h.id === 'structural'}
            <span class="t-fill full" style="width:100%"></span>
            <span class="t-val">{THREADS.toLocaleString('en-GB')} of {THREADS.toLocaleString('en-GB')}</span>
          {:else}
            <span class="t-fill paid" style="width:{pct(read)}%"></span>
            <span class="t-val">{read.toLocaleString('en-GB')} of {THREADS.toLocaleString('en-GB')}</span>
          {/if}
        </div>
        <p class="t-what">{h.what}</p>
      </div>
    {/each}
  </div>

  <p class="verdict" aria-live="polite">
    {#if budget === 0}
      <b>Nothing is paid for.</b> Every thread still becomes people and correspondence edges — the graph
      knows who talks to whom and nothing about what was said.
    {:else if waiting === 0}
      <b>The window is fully read</b> after {night} night{night === 1 ? '' : 's'} at {budget} a night. From here
      a thread only costs again when a new message actually lands in it.
    {:else}
      <b>{waiting.toLocaleString('en-GB')} threads still waiting</b>, newest first — {nightsNeeded} nights at this
      budget. All {THREADS.toLocaleString('en-GB')} already have their correspondence map.
    {/if}
  </p>

  <ul class="bounds">
    <li><b>{SWEEP.windowDays}</b> days of mail in the window</li>
    <li><b>{SWEEP.maxThreads.toLocaleString('en-GB')}</b> threads one run may list</li>
    <li><b>{SWEEP.maxMessages}</b> messages per thread kept</li>
    <li><b>{SWEEP.maxParticipants}</b> participants before it is a broadcast, not a conversation</li>
  </ul>
</div>

<style>
  .ms { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

  .ctl { display: flex; gap: 10px 22px; flex-wrap: wrap; }
  .f { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .f-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); white-space: nowrap; }
  .f input { accent-color: var(--accent); width: 132px; }
  .f-out { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600;
    color: var(--text-primary); min-width: 3ch; }

  .tracks { display: flex; flex-direction: column; gap: 11px; }
  .t-head { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; margin-bottom: 4px; }
  .t-head b { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .t-cost { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-pill);
    background: rgba(28,22,17,0.08); color: rgba(28,22,17,0.6); }
  .t-cost.free { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
  .t-conf { font-size: 11.5px; color: rgba(28,22,17,0.5); margin-left: auto; }

  .t-track { position: relative; height: 26px; display: flex; align-items: center;
    background: rgba(28,22,17,0.06); border-radius: var(--radius-round); overflow: hidden; }
  .t-fill { position: absolute; inset: 0 auto 0 0; transition: width 0.25s cubic-bezier(0.3,0,0.2,1); }
  .t-fill.full { background: color-mix(in srgb, var(--success) 40%, transparent); }
  .t-fill.paid { background: color-mix(in srgb, var(--accent) 42%, transparent); }
  .t-val { position: relative; margin-left: 10px; font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 600; color: var(--text-primary);
    text-shadow: 0 0 4px rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.9); }
  .t-what { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.62); max-width: 86ch; }

  .verdict { margin: 0; padding: 9px 13px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); max-width: 88ch; }
  .verdict b { color: var(--text-primary); }

  .bounds { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0; padding: 0; list-style: none; }
  .bounds li { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.04em;
    color: rgba(28,22,17,0.5); }
  .bounds b { font-size: 11px; color: var(--accent); }

  @media (max-width: 560px) {
    .f input { width: 100px; }
    .t-conf { margin-left: 0; }
  }
</style>
