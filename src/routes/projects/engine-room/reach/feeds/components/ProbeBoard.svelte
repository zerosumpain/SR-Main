<script lang="ts">
  // ProbeBoard — the same five connectors, read two ways.
  //
  // The switch is the instrument. Both views are plausible dashboards and one of them is a
  // lie, and the only way to show that is to let the reader flip between them and watch two
  // rows change their answer. The row that says "not checked" is deliberately in the set:
  // where a live probe would cost money, saying so is the honest output, and a dashboard with
  // no such row is one that has quietly guessed somewhere.
  import { PROBES } from '../../../lib/feeds';

  let live = $state(false);
  const wrong = $derived(PROBES.filter((p) => !p.agrees).length);
</script>

<div class="pb">
  <div class="switch" role="group" aria-label="How the board is filled">
    <button type="button" class:on={!live} aria-pressed={!live} onclick={() => (live = false)}>
      Read the status column
    </button>
    <button type="button" class:on={live} aria-pressed={live} onclick={() => (live = true)}>
      Probe it now
    </button>
  </div>

  <ul class="rows">
    {#each PROBES as p (p.id)}
      {@const bad = live && !p.agrees}
      <li class:bad>
        <span class="r-name">{p.label}</span>
        <span class="r-say" class:bad>{live ? p.observed : p.stored}</span>
        <span class="r-dot" class:bad class:unknown={live && p.observed.startsWith('not checked')} aria-hidden="true">
          {#if bad}✕{:else if live && p.observed.startsWith('not checked')}–{:else}✓{/if}
        </span>
        {#if live}<span class="r-ev">{p.evidence}</span>{/if}
      </li>
    {/each}
  </ul>

  <p class="verdict" aria-live="polite">
    {#if live}
      <b>{wrong} of {PROBES.length} were wrong a moment ago.</b> One claimed months-old data while measurements
      were arriving that morning; the other claimed an active account whose authorisation had already lapsed.
      Neither column was lying — each recorded the last time something ran.
    {:else}
      <b>Everything looks fine.</b> Every row here is a stored column, and every one of them was written by
      whatever last ran, however long ago that was. Now probe it.
    {/if}
  </p>
</div>

<style>
  .pb { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .switch { display: flex; gap: 4px; flex-wrap: wrap; }
  .switch button { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 5px 12px; cursor: pointer; }
  .switch button:hover { background: rgba(28,22,17,0.07); }
  .switch button.on { background: var(--success); border-color: var(--success); color: #fff; }

  .rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .rows li { display: grid; grid-template-columns: 140px 1fr 22px; gap: 10px; align-items: baseline;
    padding: 7px 11px; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.55);
    border-left: 3px solid transparent; transition: background 0.15s, border-color 0.15s; }
  .rows li.bad { background: rgba(138,45,58,0.08); border-left-color: #8a2d3a; }
  .r-name { font-size: var(--fs-label); font-weight: 500; color: var(--text-primary); }
  .r-say { font-size: var(--fs-label); line-height: 1.45; color: rgba(28,22,17,0.72); }
  .r-say.bad { color: #8a2d3a; }
  .r-dot { justify-self: end; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--success); }
  .r-dot.bad { color: #8a2d3a; }
  .r-dot.unknown { color: rgba(28,22,17,0.35); }
  .r-ev { grid-column: 2 / -1; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    line-height: 1.5; color: rgba(28,22,17,0.45); }

  .verdict { margin: 0; padding: 9px 13px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--success) 9%, transparent);
    font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.76); max-width: 90ch; }
  .verdict b { color: var(--text-primary); }

  @media (max-width: 620px) {
    .rows li { grid-template-columns: 1fr 22px; }
    .r-name { grid-column: 1 / -1; }
    .r-ev { grid-column: 1 / -1; }
  }
</style>
