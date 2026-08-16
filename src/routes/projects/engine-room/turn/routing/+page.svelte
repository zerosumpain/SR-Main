<script lang="ts">
  // Picking a model — Part I, leaf 3.
  //
  // Two claims, two instruments. First: naming a model is only one of four ways one gets
  // chosen. Second: naming it does not settle who serves it. The catalogue and the scoring
  // rules are dial readings under both, so they are bars and tiles, never paragraphs.
  //
  // The four layers are a precedence chain — RESOLUTION documents "first match wins" — so the
  // track is railed and the caption says so. Calling them unordered would misread the source.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import ResolutionTrack from './components/ResolutionTrack.svelte';
  import SellerRoulette from './components/SellerRoulette.svelte';
  import { POLICY, CATALOGUE, SELLER_FACTS } from '../../lib/models';

  const TONE = 'var(--accent-ink)';

  const NARROWING = [
    { label: 'In the catalogue', value: CATALOGUE.total, note: 'snapshot, not production' },
    { label: 'Tool-capable', value: CATALOGUE.toolCapable },
    { label: 'Rated', value: CATALOGUE.rated },
    { label: 'Eligible', value: CATALOGUE.eligible, tone: 'var(--accent)' },
  ];

  const POOLS = [
    { label: 'Retrieval', value: CATALOGUE.pools.rag },
    { label: 'General', value: CATALOGUE.pools.general },
    { label: 'Tool use', value: CATALOGUE.pools.tool },
    { label: 'Agentic', value: CATALOGUE.pools.agentic },
  ];

  /** POLICY's own keys and `why`, compressed to fit a tile. No figure changed. */
  const LABEL: Record<string, string> = {
    'Price weight, capped at': 'price weight, capped',
    'Open-weight bonus': 'open-weight bonus',
    'Success bias': 'success bias',
    'Prior for unrated models': 'prior, unrated',
    'Price ceiling': 'price ceiling',
    'Minimum context': 'minimum context',
  };
  // NB: CATALOGUE.lowCeiling counts models whose OUTPUT ceiling sits under the reasoning
  // floor (see turn/cost). It is not a count of models under this context minimum — do not
  // borrow it here.
  const WHY: Record<string, string> = {
    'Price weight, capped at': 'uncapped, cost dominates',
    'Open-weight bonus': "not one vendor's to withdraw",
    'Success bias': 'nudges, never decides',
    'Prior for unrated models': 'must earn its place',
    'Price ceiling': 'a hard stop',
    'Minimum context': 'the toolkit alone will not fit',
  };
  /** The two rules that exclude outright rather than reweight. */
  const HARD = new Set(['Price ceiling', 'Minimum context']);
</script>

<svelte:head>
  <title>Picking a model · The Engine Room</title>
  <meta name="description" content="Four ways a model gets chosen, the pool it is chosen from, and the many sellers behind one model name." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="turn"
    title="Picking a model"
    line="Asking for a model by name settles far less than you would hope. Four things get a vote, and the name is only one of them."
    lineEli5="Asking for an AI by name decides surprisingly little. Four things pick it, and several different companies might end up running it." />

  <Instrument
    kicker="The chooser"
    title="Four ways a model gets chosen"
    tone={TONE}
    reading="Four layers, in precedence order."
    takeaway="First match wins. Only the bottom layer re-scores itself overnight; the rest sit there until somebody changes their mind.">
    <ResolutionTrack tone={TONE} />
  </Instrument>

  <Instrument
    kicker="Who serves it"
    title="One name, many sellers"
    tone={TONE}
    reading="Same model id, different shop. Choose how one gets picked and see who you end up with."
    takeaway="{SELLER_FACTS.mixDefault.fp8} full precision, {SELLER_FACTS.mixDefault.unknown} unstated, {SELLER_FACTS.mixDefault.fp4} quantised — of {SELLER_FACTS.endpointsDefault} sellers on the default model, {SELLER_FACTS.endpointsAgentic} on the agentic, {SELLER_FACTS.priceSpread} cheapest to dearest.">
    <SellerRoulette />
  </Instrument>

  <Instrument
    kicker="The pool"
    title="What is allowed to win"
    tone={TONE}
    reading="Narrowed by rule, then split by profile."
    takeaway="Price gets a weighting, not a free run — otherwise cheap and useless wins every time. Two of these rules do not negotiate at all.">
    <Bars items={NARROWING} tone={TONE} />

    <p class="sub">Per-profile shortlist</p>
    <Bars items={POOLS} tone="var(--accent)" grouped={false} height={20} />

    <p class="sub">Scoring rules</p>
    <div class="tiles">
      {#each POLICY as p (p.k)}
        <Stat value={p.v} label={LABEL[p.k] ?? p.k} how={WHY[p.k] ?? p.why}
              tone={HARD.has(p.k) ? 'var(--accent)' : TONE} />
      {/each}
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .sub { margin: 16px 0 7px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.13em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 7px; }
</style>
