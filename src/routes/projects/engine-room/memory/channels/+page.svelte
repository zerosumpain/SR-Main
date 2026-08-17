<script lang="ts">
  // Where it all comes from — Part II, leaf 1.
  //
  // One finding carries this page: the channels are not peers, and the axis that separates
  // them is not the one anyone expects. It is not volume and it is not cost — it is who wrote
  // the words. Two channels carrying the same author are graded identically even though one
  // is a note on a phone and the other a message thread, and the mail channel is where the
  // consequence is visible: its free half is also its more trustworthy half.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import ChannelBoard from './components/ChannelBoard.svelte';
  import MailSweep from './components/MailSweep.svelte';
  import DecayCurve from './components/DecayCurve.svelte';
  import { NEW_TEXT_ONLY, DECAY_NOTE, CADENCE } from '../../lib/channels';

  const TONE = 'var(--accent)';
</script>

<svelte:head>
  <title>Channels · The Engine Room</title>
  <meta name="description" content="Eight channels feed one knowledge graph — notes, messages, documents, mail, research, the web, automation and conversation — and they are graded by who authored them, not by how they arrived." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Channels"
    line="Eight doors feed one graph. What separates them is not volume, and it is not cost — it is who actually wrote the words. Grade by authorship and the same sentence stops scoring two different ways depending on how it wandered in."
    lineEli5="Information arrives eight different ways — notes, messages, documents, mail, research, the web. How much each piece is trusted depends on who wrote it, not which door it came through, so the same sentence cannot score differently just because it travelled differently." />

  <Instrument
    kicker="The instrument"
    title="Eight doors, three differences"
    tone={TONE}
    reading="Chips are grouped by the grade their source carries. Pick one."
    readingEli5="The chips are grouped by how much their source is trusted. Pick one to read why."
    takeaway="Two channels sit at the top for exactly the same reason — you wrote them — even though one is a note thumbed into a phone and the other a message thread. The grade records who was holding the pen. How it travelled is not evidence of anything."
    takeawayEli5="Two very different channels sit at the top for the same reason: I wrote them myself. The grade records who held the pen, because how a sentence travelled tells you nothing about whether it is true.">
    <ChannelBoard />
  </Instrument>

  <Instrument
    kicker="The largest channel"
    title="One sweep, two halves, one budget"
    tone={TONE}
    reading="A worked mailbox of 900 threads in the window. Set what a night may spend."
    readingEli5="A worked example: 900 mail threads in the window, and a nightly reading budget you can set yourself."
    takeaway="Drag the budget to zero and the graph still works out who corresponds with whom. That half is read straight off the headers, so it is simultaneously the free evidence and the better evidence. It is therefore never the half that gets cut, which is a rare and pleasing state of affairs."
    takeawayEli5="Drag the budget to zero and it still works out who writes to whom — that part comes free from the envelope rather than the letter. The free half is also the more reliable half, so the budget only ever cuts the expensive guesswork.">
    <MailSweep />
  </Instrument>

  <aside class="note">
    <span class="n-kick">{NEW_TEXT_ONLY.title}</span>
    <p>{NEW_TEXT_ONLY.body}</p>
  </aside>

  <Instrument
    kicker="What twelve weeks of mail does"
    title="Evidence fades, and only halfway"
    tone={TONE}
    reading="A fully corroborated edge, plotted against how long ago it was last observed."
    readingEli5="One fully-confirmed connection, plotted against how long it has been since anything mentioned it."
    takeaway={DECAY_NOTE.body}>
    <DecayCurve />
  </Instrument>

  <aside class="note">
    <span class="n-kick">A cadence, not a rule</span>
    <p>
      A conversation is re-read on a ramp rather than a fixed interval: every one of the first
      {CADENCE.denseUntil} turns, thinning out after. The median thread runs {CADENCE.medianTurns} turns,
      so the dense end is where nearly every real conversation lives.
    </p>
  </aside>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .n-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); }
  .note p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

</style>
