<svelte:options css="injected" />

<script lang="ts">
  // The place hero's readings (HeroPlace): one real button per note, in the
  // sentence's order, each pinned by a leader to the part of the picture it
  // names. HeroPlace owns what is shown and what a click does; this draws the
  // labels where the picture's geometry (HeroPlace's --ridge-*, --town-*,
  // --lh-*, --cloud-* and --*-y) puts them, in the sky's type tone (--type).
  import type { City } from '$lib/landing/place-city';
  import type { Ridge } from '$lib/landing/place';
  import type { Tag } from '$lib/landing/place-copy';
  import { NOTES, type NoteId } from '$lib/landing/sentence';

  let {
    tags,
    hills,
    houses,
    shown,
    pinned,
    choose,
    onfocus,
  }: {
    tags: Record<NoteId, Tag>;
    /** The far skyline, whose tallest late roof the releases label is pinned to; null with no record. */
    hills: Ridge | null;
    /** The street, whose early roof the ship label is pinned to; null with no record. */
    houses: City | null;
    /** The part the plate explains, which this lights. */
    shown: NoteId | null;
    /** The label clicked or tapped open. */
    pinned: NoteId | null;
    choose: (e: MouseEvent, id: NoteId) => void;
    onfocus: (e: FocusEvent, id: NoteId) => void;
  } = $props();
</script>

