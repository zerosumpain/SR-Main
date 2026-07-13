<script lang="ts">
  // StackLayers — "the candidate stack" rebuilt as an interactive vertical
  // stratum. Six opaque slabs, base → top (Data model … Assurance). Hover or
  // click a layer to light it and reveal the journey beats it powers; a
  // "show standards" toggle reveals the concrete tech choice. Same Svelte-5
  // grammar + high-contrast palette as FlowsDiagram.
  import { STACK, STACK_BEATS, BEAT_LABEL } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  let active = $state<number | null>(null); // index into STACK
  let showStandards = $state(false);

  // one accent per layer, drawn from the design's semantic palette
  const LAYER_COLOR: Record<string, string> = {
    'Data model': '#1c2f4a',              // navy — the substrate everything rides on
    'Transport & contracts': '#0e5b66',   // petrol
    'Connector': '#c4570a',               // burnt-orange — the load-bearing front door
    'Identity': '#7a5aa6',                // purple
    'Catalogue & health bridge': '#2f7d4f', // teal
    'Assurance': '#a8842a',               // gold — the ledger / disclosure control
  };

  // STACK is authored base-first (Data model … Assurance). The stack renders
  // top-down in the DOM, so Assurance (last) must sit at the top: reverse it,
  // keeping each row's original index for the keyed lookups.
  const rows = STACK.map((r, i) => ({ ...r, i })).reverse();

  function select(i: number) {
    active = active === i ? null : i;
  }
</script>

<div class="stack-wrap">
  <div class="head">
    <span class="eyebrow">THE CANDIDATE STACK</span>
    <button
      class="std-toggle"
      class:on={showStandards}
      onclick={() => (showStandards = !showStandards)}
      aria-pressed={showStandards}
      title={showStandards ? 'Hide the concrete standards' : 'Show the concrete standards'}
    >
      {showStandards ? '● standards shown' : '○ show standards'}
    </button>
  </div>

  <div class="scroll">
    <div class="stack" role="list" aria-label="The candidate stack, top to bottom: Assurance down to Data model">
      {#each rows as row (row.layer)}
        {@const on = active === row.i}
        {@const dim = active !== null && !on}
        <button
          class="slab"
          class:on
          class:dim
          role="listitem"
          style="--lc:{LAYER_COLOR[row.layer]}"
          onclick={() => select(row.i)}
          aria-label="{row.layer} layer — {on ? 'showing' : 'show'} the beats it powers"
          aria-expanded={on}
        >
          <span class="rail" aria-hidden="true"></span>
          <span class="slab-main">
            <span class="layer-name">{row.layer}</span>
            {#if showStandards}
              <span class="choice">{row.choice}</span>
            {/if}
          </span>

          <span class="beats" class:visible={on}>
            {#each STACK_BEATS[row.layer] as beatId (beatId)}
              <span class="beat-chip">powers {BEAT_LABEL[beatId]}</span>
            {/each}
          </span>
        </button>
      {/each}
    </div>
  </div>

  <p class="takeaway">
    <span class="tk-mark" aria-hidden="true">↑</span>
    Nothing in this stack is blocked by cryptography we don't have. It is an assembled tower of
    <b>existing open standards</b> — each stratum load-bearing for specific beats of the journey.
    {#if !showStandards}<span class="hint">Toggle <b>show standards</b> to see the concrete tech at each layer.</span>{/if}
  </p>

  {#if eli}
    <p class="eli-note">Think of it like a set of building blocks that already exist — a way to describe
      the data, a locked front door, a name badge, a phone book, and a receipt book. You just stack them
      up. Tap a block to see which parts of the story it holds up.</p>
  {/if}
</div>

<style>
  .stack-wrap { display: flex; flex-direction: column; }

  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.22em; color: var(--accent-ink, #0e5b66); }

  .std-toggle { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
    border: 1.5px solid rgba(26,16,8,0.5); border-radius: var(--radius-pill); background: #faf6ec; color: rgba(26,16,8,0.82);
    padding: 6px 12px; cursor: pointer; }
  .std-toggle:hover { border-color: var(--ink, #1a1008); color: var(--ink, #1a1008); }
  .std-toggle.on { background: var(--ink, #1a1008); color: var(--paper, #f1ead6); border-color: var(--ink, #1a1008); }

  .scroll { overflow-x: auto; }
  .stack { display: flex; flex-direction: column; gap: 4px; min-width: 300px; }

  .slab { position: relative; display: flex; align-items: flex-start; gap: 0; text-align: left; width: 100%;
    border: 1.5px solid rgba(26,16,8,0.4); border-left: 4px solid var(--lc); background: #faf6ec;
    padding: 0; cursor: pointer; overflow: hidden;
    transition: background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease, transform 0.14s ease; }
  /* top slab gets the round top corners, bottom slab the round bottom corners */
  .slab:first-child { border-radius: var(--radius-round) var(--radius-round) var(--radius-sharp) var(--radius-sharp); }
  .slab:last-child  { border-radius: var(--radius-sharp) var(--radius-sharp) var(--radius-round) var(--radius-round); }
  .slab:hover, .slab.on { background: #ffffff; border-color: var(--lc); }
  .slab.on { transform: translateX(2px); }
  .slab.dim { opacity: 0.5; }
  .slab:focus-visible { outline: 2px solid var(--lc); outline-offset: 2px; }

  .rail { flex: 0 0 6px; align-self: stretch; background: var(--lc); opacity: 0.16; }
  .slab:hover .rail, .slab.on .rail { opacity: 0.32; }

  .slab-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 13px 16px; }
  .layer-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(15px, 1.7vw, 19px); color: var(--ink, #1a1008); line-height: 1.15; }
  .choice { font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.5; letter-spacing: 0.01em; color: rgba(26,16,8,0.72); }

  /* beat chips reveal on the right when the slab is active */
  .beats { display: none; flex: 0 0 auto; flex-direction: column; align-items: flex-end; gap: 5px; padding: 12px 14px 12px 0; max-width: 46%; }
  /* click persists the reveal (works on touch); hover previews it on desktop (CSS only,
     so it never fights the click state — the review-confirmed touch-dead bug) */
  .beats.visible, .slab:hover .beats { display: flex; }
  .beat-chip { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.03em; white-space: nowrap;
    color: var(--ink, #1a1008); background: #ffffff; border: 1.5px solid var(--lc); border-radius: var(--radius-pill); padding: 3px 9px; }

  .takeaway { font-family: 'DM Sans', sans-serif; font-size: 13.5px; line-height: 1.6; color: rgba(26,16,8,0.82);
    margin: 16px 2px 0; padding-top: 12px; border-top: 1px dashed rgba(26,16,8,0.28); }
  .takeaway b { color: var(--ink, #1a1008); }
  .tk-mark { font-family: 'JetBrains Mono', monospace; color: var(--accent-ink, #0e5b66); font-weight: 700; margin-right: 4px; }
  .hint { display: block; margin-top: 4px; font-size: 12px; color: rgba(26,16,8,0.6); }
  .hint b { color: rgba(26,16,8,0.72); }

  .eli-note { font-size: 13px; font-style: italic; color: rgba(26,16,8,0.72); margin: 12px 2px 0; }

  @media (max-width: 620px) {
    .slab { flex-direction: column; }
    .beats { max-width: none; align-items: flex-start; padding: 0 16px 13px; }
    .beat-chip { white-space: normal; }
  }
</style>
