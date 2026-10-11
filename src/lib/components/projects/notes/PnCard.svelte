<svelte:options css="injected" />

<script lang="ts">
  // One project as an index card on the ruled sheet (NotesProjects): card
  // stock with a red head rule and faint petrol lines under it, as a real
  // index card is printed, set a degree or so off true (seeded from the key)
  // and held by a drawing pin or a strip of tape. The kind is written beside
  // its family's coloured-pencil dot, the card's number on the contents page
  // is ringed in the corner, and the chips are pencilled underneath as notes.
  //
  // A finished product is inked in petrol (its head rule, its title, its pin)
  // rather than orange: a different kind of thing, not a more important one.
  // A card the public cannot see has a dashed edge, as a draft would.
  //
  // The title is the link; its ::after is stretched over the card so the whole
  // card takes the click, and the owner's controls sit above that layer.
  import type { Snippet } from 'svelte';
  import { inkRing, rng } from '$lib/landing/notes-ink';
  import { cardId, chipList, fixingFor, hashKey, tiltFor } from '$lib/projects/notes';
  import type { ProjectEntry } from '$lib/projects/views';
  import PnDot from './PnDot.svelte';

  let { e, controls }: { e: ProjectEntry; controls: Snippet<[ProjectEntry]> } = $props();

  let fix = $derived(fixingFor(e));
  let tilt = $derived(tiltFor(e.key));
  let chips = $derived(chipList(e.chips));
  let ring = $derived(inkRing(rng(hashKey(e.key) % 997), 20, 15, 17, 12.5, 1.14, 0.06));
</script>

<li
  class="pk"
  id={cardId(e.key)}
  class:product={e.product}
  class:private={!e.isPublic}
  data-fix={fix}
  style:--tilt="{tilt}deg"
  style:--tape-tilt="{-tilt * 2}deg"
