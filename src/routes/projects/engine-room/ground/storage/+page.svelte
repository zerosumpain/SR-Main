<script lang="ts">
  // Where the bytes live — Part V, leaf 2.
  //
  // The instrument is a ladder of failures rather than a topology of stores, because "what
  // exists" is the easy question and "what survives what" is the one that matters at three in
  // the morning. The last rung has no recovery: a snapshot of encrypted rows is a snapshot of
  // ciphertext, and the key is not in it.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import FailureLadder from './components/FailureLadder.svelte';
  import { STORES, BIG_INDEX, ESCROW_NOTE } from '../../lib/ground';

  const TONE = '#5a6b7a';
  let store = $state(STORES[0].id);
  const chosen = $derived(STORES.find((s) => s.id === store) ?? STORES[0]);
</script>

<svelte:head>
  <title>Where the bytes live · The Engine Room</title>
  <meta name="description" content="Four stores — a database, object storage, a disposable disk and an off-site snapshot — and the one failure none of them survives." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="ground"
    title="Where the bytes live"
    line="Four places a byte can end up, each chosen by answering a single question — and one kind of loss about which a flawless, nightly, off-site backup can do absolutely nothing."
    lineEli5="Different things are kept in different places, on purpose. One of them can be lost in a way that no backup will fix."
  />

  <Instrument
    kicker="The instrument"
    title="Break something"
    tone={TONE}
    reading="Pick a failure. What recovers it is listed in the order it would actually be reached."
    takeaway="Four of the five are survivable and thoroughly boring, which is precisely the goal. The fifth is the one worth losing sleep over: encrypting credentials at rest is obviously the right thing to do, and it quietly creates a second thing to lose.">
    <FailureLadder />
  </Instrument>

  <aside class="note">
    <span class="n-kick">{ESCROW_NOTE.title}</span>
    <p>{ESCROW_NOTE.body}</p>
  </aside>

  <Instrument
    kicker="The four"
    title="Each store answers one question"
    tone={TONE}
    reading="Pick one.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Stores">
        {#each STORES as s (s.id)}
          <button type="button" class="chip" class:on={store === s.id} aria-pressed={store === s.id}
                  onclick={() => (store = s.id)}>{s.label}</button>
        {/each}
      </div>
      <div class="read" aria-live="polite">
        <p class="r-holds">{chosen.holds}</p>
        <p class="r-why"><b>Why here.</b> {chosen.why}</p>
        <p class="r-why"><b>What losing it costs.</b> {chosen.loss}</p>
      </div>
    </div>
  </Instrument>

  <aside class="note">
    <span class="n-kick">{BIG_INDEX.title}</span>
    <p>{BIG_INDEX.body}</p>
  </aside>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid #5a6b7a;
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: rgba(90,107,122,0.09); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: #5a6b7a; }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

  .strip { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: #5a6b7a; border-color: #5a6b7a; color: #fff; }

  .read { min-height: 6.5em; }
  .r-holds { margin: 0 0 6px; font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600;
    line-height: 1.3; color: var(--text-primary); max-width: 76ch; }
  .r-why { margin: 0 0 4px; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 86ch; }
  .r-why b { color: var(--text-primary); }


  @media (max-width: 560px) { .read { min-height: 0; } }
</style>
