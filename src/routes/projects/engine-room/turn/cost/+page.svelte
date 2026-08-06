<script lang="ts">
  // Where the money goes — Part I, leaf 5.
  //
  // Three instruments, almost no prose.
  //
  // One: the median prompt itemised, drawn to true scale, with the reasoning and answer from
  // the one measured reasoning call bolted on the end. NOTE the framing: these are two
  // separate measurements (MANIFEST.medianPrompt and REASONING_ROWS[1]), so the caption must
  // never call this "one measured turn" — that composite turn was never measured. Two of the
  // four segments are too small to see, and that is the argument. The control puts the 135
  // hidden tool descriptions back so the dispatcher's saving is felt as a length.
  //
  // Two: the reasoning floor, reused — drag the output budget until the answer disappears.
  //
  // Three: the caching fix. CACHE_STORY carries no figure, so nothing here claims a cached
  // rate: the bars compare what is re-sent at the full input rate against how much of it
  // changed between turns, which the constants do support (the prefix is the same bytes).
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import StackBar from '../../components/viz/StackBar.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import ReasoningFloor from './components/ReasoningFloor.svelte';
  import { MANIFEST } from '../../lib/tools';
  import { REASONING_ROWS, CACHE_STORY } from '../../lib/models';

  const TONE = 'var(--accent-ink)';

  // The measured reasoning call: a 3,000-token budget returned 447 reasoning tokens and a
  // one-word answer. Its prompt size was not recorded, which is why the prompt half of the
  // bar comes from MANIFEST and the two halves are captioned as separate measurements.
  const MEASURED = REASONING_ROWS[1];
  const THINKING = MEASURED.reasoning;
  const ANSWER = 1; // one word, one token on this scale

  /** The median prompt, minus the only slice of it that has been counted separately. */
  const REST = MANIFEST.medianPrompt - MANIFEST.servedTokens;

  let mode = $state<'served' | 'all'>('served');
  let picked = $state<string | null>(null);

  const manifest = $derived(mode === 'served' ? MANIFEST.servedTokens : MANIFEST.fullTokens);
  const segments = $derived([
    { label: 'Prompt — everything else', value: REST, tone: TONE, note: 'Instructions, history, retrieved context.' },
    {
      label: 'Prompt — tool manifest',
      value: manifest,
      tone: 'var(--accent)',
      note: mode === 'served'
        ? `${MANIFEST.shown} shown, ${MANIFEST.hidden} behind a dispatcher.`
        : `All ${MANIFEST.registered}, nothing hidden.`,
    },
    { label: 'Thinking', value: THINKING, tone: '#b0892a', note: 'Invisible. Billed as output.' },
    { label: 'The answer', value: ANSWER, tone: '#2d7a3a', note: 'One word.' },
  ]);
  /** Prompt caching. No cached rate is claimed — CACHE_STORY gives no figure. What IS known:
   *  the manifest is re-sent every turn, and the prefix is the same bytes it always was. */
  const CACHE_BARS = [
    { label: 'Manifest re-sent each turn', value: MANIFEST.servedTokens, note: 'Charged at the full input rate.' },
    { label: 'Of those, tokens that changed', value: 0, muted: true, note: 'Byte-identical, turn after turn.' },
  ];
</script>

<svelte:head>
  <title>Where the money goes · The Engine Room</title>
  <meta name="description" content="A median prompt drawn to scale: what it is made of, and why context costs more than thinking." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="turn"
    title="Where the money goes"
    line="A median prompt runs to {MANIFEST.medianPrompt.toLocaleString('en-GB')} tokens. One measured answer was a single word. Context is the expensive part, not thinking."
    lineEli5="You pay mostly for what it reads, not for what it says back." />

  {#snippet controls()}
    <div class="ctl" role="group" aria-label="Tool manifest mode">
      <button class:on={mode === 'served'} aria-pressed={mode === 'served'} onclick={() => (mode = 'served')}>As served</button>
      <button class:on={mode === 'all'} aria-pressed={mode === 'all'} onclick={() => (mode = 'all')}>Every tool sent</button>
    </div>
  {/snippet}

  <Instrument
    kicker="The bill"
    title="A turn, to scale"
    tone={TONE}
    {controls}
    reading="The median prompt itemised, with reasoning and answer from one measured call. Volume, not price. The toggle puts every hidden tool description back."
    takeaway="Thinking is a hairline. The answer is invisible. Sending all {MANIFEST.registered} tool descriptions instead of {MANIFEST.shown} costs {MANIFEST.savedTokens.toLocaleString('en-GB')} extra tokens on every turn.">
    <StackBar {segments} selected={picked} onselect={(l) => (picked = picked === l ? null : l)} height={46} />
  </Instrument>

  <Instrument
    kicker="The floor"
    title="Budget the thinking, or get nothing"
    tone={TONE}
    reading="Drag the output budget. Below what the model needs to think, it returns an empty string and no error."
    takeaway="Reasoning is emitted before the answer, so a tight budget buys thinking nobody ever sees.">
    <ReasoningFloor />
  </Instrument>

  <Instrument
    kicker="The refund"
    title="The bytes never changed"
    tone={TONE}
    reading="Marking a prefix as cacheable reached one vendor’s models only. Everything else paid the full input rate for bytes that never changed."
    takeaway={CACHE_STORY.lesson}>
    <Bars items={CACHE_BARS} unit=" tok" tone={TONE} height={24} />
  </Instrument>

  <PageFoot />
</section>

<style>
  .ctl { display: flex; gap: 5px; flex-wrap: wrap; }
  .ctl button { cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
    color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 6px 11px; }
  .ctl button:hover { background: rgba(28,22,17,0.06); border-color: rgba(28,22,17,0.38); }
  .ctl button.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
</style>
