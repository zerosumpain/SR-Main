<script lang="ts">
  // CoordinationCost — ILLUSTRATIVE, NOT ENGINE-COUPLED. Two effects of fragmentation, made
  // tangible. (1) Coordination edges: N agencies holding pieces of one child have up to
  // N·(N−1)/2 pairwise hand-offs to maintain — the count grows quadratically, which is why
  // "just add another partner" gets expensive. (2) Duplicate collection: a duplication rate
  // applied to a referral volume, costed at the ~2.5 staff-hours per referral that surfacing
  // "who already knows this family" reportedly saves (Family Context, Social Finance). The
  // privacy/exposure side is anchored to ContactPoint (~£224m build, ~330k–390k users, ~11m
  // records). Every number is a labelled assumption; this does NOT read the policy engine.
  // Self-contained, Svelte 5 runes, bespoke SVG.
  import { app } from '../lib/appState.svelte';
  import { ILLUSTRATIVE_PARAMS } from '../lib/jigsawIntel';
  import ConfidenceBadge from './ConfidenceBadge.svelte';

  const eli = $derived(app.narrative === 'eli5');

  // ---- controls (illustrative) ----
  let agencies = $state(6);     // services holding a piece of one child (~4-8)
  let dupRate = $state(30);     // duplicate-collection rate, % of referrals
  let referrals = $state(50);   // illustrative monthly referral volume for one front door

  const AMIN = ILLUSTRATIVE_PARAMS.agenciesPerChild.low;   // 4
  const AMAX = ILLUSTRATIVE_PARAMS.agenciesPerChild.high;  // 8
  const HOURS_PER_DUP = ILLUSTRATIVE_PARAMS.duplication.perReferralHoursSaved; // 2.5
  const HOURLY = 22; // illustrative loaded staff cost, £/hr — labelled assumption

  // (1) coordination edges grow as N·(N−1)/2
  const edges = $derived((agencies * (agencies - 1)) / 2);

  // (2) duplicate-collection cost (illustrative)
  const dupTouches = $derived(Math.round(referrals * (dupRate / 100)));
  const dupHours = $derived(dupTouches * HOURS_PER_DUP);
  const dupCostMo = $derived(dupHours * HOURLY);
  const dupCostYr = $derived(dupCostMo * 12);

  const fmt = (v: number) => Math.round(v).toLocaleString('en-GB');
  const gbp = (v: number) => v >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${Math.round(v)}`;

  // ---- edge graph geometry: N nodes on a circle, all pairwise edges drawn ----
  const GW = 260, GR = 92, GCX = 130, GCY = 130;
  const nodes = $derived.by(() => {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < agencies; i++) {
      const a = -Math.PI / 2 + (i / agencies) * 2 * Math.PI;
      out.push({ x: GCX + GR * Math.cos(a), y: GCY + GR * Math.sin(a) });
    }
    return out;
  });
  const edgeLines = $derived.by(() => {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        out.push({ x1: nodes[i].x, y1: nodes[i].y, x2: nodes[j].x, y2: nodes[j].y });
    return out;
  });

  const cp = ILLUSTRATIVE_PARAMS.contactPoint;
</script>

<div class="cc">
  <div class="cc-flag">
    <span class="cc-flag-lab">ILLUSTRATIVE · NOT ENGINE-COUPLED</span>
    <ConfidenceBadge level="assumption" note="No published national figure exists for agencies-per-child or duplicate-collection rate; the hourly cost and the per-referral hours are labelled assumptions." small />
  </div>

  <div class="cc-ctl">
    <div class="ctl">
      <span class="ctl-lab">{eli ? 'Services holding a piece' : 'Agencies per child'}</span>
      <input type="range" min={AMIN} max={AMAX} step="1" bind:value={agencies}
        aria-label="Number of agencies holding a piece of one child" style="--c:#2f6f97" />
      <span class="ctl-val">{agencies}</span>
    </div>
    <div class="ctl">
      <span class="ctl-lab">{eli ? 'How often work is duplicated' : 'Duplicate-collection rate'}</span>
      <input type="range" min="0" max="80" step="1" bind:value={dupRate}
        aria-label="Duplicate-collection rate, percent of referrals" style="--c:#b1455e" />
      <span class="ctl-val">{dupRate}%</span>
    </div>
    <div class="ctl">
      <span class="ctl-lab">{eli ? 'Referrals a month (one front door)' : 'Referrals / month (one front door)'}</span>
      <input type="range" min="10" max="200" step="5" bind:value={referrals}
        aria-label="Monthly referral volume for one front door" style="--c:#9a7b1f" />
      <span class="ctl-val">{referrals}</span>
    </div>
  </div>

  <div class="cc-row">
    <div class="cc-graph">
      <svg viewBox="0 0 {GW} {GW}" role="img"
        aria-label="Agencies as nodes with every pairwise coordination link drawn between them">
        {#each edgeLines as e (e.x1 + '-' + e.y1 + '-' + e.x2 + '-' + e.y2)}
          <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} class="edge" />
        {/each}
        {#each nodes as n, i (i)}
          <circle cx={n.x} cy={n.y} r="9" class="node" />
        {/each}
      </svg>
      <div class="g-read">
        <span class="gv">{edges}</span>
        <span class="gl">{eli ? 'two-way links to keep working' : 'pairwise coordination links'}</span>
        <span class="gb">{eli ? 'add one service and the links jump' : 'N·(N−1)/2 — grows quadratically with N'}</span>
      </div>
    </div>

    <div class="cc-cost">
      <div class="cost-cards">
        <div class="kcard">
          <span class="kv">{fmt(dupTouches)}</span>
          <span class="kl">{eli ? 'duplicated touches a month' : 'duplicate touches / month'}</span>
        </div>
        <div class="kcard">
          <span class="kv">{fmt(dupHours)}</span>
          <span class="kl">{eli ? 'staff-hours a month' : 'staff-hours / month'}</span>
          <span class="kb">@ {HOURS_PER_DUP}h each</span>
        </div>
        <div class="kcard hi">
          <span class="kv">{gbp(dupCostYr)}</span>
          <span class="kl">{eli ? 'illustrative cost a year, one front door' : 'illustrative cost / yr, one front door'}</span>
          <span class="kb">@ £{HOURLY}/hr loaded</span>
        </div>
      </div>
      <p class="cost-note">{eli
        ? 'This is one council’s front door. Multiply across ~150 local authorities and the duplicated effort is large — but the exact number is unknown, so treat this as a shape, not a figure.'
        : 'Per single front door. Scaled across ~150 LAs the aggregate is material — but there is no measured national duplication rate, so this is a magnitude device, not an estimate.'}</p>
    </div>
  </div>

  <div class="cc-anchor">
    <span class="an-lab">{eli ? 'The other side of the ledger: the privacy cost' : 'The countervailing cost: privacy / exposure'}</span>
    <p>{eli
      ? `Joining everything has its own price. The last national attempt — ContactPoint — cost about £${cp.buildCostM}m to build, held records on ~${(cp.recordsM)}m children, and was reachable by ~${fmt(cp.usersLow)}–${fmt(cp.usersHigh)} people across ${cp.las} councils. It was switched off in 2010 over cost and privacy. So more joining buys safeguarding signal AND spends money, privacy and public trust.`
      : `The duplication cost above is only one side. A maximal "join everything" design carries an exposure cost: ContactPoint (2009–10) cost ~£${cp.buildCostM}m to build, held ~${cp.recordsM}m children's records, and was accessible to ~${fmt(cp.usersLow)}–${fmt(cp.usersHigh)} users across ${cp.las} LAs before being switched off on cost and proportionality grounds. Each increment of coverage buys safeguarding signal and spends money, privacy and public-trust capital — and ECHR Article 8 (Christian Institute v Lord Advocate) sets a proportionality ceiling, not just a preference.`}</p>
    <div class="an-refs">
      <a class="rc" href="https://en.wikipedia.org/wiki/ContactPoint" target="_blank" rel="noopener">ContactPoint — cost & reach ↗</a>
      <a class="rc" href="https://www.socialfinance.org.uk/projects/family-context" target="_blank" rel="noopener">Family Context — ~2.5h/referral ↗</a>
    </div>
  </div>

  <div class="cc-assume">
    <span class="as-lab">{eli ? 'What this toy assumes' : 'Assumptions (each labelled, none measured)'}</span>
    <ul>
      <li><b>{eli ? 'Services per child' : 'Agencies per child'} ({AMIN}–{AMAX}):</b> {eli ? 'a guess at how many services hold a piece — no real average is published.' : 'the agencies-per-child modelling assumption; no authoritative national mean exists.'}</li>
      <li><b>{eli ? 'Time per duplicate' : 'Hours per duplicate'} ({HOURS_PER_DUP}h):</b> {eli ? 'based on the time one tool reportedly saved per referral by showing who already knows the family.' : 'anchored to the ~2.5h/referral Family Context (Social Finance) reportedly saved; an order-of-magnitude anchor, not a measured duplicate cost.'}</li>
      <li><b>{eli ? 'Hourly cost' : 'Loaded hourly cost'} (£{HOURLY}):</b> {eli ? 'a round number for staff time — change it and the pounds change.' : 'an illustrative loaded staff rate; not a costed figure.'}</li>
      <li><b>{eli ? 'It is not connected to the model' : 'Not engine-coupled'}:</b> {eli ? 'this little tool stands alone and changes no result on the rest of the site.' : 'this reads no policy-engine outcome and feeds none back.'}</li>
    </ul>
  </div>
