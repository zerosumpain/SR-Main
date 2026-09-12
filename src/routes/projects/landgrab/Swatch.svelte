<script lang="ts">
  /**
   * A player's colour in 14 pixels.
   *
   * It used to carry a hatch as well — five on-brand hues cannot be
   * simultaneously >=3:1 on cream and deuteranope-safe, so colour was never
   * allowed to carry identity alone. The hatch went on 2026-09-12 because the
   * map's copy of it is a Mapbox `fill-pattern`, a raster registered at one
   * pixel ratio, which moires against a hex at every zoom but the one it was
   * drawn for. A key that hatches what the map paints flat is a key that lies.
   *
   * The second channel is now the mono initial, which every surface that uses
   * this component already prints beside it.
   */
  let {
    colour,
    size = 14,
  }: {
    /** The player's palette hex. Data, not a token — it comes from the roster. */
    colour: string;
    size?: number;
  } = $props();
</script>

<span class="sw" style="--who: {colour}; --sw: {size}px" aria-hidden="true"></span>

<style>
  .sw {
    display: block;
    width: var(--sw);
    height: var(--sw);
    border: 1px solid var(--who);
    border-radius: var(--radius-sharp);
    /* The same 28% of the hue the share bar fills a segment with, so a swatch
       and the bar beside it are the same object at two sizes. */
    background-color: color-mix(in srgb, var(--who) 28%, transparent);
    flex: 0 0 auto;
  }
</style>
