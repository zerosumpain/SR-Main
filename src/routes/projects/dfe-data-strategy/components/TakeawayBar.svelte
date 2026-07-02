<script lang="ts">
  import { app } from '../lib/appState.svelte';

  interface Chip {
    n: string;
    label: string;
    href?: string;
  }
  interface Drill {
    label: string;
    href: string;
  }
  interface Props {
    takeaway: string;
    takeawayEli5?: string;
    chips?: Chip[];
    drill?: Drill[];
  }
  let { takeaway, takeawayEli5, chips = [], drill = [] }: Props = $props();
  const eli = $derived(app.narrative === 'eli5');
</script>

<aside class="tb" aria-label="The headline message">
  <span class="tb-kicker">The headline</span>
  <p class="tb-take">{eli && takeawayEli5 ? takeawayEli5 : takeaway}</p>
  {#if chips.length || drill.length}
    <div class="tb-row">
      {#each chips as c}
        {#if c.href}
          <a class="tb-chip link" href={c.href}><b>{c.n}</b><span>{c.label}</span></a>
        {:else}
          <span class="tb-chip"><b>{c.n}</b><span>{c.label}</span></span>
        {/if}
      {/each}
      {#if drill.length}
        <span class="tb-drills">
          {#each drill as d}
            <a class="tb-drill" href={d.href}>↓ {d.label}</a>
          {/each}
        </span>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .tb {
    margin: 0 0 22px;
    padding: 14px 18px 13px;
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-left: 4px solid var(--ink, #1c1611);
    background: rgba(255, 255, 255, 0.5);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    max-width: 86ch;
  }
  .tb-kicker {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin-bottom: 5px;
  }
  .tb-take {
    margin: 0;
    font-family: 'Fraunces', serif;
    font-weight: 500;
    font-size: clamp(17px, 2.2vw, 21px);
    line-height: 1.35;
    letter-spacing: -0.01em;
    color: var(--ink, #1c1611);
  }
  .tb-row {
    display: flex;
    align-items: center;
    gap: 8px 10px;
    flex-wrap: wrap;
    margin-top: 11px;
  }
  .tb-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-round);
    background: rgba(241, 234, 214, 0.6);
    text-decoration: none;
  }
  .tb-chip b {
    font-family: 'Fraunces', serif;
    font-size: 15px;
    font-weight: 600;
    color: var(--accent-ink);
  }
  .tb-chip span {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.6);
  }
  .tb-chip.link:hover {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .tb-drills {
    display: inline-flex;
    gap: 4px 12px;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .tb-drill {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
  }
  .tb-drill:hover {
    border-bottom-style: solid;
  }
  @media (max-width: 760px) {
    .tb {
      padding: 12px 13px 11px;
    }
    .tb-drills {
      margin-left: 0;
    }
  }
</style>
