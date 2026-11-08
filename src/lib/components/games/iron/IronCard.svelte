<script lang="ts">
  // One Iron Roads card: a colour, or an engine (wild). Sized by the parent's
  // `--iron-card-w`; `count` shows a hand's number of them.
  import type { Card } from '$lib/games/iron-roads';
  import { CARD_LABEL, CARD_PAINT, CARD_TEXT } from './colours';

  let { card, count = null }: { card: Card; count?: number | null } = $props();
</script>

<span class="iron-card" class:iron-engine={card === 'engine'} class:iron-dark={card === 'black'} style:background={CARD_PAINT[card]} style:color={CARD_TEXT[card]}>
  {#if card === 'engine'}
    <svg class="iron-loco" viewBox="0 0 24 16" aria-hidden="true">
      <path d="M2 12V5h7V2h4v3h3l4 3v4z" />
      <circle cx="6" cy="13" r="2.2" />
      <circle cx="12" cy="13" r="2.2" />
      <circle cx="18" cy="13" r="2.2" />
    </svg>
  {/if}
  <span class="iron-card-label">{CARD_LABEL[card]}</span>
  {#if count !== null}<span class="iron-card-count">{count}</span>{/if}
</span>

<style>
  .iron-card {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    width: var(--iron-card-w, 4cqw);
    aspect-ratio: 2 / 3;
    padding-bottom: 8%;
    border-radius: 2px;
    border: 2px solid var(--chrome-bg);
    box-sizing: border-box;
    overflow: hidden;
  }
  .iron-dark {
    border-color: var(--on-ink-45);
  }
  .iron-engine {
    background: repeating-linear-gradient(135deg, #d24a3c 0 12%, #e6c043 12% 24%, #5f9e4c 24% 36%, #4b87cc 36% 48%) !important;
    color: var(--chrome-ink) !important;
  }
  .iron-engine::before {
    content: '';
    position: absolute;
    inset: 14%;
    border-radius: 2px;
    background: var(--chrome-bg);
  }
  .iron-loco {
    position: absolute;
    top: 30%;
    left: 50%;
    width: 60%;
    transform: translateX(-50%);
    fill: var(--accent-on-dark);
  }
  .iron-card-label {
    position: relative;
    font-family: var(--font-mono);
    font-size: calc(var(--iron-card-w, 4cqw) * 0.18);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .iron-card-count {
    position: absolute;
    top: 6%;
    right: 10%;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: calc(var(--iron-card-w, 4cqw) * 0.4);
    line-height: 1;
  }
</style>
