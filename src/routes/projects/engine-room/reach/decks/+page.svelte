<script lang="ts">
  // Making the case — Part III, leaf 4.
  //
  // Two arguments, and they are the same argument twice: a generator with no constraints is a
  // generator of drafts. The page is a fixed size and nothing scrolls, so overflow is a design
  // brief rather than a bug; and one registry validates every consumer, so a block the model
  // invents is refused by the code that refuses a bad hand edit.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import StageFit from './components/StageFit.svelte';
  import { COUNTS, CONSUMERS, COMPOSE_PATHS, REGISTRY_NOTE, FALLBACK_NOTE, OVERFLOW, SHARING } from '../../lib/decks';

  const TONE = 'var(--success)';

  let path = $state(COMPOSE_PATHS[0].id);
  const chosenPath = $derived(COMPOSE_PATHS.find((p) => p.id === path) ?? COMPOSE_PATHS[0]);

  /** The same three stages every time; only which one diverts changes. */
  const pipeline = $derived([
    { id: 'ask', label: 'Content in', sub: 'text, media, attachments', state: 'done' as const },
    {
      id: 'compose', label: path === 'down' ? 'The model is unreachable' : 'The model composes',
      sub: path === 'down' ? 'timed out, failed over, failed again' : 'one call, layout and blocks',
      state: (path === 'down' ? 'failed' : 'done') as 'done' | 'failed',
    },
    {
      id: 'validate', label: 'The registry validates', sub: path === 'llm' ? 'accepted' : 'rejected',
      state: (path === 'llm' ? 'done' : 'failed') as 'done' | 'failed',
    },
    {
      id: 'heuristic', label: 'The deterministic composer', sub: path === 'llm' ? 'not needed' : 'composes instead',
      state: (path === 'llm' ? 'skipped' : 'done') as 'done' | 'skipped',
    },
    { id: 'slide', label: 'A valid slide', sub: 'every time, or not at all', state: 'done' as const },
  ]);
</script>

<svelte:head>
  <title>Making the case · The Engine Room</title>
  <meta name="description" content="A slide deck built by the same system: a fixed page that never scrolls, one block registry serving four consumers, and a deterministic composer behind the clever one." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="Making the case"
    line="A deck the assistant builds out of a conversation, onto a page that is a fixed size, never scrolls, and unsentimentally cuts off anything past the edge. Slides have been doing this to us for thirty years; here it is at least deliberate."
    lineEli5="It can turn a conversation into a slide deck. The pages are a fixed size, so anything that does not fit is simply lost — which is why it is told up front exactly how much fits." />

  <Instrument
    kicker="The instrument"
    title="A page that will not grow"
    tone={TONE}
    reading="Choose how the page is set, then add content. The limits are the ones the composer is given."
    takeaway={OVERFLOW.body}>
    <StageFit />
  </Instrument>

  <Instrument
    kicker="The clever path is the optional one"
    title="Composition either produces a valid slide or does not happen at all"
    tone={TONE}
    reading="Break it and see what turns up instead."
    takeaway={FALLBACK_NOTE.body}>
    {#snippet controls()}
      <div class="seg" role="group" aria-label="What goes wrong">
        {#each COMPOSE_PATHS as p (p.id)}
          <button type="button" class:on={path === p.id} aria-pressed={path === p.id}
                  onclick={() => (path = p.id)}>{p.when}</button>
        {/each}
      </div>
    {/snippet}
    <Steps items={pipeline} tone={TONE} />
    <p class="path-say" aria-live="polite"><b>{chosenPath.label}.</b> {chosenPath.what}</p>
  </Instrument>

  <Instrument
    kicker="One registry"
    title="Four consumers, one definition of a valid slide"
    tone={TONE}
    reading="Each of these validates against the same schemas."
    takeaway={REGISTRY_NOTE.body}>
    <div class="cons">
      {#each CONSUMERS as c (c.id)}
        <div class="con"><b>{c.label}</b><span>{c.what}</span></div>
      {/each}
    </div>
    <div class="stats">
      <Stat value={COUNTS.layouts} label="page layouts" how="entries in the layout registry" tone={TONE} />
      <Stat value={COUNTS.blocks} label="block types" how="members of the block union" tone={TONE} />
      <Stat value={COUNTS.proseStyles + COUNTS.quoteStyles} label="prose and quote registers"
            how="{COUNTS.proseStyles} prose, {COUNTS.quoteStyles} quote" tone={TONE} />
      <Stat value={COUNTS.effects} label="atmospheres and wipes"
            how="{COUNTS.backgroundEffects} backgrounds, {COUNTS.transitionEffects} transitions" tone={TONE} />
    </div>
  </Instrument>

  <Instrument
    kicker="Sending it"
    title="Private, unless you make a link — and the link is a hash"
    tone={TONE}
    reading="What a share is, and what it records.">
    <ul class="share">
      {#each SHARING as s (s.k)}
        <li><b>{s.k}</b><em>{s.v}</em><span>{s.why}</span></li>
      {/each}
    </ul>
  </Instrument>

  <PageFoot />
</section>

<style>
  .seg { display: flex; gap: 4px; flex-wrap: wrap; }
  .seg button { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.04em;
    color: rgba(28,22,17,0.6); background: rgba(255,255,255,0.7);
    border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round);
    padding: 4px 9px; cursor: pointer; }
  .seg button:hover { background: rgba(28,22,17,0.07); }
  .seg button.on { background: var(--success); border-color: var(--success); color: #fff; }

  .path-say { margin: 10px 0 0; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.74); max-width: 86ch; }
  .path-say b { color: var(--text-primary); }

  .cons { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px; }
  .con { display: flex; flex-direction: column; gap: 2px; padding: 9px 12px;
    border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.5); }
  .con b { font-size: 12.5px; color: var(--text-primary); }
  .con span { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.65); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; margin-top: 12px; }

  .share { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .share li { display: grid; grid-template-columns: minmax(140px, 200px) minmax(120px, 180px) 1fr;
    gap: 10px; align-items: baseline; padding: 6px 10px; border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); }
  .share b { font-size: 12.5px; color: var(--text-primary); }
  .share em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--success); }
  .share span { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.65); }


  @media (max-width: 700px) {
    .share li { grid-template-columns: 1fr; gap: 2px; }
  }
</style>
