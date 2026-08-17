<script lang="ts">
  // Where the time goes — Part I, leaf 4.
  //
  // Two findings, two instruments, almost no prose. Finding one is a scale argument, so it
  // is a waterfall drawn to true scale with a magnify toggle (you are meant to fail to see
  // the site's own segments). Finding two kills a theory, so it is a scatter: if prompt size
  // drove first-token time, the five measured calls would form a line. They do not.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import TtftWaterfall from './components/TtftWaterfall.svelte';
  import TtftScatter from './components/TtftScatter.svelte';
  import { WATERFALL, TTFT_TOTAL, MANIFEST } from '../../lib/tools';
  import { TTFT_TRACE } from '../../lib/models';

  const TONE = 'var(--accent-ink)';

  // Every figure below is derived from the measured constants rather than retyped.
  const siteMs = WATERFALL.filter((s) => s.kind === 'site').reduce((a, s) => a + s.ms, 0);
  const modelS = ((TTFT_TOTAL - siteMs) / 1000).toFixed(1);

  // Finding two is a ratio argument: sizes barely move, first-token time moves enormously.
  const sizes = TTFT_TRACE.map((d) => d.promptTokens);
  const times = TTFT_TRACE.map((d) => d.ttft);
  const sizeSpread = (Math.max(...sizes) / Math.min(...sizes)).toFixed(1);
  const timeSpread = Math.round(Math.max(...times) / Math.min(...times));
  const biggest = TTFT_TRACE.reduce((a, b) => (b.promptTokens > a.promptTokens ? b : a));
</script>

<svelte:head>
  <title>Where the time goes · The Engine Room</title>
  <meta name="description" content="Where the wait in one message actually goes: milliseconds of site code, then seconds of the model reading the prompt." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="turn"
    title="Where the time goes"
    line={`From pressing send to the first character, my own code accounts for ${siteMs} milliseconds. The other ${modelS} seconds is the model having a read, at what I can only describe as its own pace.`}
    lineEli5="Almost none of the wait is the website — my code finishes in a fraction of a second. The rest is the AI reading your message before it starts to answer. Measuring that stopped me optimising the wrong thing." />

  <Instrument
    kicker="Finding one"
    title="The site is a rounding error"
    tone={TONE}
    reading="The measured send path, submit to first visible character, drawn to true scale."
    readingEli5="The full journey from pressing send to the first visible character, drawn to true scale. Try to find the website's share."
    takeaway={`Optimise all ${siteMs} milliseconds of my code down to zero and nobody would notice. The wait is the model working through a ${MANIFEST.medianPrompt.toLocaleString('en-GB')}-token prompt before it says a word. A useful thing to learn early, and a slightly deflating one.`}
    takeawayEli5={`Optimise all ${siteMs} milliseconds of my code down to zero and nobody would notice. The wait is the model reading a very long briefing before it says a word — so the useful work is making the briefing shorter, not the code faster.`}>
    <TtftWaterfall />
  </Instrument>

  <Instrument
    kicker="Finding two"
    title="Prompt length is not the culprit"
    tone={TONE}
    reading="Five calls: prompt size across, time to first token up. If one drove the other, these would form a line. They form a shrug."
    readingEli5="Five real calls: message size across, wait-before-the-first-word up. If size caused the wait, the dots would form a line. They do not."
    takeaway={`Across the five, prompt size varies ${sizeSpread}×; first-token time varies ${timeSpread}×. The biggest prompt of the lot came back in ${biggest.ttft}s. So the variable is which seller picked up, not what you sent them.`}
    takeawayEli5={`Sizes vary ${sizeSpread}× across these calls; the wait varies ${timeSpread}×, and the biggest prompt of the lot came back in ${biggest.ttft} seconds. What actually moves the wait is which company's server picks up — worth knowing before you blame the message.`}>
    <TtftScatter />
  </Instrument>

  <PageFoot />
</section>
