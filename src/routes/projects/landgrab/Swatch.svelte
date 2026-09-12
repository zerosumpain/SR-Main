<script lang="ts">
  /**
   * A player's identity in 14 pixels — colour AND hatch, never colour alone.
   *
   * Decision 14 of the spec: five on-brand hues cannot be simultaneously ≥3:1
   * on cream and deuteranope-safe, so every surface that names a player shows
   * at least two of colour / hatch / initial. This is the hatch half, and it
   * had been copy-pasted into three files (`.chip-sw` on the page, `.sw` on the
   * boards, and the map legend's own copy) — six background rules each, drifting
   * one size at a time. One component, one set of rules.
   */
  import type { Hatch } from './identity';

  let {
    colour,
    hatch,
    size = 14,
  }: {
    /** The player's palette hex. Data, not a token — it comes from the roster. */
    colour: string;
    hatch: Hatch;
    size?: number;
  } = $props();
</script>

<span class="sw" data-hatch={hatch} style="--who: {colour}; --sw: {size}px" aria-hidden="true"
></span>

<style>
  .sw {
    display: block;
    width: var(--sw);
    height: var(--sw);
    border: 1px solid var(--who);
    border-radius: var(--radius-sharp);
    background-color: transparent;
    flex: 0 0 auto;
  }
  /* The six-strong hatch alphabet, in the order `HATCHES` declares it. The
     stripes are 2px on a 6px period at every size: a hatch that scaled with the
     swatch stopped reading as a hatch at 14px and read as a solid at 24px. */
  .sw[data-hatch='diag'] {
    background-image: repeating-linear-gradient(45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='back'] {
    background-image: repeating-linear-gradient(-45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='vert'] {
    background-image: repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='horiz'] {
    background-image: repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='grid'] {
    background-image:
      repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px),
      repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='dots'] {
    background-image: radial-gradient(var(--who) 1.6px, transparent 1.7px);
    background-size: 6px 6px;
  }
</style>
