<svelte:options css="injected" />

<script lang="ts">
  // The sentence view's showcase: below the hero the sentence keeps going, as
  // a long-form feature in chapters. Paper for reading, with one ink band in
  // the middle for the app, so the page alternates like a printed feature
  // (measurement is dark, argument is light). The footnote numbers carry on
  // from the hero's.
  //
  // The layout, chapter by chapter (desktop: a margin column of
  // clamp(176px,15vw,224px) beside the main column, as in the hero; on a phone
  // the margin folds in above each headline):
  //
  //   ~    a standfirst under the seam ("That's the short version…") that
  //        carries the hero's sentence into the essay
  //   i.   Daydream · "It thinks while nobody's watching" (petrol)
  //        figure   questions it asked itself this week
  //        margin   the live next-think state (readDaydream)
  //        prose    the rules (footnote: today's think slots), hours, look-ups,
  //                 areas of life, claims struck out; then "The verdicts" with
  //                 the hit rate (footnote: twelve weeks of verdict columns),
  //                 up or down, and ideas that became code
  //        floors   the opening rule (spot: think), the second movement
  //   ~    a heartbeat rule (beats at the live bpm when fresh, else flat)
  //   ii.  Health · "My body, on the record" (orange)
  //        figure   steps so far this year
  //        margin   bpm now, only when the pulse is fresh
  //        prose    km on foot, days over the goal (footnote: thirty days as a
  //                 numeral row in thousands), best day, today (footnote:
  //                 twenty-four hourly bars); then the pulse when fresh,
  //                 recovery by band (footnote: thirty marks), sleep average,
  //                 last night's and today's bands
  //        floors   the opening rule, the second movement (spot: gym, he sits
  //                 by the pulse)
  //   ===  the ink band, opened by a heartbeat line in the hero's colours
  //   iii. The app · "It lives in my pocket" (orange on ink)
  //        figure   doors from my phone into the site (native endpoints)
  //        prose    pieces, tabs (footnote: the tab bar as type), widgets,
  //                 complications (Readiness = /health), Siri (footnote: the
  //                 phrases, quoted), family games; then the doorway (pairing
  //                 code and key) and how the loop closes in the app's inbox
  //        floors   the opening rule, the second movement
  //   iv.  The builder · "It rewrites itself, then ships" (petrol)
  //        figure   releases so far
  //        margin   the builder's live stage
  //        prose    days, deploys a day (footnote: forty days as numerals),
  //                 today, ideas from Daydream; then lines written
  //        floors   the opening rule (spot: desk), the second movement
  //   ~    a heartbeat rule
  //   v.   And the rest · one closing sentence whose value words are links
  //
  // The flash: each headline figure counts up once on first view while a
  // highlighter stroke sweeps behind it; the server and reduced motion show
  // the final figure with the stroke drawn. Each chapter's margin carries one
  // small exact chart, always in view. The only continuous motion is the
  // heartbeat rules' sweep, on a fresh pulse only, paused off screen, with a
  // "hold still" beside each; only the first says the rate in words.
  import type { ShowcaseProps } from '$lib/landing/showcase';
  import { codaSegments, sentenceChapters, standfirst } from '$lib/landing/showcase-sentence';
  import Chapter from './Chapter.svelte';
  import Coda from './Coda.svelte';
  import EcgRule from './EcgRule.svelte';

  let props: ShowcaseProps = $props();

  let chapters = $derived(sentenceChapters(props));
  let coda = $derived(codaSegments(props));
  let lede = $derived(standfirst(chapters));
  let bpm = $derived(props.pulse.state === 'fresh' ? props.pulse.bpm : null);

  let open = $state<string | null>(null);
  let held = $state(false);
  let root: HTMLElement;

  const toggle = (id: string) => (open = open === id ? null : id);
  const hold = () => (held = !held);

  // Escape closes the open note from anywhere inside it and puts focus back on its word.
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    const id = open;
    open = null;
    root.querySelector<HTMLButtonElement>(`button[aria-controls="ss-fn-${id}"]`)?.focus();
  }

  const SPOTS = {
    daydream: { rule: 'think', p2: undefined },
    health: { rule: undefined, p2: 'gym' },
    app: { rule: undefined, p2: undefined },
    build: { rule: 'desk', p2: undefined },
  } as const;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ss" bind:this={root} {onkeydown}>
  <div class="ss-sf">
    {#if props.data.fixture}<p class="ss-fixture">preview figures</p>{/if}
    <p class="ss-lede">{lede}</p>
  </div>

  {#each chapters as c (c.id)}
    {#if c.ground === 'ink'}
      <div class="ss-band">
        <EcgRule {bpm} {held} onhold={hold} ground="ink" bleed />
        <Chapter {c} {open} ontoggle={toggle} ruleSpot={SPOTS[c.id].rule} p2Spot={SPOTS[c.id].p2} />
      </div>
    {:else}
      <div class="ss-leaf" class:ss-after-band={c.id === 'build'}>
        <Chapter {c} {open} ontoggle={toggle} ruleSpot={SPOTS[c.id].rule} p2Spot={SPOTS[c.id].p2} />
      </div>
      {#if c.id === 'daydream' || c.id === 'build'}
        <div class="ss-between"><EcgRule {bpm} {held} onhold={hold} caption={c.id === 'daydream'} /></div>
      {/if}
    {/if}
  {/each}

  <div class="ss-leaf ss-last"><Coda segs={coda} /></div>
</div>

<style>
  .ss {
    --gut: clamp(16px, 4vw, 64px);
    position: relative;
    padding: clamp(64px, 7vw, 104px) 0 clamp(40px, 5vw, 72px);
    background: var(--bg);
    color: var(--text-primary);
  }
  /* The standfirst: the hero's sentence carries on, in its own italic,
     before the first chapter opens. It keeps the chapters' columns and the
     rambler's rope lane at the right. */
  .ss-sf {
    --lane: 40px;
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut) clamp(56px, 6vw, 88px);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'fx' 'lede';
  }
  .ss-fixture {
    grid-area: fx;
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ss-lede {
    grid-area: lede;
    max-width: min(32em, 100% - var(--lane));
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(21px, 2.05vw, 30px);
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: var(--text-secondary);
    text-wrap: pretty;
  }
  @media (min-width: 900px) {
    .ss-sf {
      grid-template-columns: clamp(176px, 15vw, 224px) minmax(0, 1fr);
      grid-template-areas: 'fx lede';
      column-gap: 32px;
    }
    .ss-fixture {
      align-self: baseline;
      margin: 0;
    }
  }
  .ss-leaf {
    padding-bottom: clamp(48px, 5vw, 72px);
  }
  .ss-leaf.ss-after-band {
    padding-top: clamp(72px, 7vw, 104px);
  }
  .ss-leaf.ss-last {
    padding-bottom: 0;
  }
  /* Clear air under each heartbeat rule: the next chapter's opening rule is
     a floor, and the rambler needs room above it to stand. */
  .ss-between {
    padding-bottom: clamp(68px, 6vw, 96px);
  }
  /* The one dark pull-out, full-bleed; its content keeps the measure. */
  .ss-band {
    margin-top: clamp(24px, 3vw, 40px);
    padding: clamp(40px, 5vw, 64px) 0 clamp(72px, 7vw, 104px);
    background: var(--text-primary);
    color: var(--bg);
  }
  .ss-band > :global(.ss-er) {
    padding-bottom: clamp(68px, 6vw, 96px);
  }
  @media print {
    .ss,
    .ss-band {
      background: none;
      color: #1a1008;
    }
    .ss-fixture,
    .ss-lede {
      color: #1a1008;
    }
    .ss-band {
      padding: 24px 0;
    }
  }
</style>
