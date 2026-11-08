<script lang="ts">
  // One Codenames card on the TV. Face down it is the word on paper; touched,
  // it turns over to its agent's colour (each with its own mark, so red and
  // blue are told apart without colour vision) and keeps the word small. At
  // the end the cards nobody touched show what they were, faintly.
  let {
    word,
    kind,
    keyKind = null,
    by = null,
    fresh = false,
  }: {
    word: string;
    /** What it turned out to be; null while face down. */
    kind: string | null;
    /** The game is over: what a face-down card was. */
    keyKind?: string | null;
    /** Who turned it ('auto' for co-op's own turn). */
    by?: string | null;
    fresh?: boolean;
  } = $props();
</script>

<div class="cncard" class:up={kind !== null} class:fresh class:long={word.length >= 8} class:longer={word.length >= 10}>
  <div class="inner">
    <div class="face front {keyKind ? `hint ${keyKind}` : ''}">
      <span class="word">{word}</span>
    </div>
    <div class="face back {kind ?? ''}">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        {#if kind === 'red'}
          <path d="M10 2.5 17.5 10 10 17.5 2.5 10z" />
        {:else if kind === 'blue'}
          <circle cx="10" cy="10" r="7" />
        {:else if kind === 'assassin'}
          <path d="M5 5 15 15M15 5 5 15" fill="none" stroke-width="2.6" stroke-linecap="round" />
        {:else}
          <path d="M5 10h10" fill="none" stroke-width="2" stroke-linecap="round" />
        {/if}
      </svg>
      <span class="word small">{word}</span>
      {#if by}<span class="by">{by}</span>{/if}
    </div>
  </div>
</div>

<style>
  .cncard {
    perspective: 80cqw;
    min-width: 0;
  }
  .inner {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    transition: transform 720ms cubic-bezier(0.3, 0.7, 0.2, 1.15);
  }
  .up .inner {
    transform: rotateY(180deg);
  }
  .face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: 4px;
    backface-visibility: hidden;
    overflow: hidden;
  }
  .front {
    background: #ece3d6;
    color: #1a1008;
    border-bottom: 0.35cqw solid #c9bba4;
  }
  /* The end: what an untouched card was, as a band along its foot. */
  .front.hint {
    border-bottom-width: 0.9cqw;
  }
  .front.hint.red {
    border-bottom-color: #b4472c;
  }
  .front.hint.blue {
    border-bottom-color: #1f4f8f;
  }
  .front.hint.assassin {
    border-bottom-color: #0b0806;
    background: #a99c88;
  }
  .front.hint.neutral {
    border-bottom-color: #a99c88;
  }
  .word {
    padding: 0 0.6cqw;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75cqw;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    text-align: center;
    line-height: 1;
    white-space: nowrap;
  }
  .long .word {
    font-size: 1.45cqw;
  }
  .longer .word {
    font-size: 1.2cqw;
  }
  .back {
    --mark: rgba(246, 239, 227, 0.92);
    transform: rotateY(180deg);
    grid-template-rows: 1fr auto;
    padding: 0.5cqw;
    background: #a99c88;
    color: var(--mark);
  }
  .back.red {
    background: #b4472c;
  }
  .back.blue {
    background: #1f4f8f;
  }
  .back.assassin {
    background: #0b0806;
    border: 1px solid var(--on-ink-30);
    --mark: #e06a6a;
  }
  .back.neutral {
    --mark: rgba(26, 16, 8, 0.7);
  }
  svg {
    width: 2.6cqw;
    height: 2.6cqw;
    fill: var(--mark);
    stroke: var(--mark);
    align-self: center;
  }
  .cncard .word.small {
    font-size: 0.95cqw;
    opacity: 0.85;
  }
  .by {
    position: absolute;
    top: 0.35cqw;
    right: 0.5cqw;
    font-family: var(--font-mono);
    font-size: 0.8cqw;
    opacity: 0.75;
  }
  .fresh .back {
    animation: glow 1.8s ease-out 400ms 1;
  }
  @keyframes glow {
    0% {
      outline: 0.3cqw solid rgba(232, 134, 58, 0.95);
      outline-offset: 0;
    }
    100% {
      outline: 0.3cqw solid rgba(232, 134, 58, 0);
      outline-offset: 0.8cqw;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .inner {
      transition: none;
    }
    .fresh .back {
      animation: none;
      outline: 2px solid var(--accent-on-dark);
    }
  }
</style>
