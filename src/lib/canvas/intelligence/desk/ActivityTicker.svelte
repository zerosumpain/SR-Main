<!-- src/lib/canvas/intelligence/desk/ActivityTicker.svelte -->
<script lang="ts">
  import { tickerLine, type TickerLog } from './tickerText';

  let {
    logs,
    live = false,   // true while the engine or a synthesis run is active
  }: {
    logs: readonly TickerLog[];
    live?: boolean;
  } = $props();

  let line = $derived(tickerLine(logs));
</script>

<div class="ticker" class:live aria-live="polite">
  <span class="tag">{live ? 'LIVE' : 'IDLE'}</span>
  <span class="beam" aria-hidden="true"></span>
  <span class="text">{line}</span>
</div>

<style>
  .ticker {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 30px;
    padding: 0 14px;
    background: #1a1008;
    border-top: 1px solid rgba(250, 246, 238, 0.12);
    color: #ede4d4;
    font-family: var(--font-mono);
    font-size: 11.5px;
    letter-spacing: 0.02em;
    overflow: hidden;
    z-index: 30;
    flex-shrink: 0;
  }
  .tag {
    font-size: 9.5px;
    letter-spacing: 0.12em;
    padding: 2px 6px;
    border-radius: var(--radius-sharp);
    color: var(--text-ghost);
    border: 1px solid rgba(250, 246, 238, 0.18);
    flex-shrink: 0;
  }
  .ticker.live .tag { color: #ede4d4; border-color: var(--accent); }
  .beam {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(250, 246, 238, 0.25);
    flex-shrink: 0;
  }
  .ticker.live .beam { background: var(--accent); animation: blink 1.1s ease-in-out infinite; }
  .text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: rgba(237, 228, 212, 0.92);
  }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
</style>
