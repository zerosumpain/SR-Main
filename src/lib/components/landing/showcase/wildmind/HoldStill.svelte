<svelte:options css="injected" />

<script lang="ts">
  // The switch beside a live Wildmind map: "hold still" stops the polls and
  // the gliding (WCAG 2.2.2, content that updates by itself), "carry on"
  // starts them again. Its label says what pressing it does, so it carries no
  // aria-pressed. With `pressed` it is instead a toggle like the heartbeat
  // rules' switch: always "hold still", with aria-pressed. A 44px target that takes only its text's height in a line,
  // as EcgRule's does. Colours come from the view: --wm-hold (the text),
  // --wm-hold-on (hover and held) and --wm-focus (the ring). Not printed.
  let {
    held,
    onhold,
    controls,
    pressed = false,
  }: {
    held: boolean;
    onhold: () => void;
    /** The id of the map it holds, when the view gives it one. */
    controls?: string;
    /** A toggle that keeps its label and says it is pressed (as EcgRule's switch). */
    pressed?: boolean;
  } = $props();
</script>

<button type="button" class="wm-hold" data-held={held ? '' : undefined} aria-controls={controls}
  aria-pressed={pressed ? held : undefined}
  onclick={onhold}
>
  <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
    {#if held}<path d="M2 1 L9 5 L2 9 Z" />{:else}<path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" />{/if}
  </svg>
  {held && !pressed ? 'carry on' : 'hold still'}
</button>

<style>
  .wm-hold {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    margin: -10px 0;
    padding: 2px 4px;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    color: var(--wm-hold, var(--text-primary));
    cursor: pointer;
  }
  .wm-hold::after {
    content: '';
    position: absolute;
    inset: 0 -6px;
  }
  .wm-hold:hover,
  .wm-hold[data-held] {
    color: var(--wm-hold-on, var(--accent-hover));
  }
  .wm-hold:focus-visible {
    outline: 2px solid var(--wm-focus, var(--accent-hover));
    outline-offset: 4px;
  }
  .wm-hold svg {
    width: 9px;
    height: 9px;
    fill: currentColor;
  }
  @media print {
    .wm-hold {
      display: none;
    }
  }
</style>