</div>

<style>
  .cc { display: flex; flex-direction: column; gap: 13px; }
  .cc-flag { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .cc-flag-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
    color: var(--accent-ink); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); padding: 2px 7px; }

  .cc-ctl { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px;
    padding: 12px 14px; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.42); }
  .ctl { display: flex; align-items: center; gap: 9px; }
  .ctl-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em;
    color: rgba(28,22,17,0.6); flex: 1 1 auto; }
  .ctl input { flex: 1 1 80px; min-width: 80px; accent-color: var(--c); }
  .ctl-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; color: var(--ink); min-width: 44px; text-align: right; }

  .cc-row { display: grid; grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.2fr); gap: 12px; align-items: stretch; }
  @media (max-width: 760px) { .cc-row { grid-template-columns: 1fr; } }
  .cc-graph { display: flex; flex-direction: column; align-items: center; gap: 6px; background: rgba(255,255,255,0.4);
    border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 10px 12px; }
  .cc-graph svg { display: block; width: 100%; max-width: 240px; height: auto; }
  .edge { stroke: rgba(177,69,94,0.4); stroke-width: 1; }
  .node { fill: #2f6f97; stroke: var(--paper); stroke-width: 2; }
  .g-read { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1px; }
  .gv { font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; line-height: 1; color: #8a2d3a; }
  .gl { font-size: 11px; color: rgba(28,22,17,0.66); }
  .gb { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.45); }

  .cc-cost { display: flex; flex-direction: column; gap: 8px; }
  .cost-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 9px; }
  .kcard { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.42); }
  .kcard.hi { border-left: 3px solid #9a7b1f; background: rgba(154,123,31,0.06); }
  .kv { font-family: 'Fraunces', serif; font-weight: 600; font-size: 24px; line-height: 1; color: var(--ink); }
  .kcard.hi .kv { color: #8a6a12; }
  .kl { font-size: 10.5px; line-height: 1.3; color: rgba(28,22,17,0.66); }
  .kb { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.45); }
  .cost-note { margin: 0; font-size: 11px; line-height: 1.5; color: rgba(28,22,17,0.6); }

  .cc-anchor { border: 1px solid var(--accent-ink-tint-35); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-round); background: var(--accent-ink-tint-06); padding: 11px 14px; }
  .an-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--accent-ink); font-weight: 600; margin-bottom: 6px; }
  .cc-anchor p { margin: 0 0 8px; font-size: 12px; line-height: 1.55; color: rgba(28,22,17,0.78); }
  .an-refs { display: flex; gap: 6px; flex-wrap: wrap; }
  .rc { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: var(--accent-ink); text-decoration: none;
    border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); padding: 2px 7px; background: var(--accent-ink-tint-06); }

  .cc-assume { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.35); padding: 11px 14px; }
  .as-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
    color: rgba(28,22,17,0.55); font-weight: 600; margin-bottom: 7px; }
  .cc-assume ul { margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 5px; }
  .cc-assume li { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .cc-assume b { color: var(--ink); }
</style>