{#each NOTES as id (id)}
  {@const t = tags[id]}
  {@const anchored =
    (id === 'releases' && hills) || (id === 'ship' && houses)}
  <div
    class="pl-tag"
    data-part={id}
    data-dash={t.spoken ? '' : undefined}
    data-loose={(id === 'releases' || id === 'ship') && !anchored ? '' : undefined}
    style:--px={id === 'releases' && hills ? hills.pin.x : undefined}
    style:--py={id === 'releases' && hills ? hills.pin.y : undefined}
    style:--bx={id === 'ship' && houses ? houses.pin.x : undefined}
    style:--by={id === 'ship' && houses ? houses.pin.y : undefined}
    style:--bx0={id === 'ship' && houses ? houses.pin0.x : undefined}
    style:--by0={id === 'ship' && houses ? houses.pin0.y : undefined}
    data-on={shown === id ? '' : undefined}
  >
    <i class="pl-lead" aria-hidden="true"></i>
    <button
      type="button"
      aria-expanded={pinned === id}
      aria-controls="pl-plate"
      aria-describedby="pl-hint-{id}"
      onclick={(e) => choose(e, id)}
      onfocus={(e) => onfocus(e, id)}
    >
      <span class="k">{t.kicker}</span>
      <span class="vu"
        >{#if t.spoken}<span class="v" aria-hidden="true">{t.value}</span><span class="vh">{t.spoken}</span
          >{:else}<span class="v">{t.value}</span>{/if}{#if t.unit}{' '}<span class="u">{t.unit}</span>{/if}</span
      >
      {#if t.sub}<span class="s"><span class="vh">, </span>{t.sub}</span>{/if}
    </button>
  </div>
{/each}

<style>
  .vh {
    position: absolute !important;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* A label sits on its anchor (a zero-size box at the point it names); the
     leader runs up from that point to the text. */
  .pl-tag {
    position: absolute;
    z-index: 3;
    width: 0;
    height: 0;
    --lead: 0px;
  }
  .pl-lead {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 1px;
    height: var(--lead);
    background: rgba(var(--type), 0.42);
  }
  .pl-lead::after {
    content: '';
    position: absolute;
    left: -2px;
    bottom: -2px;
    width: 5px;
    height: 5px;
    border-radius: 100px;
    background: var(--cream);
  }
  .pl-tag button {
    --tone: var(--accent-on-dark);
    position: absolute;
    left: -1px;
    bottom: var(--lead);
    display: block;
    min-width: 44px;
    margin: 0;
    padding: 0 0 4px 9px;
    border: 0;
    border-left: 1px solid rgba(var(--type), 0.42);
    background: none;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    color: var(--cream);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  /* Right-handed: the text hangs to the left of its leader. */
  .pl-tag[data-part='releases'] button,
  .pl-tag[data-part='pulse'] button {
    left: auto;
    right: -1px;
    padding: 0 9px 4px 0;
    border-left: 0;
    border-right: 1px solid rgba(var(--type), 0.42);
    text-align: right;
  }
  .pl-tag button::after {
    content: '';
    position: absolute;
    inset: -6px -8px -2px -6px;
  }
  .pl-tag[data-part='daydream'] button,
  .pl-tag[data-part='releases'] button {
    --tone: var(--accent-ink-on-dark);
  }
  .pl-tag button:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  .k {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .vu {
    display: block;
    line-height: 1.15;
  }
  .v {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--cream);
  }
  .u {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(var(--type), 0.78);
  }
  .s {
    display: block;
    margin-top: 2px;
    font-size: 13px;
    line-height: 1.3;
    color: rgba(var(--type), 0.74);
  }
  .pl-tag[data-dash] .v {
    color: rgba(var(--type), 0.72);
  }
  .pl-tag button:hover .k,
  .pl-tag[data-on] .k {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  :global(.pl[data-focus]) .pl-lead {
    opacity: 0.4;
  }
  :global(.pl[data-focus='pulse']) [data-part='pulse'] .pl-lead,
  :global(.pl[data-focus='steps']) [data-part='steps'] .pl-lead,
  :global(.pl[data-focus='daydream']) [data-part='daydream'] .pl-lead,
  :global(.pl[data-focus='ship']) [data-part='ship'] .pl-lead,
  :global(.pl[data-focus='releases']) [data-part='releases'] .pl-lead {
    opacity: 1;
  }

  /* Releases: pinned to the tallest roof in the far skyline's last third, its
     text standing at the skyline's end where the street begins, the leader
     elbowing across to it. Wherever the roof falls, the text keeps clear of
     the plate. */
  .pl-tag[data-part='releases'] {
    left: calc(var(--ridge-l) + var(--ridge-w) * var(--px, 0.85));
    width: calc(var(--ridge-w) * (1 - var(--px, 0.85)));
    bottom: calc(var(--below) + var(--ground) + var(--ridge-h) * var(--py, 0));
    --lead: calc(var(--rel-y) - var(--ground) - var(--ridge-h) * var(--py, 0));
  }
  .pl-tag[data-part='releases']::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--lead);
    height: 1px;
    background: rgba(var(--type), 0.42);
  }
  :global(.pl[data-focus]:not([data-focus='releases'])) .pl-tag[data-part='releases']::before {
    opacity: 0.4;
  }
  .pl-tag[data-part='releases'] button {
    width: max-content;
    max-width: calc(var(--rel-w) - 24px);
    white-space: normal;
  }
  .pl-tag[data-part='releases'] .v {
    white-space: nowrap;
  }
  /* Ship: pinned to a roof near the start of the street. */
  .pl-tag[data-part='ship'] {
    left: calc(var(--town-l) + var(--town-w) * var(--bx, 0.1));
    bottom: calc(var(--below) + var(--ground) + var(--town-h) * var(--by, 0));
    --lead: calc(var(--ship-y) - var(--ground) - var(--town-h) * var(--by, 0));
  }
  /* With no record there is nothing to pin to: the label stands on the promenade. */
  .pl-tag[data-loose] {
    bottom: calc(var(--below) + var(--ground) + 16px);
    --lead: 0px;
  }
  .pl-tag[data-loose] .pl-lead {
    display: none;
  }
  /* Standing on the promenade puts a loose label in the skyline's haze, which
     can be light (a daytime horizon, a sunset): it carries a patch of the
     low sky, a stop that always keeps its type's contrast. */
  .pl-tag[data-loose] button {
    padding: 3px 9px 4px;
    background: var(--sky-low);
  }
  .pl-tag[data-part='releases'][data-loose] {
    left: 50%;
    width: 0;
  }
  .pl-tag[data-loose]::before {
    display: none;
  }
  /* Pulse: up and to the left of the beacon, its leader dropping to the
     crown, and clear of the sky deck where the rambler comes to stand. */
  .pl-tag[data-part='pulse'] {
    left: calc(100% - var(--lh-w) / 2);
    bottom: calc(var(--below) + var(--lh-b) + var(--lh-h) * 0.8225 + 8px);
    --lead: var(--pulse-lead);
  }
  .pl-tag[data-part='pulse'] button {
    right: 46px;
  }
  .pl-tag[data-part='pulse'] .pl-lead::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 47px;
    height: 1px;
    background: inherit;
  }
  /* Steps: on the promenade under the path, on one line. */
  .pl-tag[data-part='steps'] {
    /* On the ground, which is dark at every hour: cream and the on-dark accents. */
    --type: 237, 228, 212;
    --cream: #ede4d4;
    --accent-on-dark: #e8863a;
    left: 0;
    bottom: calc(var(--below) + 21px);
  }
  .pl-tag[data-part='steps'] .pl-lead {
    display: none;
  }
  .pl-tag[data-part='steps'] button {
    bottom: auto;
    top: 0;
    transform: translateY(-50%);
    padding: 0;
    border: 0;
  }
  .pl-tag[data-part='steps'] :is(.k, .vu, .s) {
    display: inline;
  }
  .pl-tag[data-part='steps'] .k {
    margin-right: 10px;
  }
  .pl-tag[data-part='steps'] .v {
    font-size: 20px;
  }
  /* Daydream: off the cloud's right shoulder. */
  .pl-tag[data-part='daydream'] {
    left: calc(var(--cloud-l) + var(--cloud-w) + 6px);
    top: calc(var(--cloud-t) + var(--cloud-w) * 0.28);
    --lead: 22px;
  }
  .pl-tag[data-part='daydream'] .pl-lead {
    bottom: auto;
    top: 0;
    width: var(--lead);
    height: 1px;
  }
  .pl-tag[data-part='daydream'] .pl-lead::after {
    left: -3px;
    bottom: -2px;
  }
  .pl-tag[data-part='daydream'] button {
    left: calc(var(--lead) + 6px);
    bottom: auto;
    top: 0;
    transform: translateY(-24px);
  }

  /* ------------------------------------------------------------- narrower */

  /* A small laptop: the releases label stacks its unit, so the plate keeps
     its width beside it. */
  @media (max-width: 1299px) {
    .pl-tag[data-part='releases'] .u {
      display: block;
      margin-top: 2px;
    }
  }
  @media (max-width: 1099px) {
    .pl-tag[data-part='ship'] .u {
      display: block;
      margin-top: 2px;
    }
  }
  /* A phone (HeroPlace moves the plate under the picture and the cloud into
     its sky, top left). */
  @media (max-width: 759px) {
    .pl-tag[data-part='daydream'] {
      left: calc(var(--cloud-w) + 14px);
      top: auto;
      bottom: calc(var(--below) + var(--world) - 66px);
    }
    .pl-tag[data-part='daydream'] .pl-lead {
      display: none;
    }
    .pl-tag[data-part='daydream'] button {
      left: 0;
      top: auto;
      bottom: 0;
      transform: none;
    }
    /* Ship stands on a roof at the street's start, clear of the tower. */
    .pl-tag[data-part='ship'] {
      left: calc(var(--town-l) + var(--town-w) * var(--bx0, 0.06));
      bottom: calc(var(--below) + var(--ground) + var(--town-h) * var(--by0, 0));
      --lead: calc(var(--ship-y) - var(--ground) - var(--town-h) * var(--by0, 0));
    }
    .pl-tag[data-part='ship'] .s {
      display: none;
    }
    /* With no record the two loose labels share the promenade, releases
       hanging left of the middle and ship right of it, each wrapping inside
       its half of the screen. */
    .pl-tag[data-part='ship'][data-loose] {
      left: calc(50% + 12px);
      bottom: calc(var(--below) + var(--ground) + 16px);
      --lead: 0px;
    }
    .pl-tag[data-loose] button {
      width: max-content;
      max-width: calc(50vw - var(--gut) - 14px);
      white-space: normal;
    }
    .pl-tag[data-part='pulse'] .s {
      width: 8.5em;
      margin-left: auto;
      white-space: normal;
    }
    .v {
      font-size: 20px;
    }
    .pl-tag[data-part='steps'] {
      bottom: calc(var(--below) + 15px);
    }
    .pl-tag[data-part='steps'] .v {
      font-size: 18px;
    }
  }

  /* Print: the picture's labels go; HeroPlace prints every reading as text. */
  @media print {
    .pl-tag {
      display: none;
    }
  }
</style>