>
  <span class="pk-fix" aria-hidden="true"></span>
  <span class="pk-no" aria-hidden="true"
    >{e.n}<svg viewBox="0 0 40 30" preserveAspectRatio="none" focusable="false"><path d={ring} /></svg></span
  >
  <div class="pk-head">
    <p class="pk-kind"><PnDot family={e.family} />{e.kind}</p>
    {#if e.tag}<p class="pk-tag">{e.tag}</p>{/if}
    <h3 class="pk-title">
      <a class="pk-link" href={e.href} aria-label={e.label} rel={e.external ? 'noopener' : undefined}>{e.title}</a>
    </h3>
  </div>
  <div class="pk-body">
    <p class="pk-blurb">{e.blurb}</p>
    {#if chips.length}
      <p class="pk-chips"><span class="vh">Notes: </span>{chips.join(', ')}</p>
    {/if}
  </div>
  <div class="pk-foot">
    <span class="pk-ctl">{@render controls(e)}</span>
    <span class="pk-open" aria-hidden="true">{e.external ? 'open ↗' : 'open →'}</span>
  </div>
</li>

<style>
  .pk {
    --stock: var(--surface-card);
    --head-rule: rgba(196, 87, 10, 0.55);
    --feint: rgba(14, 91, 102, 0.16);
    --pen: var(--accent-hover);
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 16px 20px 12px;
    background: var(--stock);
    border: 1px solid var(--line-strong);
    color: var(--text-primary);
    transform: rotate(var(--tilt));
    transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
    scroll-margin-top: 96px;
  }
  .pk:hover,
  .pk:target,
  .pk:focus-within {
    transform: rotate(0deg);
  }
  /* Arrived at from the contents page: ringed in the orange pen. */
  .pk:target {
    outline: 2px dashed var(--accent);
    outline-offset: 7px;
  }
  .pk.product {
    --head-rule: rgba(14, 91, 102, 0.6);
    --pen: var(--accent-ink);
  }
  /* The public cannot see it: a dashed edge, as a draft would have. */
  .pk.private {
    border: 1px dashed rgba(26, 16, 8, 0.42);
    background:
      repeating-linear-gradient(-45deg, rgba(26, 16, 8, 0.07) 0 1px, transparent 1px 7px) top right / 46px 46px no-repeat,
      var(--stock);
  }

  /* -------------------------------------------------- the pin or the tape */

  .pk-fix {
    position: absolute;
    pointer-events: none;
  }
  .pk[data-fix='pin'] .pk-fix {
    top: -6px;
    left: 50%;
    width: 13px;
    height: 13px;
    margin-left: -6px;
    border-radius: 100px;
    background: radial-gradient(circle at 35% 35%, #f6b37a 0 2px, var(--accent-on-dark) 3px, #b2561a 100%);
  }
  .pk.product[data-fix='pin'] .pk-fix {
    background: radial-gradient(circle at 35% 35%, #b9e0e5 0 2px, #2c8a96 3px, #094850 100%);
  }
  .pk.private[data-fix='pin'] .pk-fix {
    background: radial-gradient(circle at 35% 35%, #f1ece4 0 2px, #a39886 3px, #6b604f 100%);
  }
  .pk[data-fix='tape'] .pk-fix {
    top: -11px;
    left: 50%;
    z-index: 1;
    width: min(112px, 34%);
    height: 22px;
    background: rgba(214, 196, 160, 0.72);
    transform: translateX(-50%) rotate(var(--tape-tilt));
  }

  /* The card's number on the contents page, ringed in the corner. */
  .pk-no {
    position: absolute;
    top: 12px;
    right: 14px;
    display: grid;
    place-items: center;
    width: 34px;
    height: 26px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
    color: var(--pen);
  }
  .pk-no svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .pk-no path {
    fill: none;
    stroke: var(--pen);
    stroke-width: 1.3;
    stroke-linecap: round;
    opacity: 0.8;
  }

  /* ------------------------------------------------------------ the head */

  .pk-head {
    margin: 0 -20px;
    padding: 0 20px 10px;
    border-bottom: 1px solid var(--head-rule);
  }
  .pk.product .pk-head {
    border-bottom: 3px double var(--head-rule);
  }
  .pk-head p {
    margin: 0;
  }
  .pk-kind {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 40px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 24px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .pk.product .pk-kind {
    color: var(--accent-ink);
  }
  .pk-tag {
    padding-left: 20px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 20px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .pk-title {
    margin: 10px 0 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 21px;
    line-height: 24px;
    letter-spacing: -0.025em;
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  .pk.product .pk-title {
    color: var(--accent-ink);
  }
  .pk-link {
    color: inherit;
    text-decoration: none;
  }
  /* The whole card takes the title's click. */
  .pk-link::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .pk:hover .pk-link {
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-decoration-color: var(--accent);
    text-underline-offset: 0.16em;
  }
  .pk-link:focus-visible {
    outline: none;
  }
  .pk:has(.pk-link:focus-visible) {
    outline: 2px solid var(--accent-hover);
    outline-offset: 5px;
  }

  /* ------------------------------------------------- the body, on the lines */

  /* The card's own feint: a petrol line under every 24px, under the writing. */
  .pk-body {
    flex: 1;
    padding-top: 6px;
    background: repeating-linear-gradient(to bottom, transparent 0 22px, var(--feint) 22px 23px, transparent 23px 30px) 0 0 / 100%
      30px;
    background-origin: content-box;
    background-clip: content-box;
  }
  .pk-blurb {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 30px;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  /* The chips, pencilled in underneath as a note to self. */
  .pk-chips {
    margin: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-size: 16px;
    line-height: 30px;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .pk-chips::before {
    content: '— ';
    color: var(--accent);
  }

  /* ------------------------------------------------------------ the foot */

  .pk-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-height: 32px;
    margin-top: 8px;
  }
  .pk-ctl {
    position: relative;
    z-index: 2;
  }
  .pk-ctl:empty {
    display: none;
  }
  .pk-open {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--pen);
  }
  .pk:hover .pk-open {
    text-decoration: underline;
    text-underline-offset: 4px;
  }

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

  @media (prefers-reduced-motion: reduce) {
    .pk {
      transition: none;
    }
  }
  @media print {
    .pk,
    .pk.private {
      transform: none;
      background: none;
      border: 1px solid #1a1008;
      break-inside: avoid;
      color: #1a1008;
    }
    .pk-fix,
    .pk-no svg,
    .pk-open {
      display: none;
    }
    .pk-body {
      background: none;
    }
    .pk-blurb {
      display: block;
      line-height: 1.45;
    }
    .pk-blurb,
    .pk-chips,
    .pk-kind,
    .pk-tag,
    .pk-title {
      color: #1a1008;
    }
    .pk-chips {
      line-height: 1.45;
    }
  }
</style>
