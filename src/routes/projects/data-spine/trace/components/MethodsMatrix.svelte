<script lang="ts">
  // MethodsMatrix — the methodologies in play, mapped onto the six stages.
  //
  // The matrix is the selector: rows are methods, columns are stages, a filled cell
  // means "this method governs that stage". Picking a row cascades the governed stages
  // left-to-right and opens the detail — including the `notFor` field, which is the
  // point of the whole component: every one of these techniques is oversold somewhere.
  import { METHODS, STAGES, LAYERS, OPENSAFELY, OPENSAFELY_SCHOOLS, say, type Depth, type MethodId } from '../lib/trace';
  import ConfidenceBadge from '../../components/ConfidenceBadge.svelte';

  let { depth = 'official' as Depth }: { depth?: Depth } = $props();

  let selId = $state<MethodId>('compute-to-data');
  const sel = $derived(METHODS.find((m) => m.id === selId)!);
  const selLayer = $derived(LAYERS.find((l) => l.id === sel.layer)!);
  const eli = $derived(depth === 'eli5');

  const MATURITY: Record<string, { label: string; cls: string }> = {
    proven: { label: 'Proven in production', cls: 'mt-proven' },
    emerging: { label: 'Emerging', cls: 'mt-emerging' },
    research: { label: 'Research-stage', cls: 'mt-research' },
  };
</script>

<div class="mm">
  {#if eli}
    <!-- ============ ELI5: one table, no matrix ============ -->
    <div class="grid-scroll">
      <table class="e-tbl">
        <thead>
          <tr><th class="c-n">The trick</th><th>What it actually is</th><th class="c-x">What it can’t do</th></tr>
        </thead>
        <tbody>
          {#each METHODS as m}
            <tr>
              <th class="c-n">{m.eli5Name}<span class="real">{m.name}</span></th>
              <td>{m.eli5}</td>
              <td class="c-x">{m.eli5NotFor}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="e-note">
        Every one of these is genuinely useful and every one is oversold somewhere — which is why the
        third column exists. None of them is the hard part: the hard part is agreeing what the words mean.
      </p>
    </div>
  {:else}
  <!-- ============ THE MATRIX ============ -->
  <div class="grid-scroll">
    <div class="grid" style="--cols:{STAGES.length}">
      <div class="gh corner">METHOD</div>
      {#each STAGES as st}
        <div class="gh"><span class="gh-no">{st.no}</span>{st.name}</div>
      {/each}

      {#each METHODS as m}
        <button class="mrow-lab" class:on={m.id === selId} onclick={() => (selId = m.id)}>
          <span class="short">{m.short}</span>
          <span class="nm">{m.name}</span>
        </button>
        {#key selId}
          {#each STAGES as st, si}
            {@const hit = m.stages.includes(st.id)}
            <button class="gcell" class:on={m.id === selId} class:hit
              aria-label="{m.name} — {hit ? 'governs' : 'does not govern'} {st.name}"
              onclick={() => (selId = m.id)}>
              {#if hit}
                <span class="pip" class:live={m.id === selId} style="animation-delay:{si * 70}ms"></span>
              {/if}
            </button>
          {/each}
        {/key}
      {/each}
    </div>
  </div>

  <!-- ============ THE DETAIL ============ -->
  <div class="detail">
    <div class="d-head">
      <span class="d-short">{sel.short}</span>
      <h4>{sel.name}</h4>
      <span class="mt {MATURITY[sel.maturity].cls}">{MATURITY[sel.maturity].label}</span>
      <ConfidenceBadge level={sel.confidence} small />
      <span class="d-layer">Lives on L{selLayer.no} · {selLayer.name}</span>
    </div>

    <div class="d-cols">
      <div class="dcol">
        <span class="dl">What it is</span>
        <p>{sel.what}</p>
        <span class="dl tight">What it solves</span>
        <p>{sel.solves}</p>
      </div>
      <div class="dcol">
        <span class="dl">Where it already runs</span>
        <p class="prec">{sel.precedent}</p>
        <span class="dl tight">What it costs</span>
        <p>{sel.cost}</p>
      </div>
      <div class="dcol warn">
        <span class="dl">What it does <em>not</em> do</span>
        <p>{sel.notFor}</p>
      </div>
    </div>
  </div>
  {/if}

  <!-- ============ OPENSAFELY ============ -->
  <div class="os">
    <div class="os-head">
      <div>
        <span class="os-kick">CASE STUDY · ENGLAND, 2020 →</span>
        <h4>{OPENSAFELY.title}</h4>
        <p class="os-strap">{OPENSAFELY.strap}</p>
      </div>
      <ConfidenceBadge level={OPENSAFELY.confidence} note="A documented, operating platform — not a proposal." />
    </div>

    <p class="os-body">{say(OPENSAFELY, depth)}</p>

    <div class="os-cols">
      <div class="osc proves">
        <span class="osc-lab">✓ What it proves for a data spine</span>
        {#each OPENSAFELY.proves as p}
          <div class="pt"><b>{p.k}</b><span>{p.v}</span></div>
        {/each}
      </div>
      <div class="osc limits">
        <span class="osc-lab">△ What it does <em>not</em> prove</span>
        {#each OPENSAFELY.limits as p}
          <div class="pt"><b>{p.k}</b><span>{p.v}</span></div>
        {/each}
      </div>
    </div>

    <p class="os-foot">
      The useful conclusion is narrow and strong: <b>the privacy technology is not the risky part.</b>
      Compute-to-data, output checking and code-in-the-open are operating today, in England, at national
      scale. What education has that health did not is a fragmented supplier estate and a thinner set of
      shared definitions — which is why the hard work on the next screen is <em>onboarding</em>, not cryptography.
    </p>
  </div>

  <!-- ============ OPENSAFELY SCHOOLS ============ -->
  <div class="oss">
    <div class="oss-head">
      <div>
        <span class="oss-kick">AND THEY HAVE ALREADY TRIED IT ON SCHOOLS</span>
        <h4>{OPENSAFELY_SCHOOLS.title}</h4>
        <p class="oss-strap">{OPENSAFELY_SCHOOLS.strap}</p>
      </div>
      <ConfidenceBadge level={OPENSAFELY_SCHOOLS.confidence} note="A documented, funded programme with published findings." />
    </div>

    <p class="oss-body">{say(OPENSAFELY_SCHOOLS, depth)}</p>

    <div class="facts">
      {#each OPENSAFELY_SCHOOLS.facts as f}
        <div class="fact"><b>{f.k}</b><span>{f.v}</span></div>
      {/each}
    </div>

    <span class="oss-lab">WHAT THEY FOUND WHEN THEY MOVED FROM HEALTH DATA TO SCHOOLS DATA</span>
    <div class="tbl-wrap">
      <table class="l-tbl">
        <thead>
          <tr><th class="c-n">What they hit</th><th>What happened</th><th class="c-s">Why it matters for a national spine</th></tr>
        </thead>
        <tbody>
          {#each OPENSAFELY_SCHOOLS.lessons as l}
            <tr>
              <th class="c-n">{l.k}</th>
              <td>{l.v}</td>
              <td class="c-s">{l.soWhat}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <p class="oss-caveat"><b>△ And the honest limit.</b> {OPENSAFELY_SCHOOLS.caveat}</p>
  </div>
</div>

<style>
  .mm { border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-sharp); background: var(--surface-elevated, #e8dece); overflow: hidden; }

  /* matrix */
  .grid-scroll { overflow-x: auto; padding: 14px 16px 10px; }
  .grid { display: grid; grid-template-columns: 190px repeat(var(--cols), minmax(88px, 1fr)); gap: 3px; min-width: 720px; }

  .gh { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase;
    color: rgba(26,16,8,0.66); padding: 0 4px 6px; align-self: end; line-height: 1.3; }
  .gh-no { display: inline-block; font-weight: 600; color: var(--accent-ink, #0e5b66); margin-right: 4px; }
  .gh.corner { color: rgba(26,16,8,0.5); }

  .mrow-lab { display: flex; align-items: center; gap: 8px; text-align: left; background: #ffffff;
    border: 1.4px solid rgba(26,16,8,0.32); border-radius: var(--radius-sharp); padding: 6px 9px; cursor: pointer; }
  .mrow-lab:hover { border-color: var(--accent-ink, #0e5b66); }
  .mrow-lab.on { background: var(--accent-ink, #0e5b66); border-color: var(--accent-ink, #0e5b66); }
  .short { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.06em;
    color: var(--accent-ink, #0e5b66); background: rgba(14,91,102,0.1); border-radius: 2px; padding: 2px 4px; flex: 0 0 auto; }
  .mrow-lab.on .short { color: #0e5b66; background: #cfe6e4; }
  .nm { font-family: var(--font-body); font-size: var(--fs-label-xs); font-weight: 500; color: var(--ink); line-height: 1.2; }
  .mrow-lab.on .nm { color: #ffffff; font-weight: 600; }

  .gcell { background: #ffffff; border: 1.2px solid rgba(26,16,8,0.16); border-radius: var(--radius-sharp);
    min-height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
  .gcell:hover { border-color: rgba(26,16,8,0.4); }
  .gcell.hit { background: rgba(14,91,102,0.07); border-color: rgba(14,91,102,0.28); }
  .gcell.on.hit { background: #cfe6e4; border-color: var(--accent-ink, #0e5b66); }
  .gcell.on { border-color: rgba(14,91,102,0.5); }
  .pip { width: 9px; height: 9px; border-radius: var(--radius-pill, 100px); background: rgba(14,91,102,0.45); display: block; }
  .pip.live { background: var(--accent-ink, #0e5b66); animation: mm-pop 0.5s cubic-bezier(0.22,1,0.36,1) both; }
  @keyframes mm-pop { from { transform: scale(0.2); opacity: 0; } 60% { transform: scale(1.5); } to { transform: scale(1); opacity: 1; } }

  /* detail */
  .detail { background: #ffffff; border-top: 1.5px solid rgba(26,16,8,0.4); padding: 14px 18px 16px; }
  .d-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 12px; }
  .d-short { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.08em;
    color: #ffffff; background: var(--accent-ink, #0e5b66); border-radius: 2px; padding: 3px 6px; }
  .d-head h4 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(18px, 2.2vw, 24px); margin: 0; color: var(--ink); }
  .mt { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; border-radius: var(--radius-sharp); padding: 2px 6px; }
  .mt-proven { color: #216b3f; background: rgba(47,125,79,0.12); border: 1px solid rgba(47,125,79,0.4); }
  .mt-emerging { color: #8c5a10; background: #fdf4e6; border: 1px solid rgba(168,112,26,0.45); }
  .mt-research { color: #6d4d8f; background: rgba(122,90,166,0.1); border: 1px solid rgba(122,90,166,0.4); }
  .d-layer { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; color: rgba(26,16,8,0.6); margin-left: auto; }

  .d-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
  .dcol { border-left: 2px solid rgba(26,16,8,0.16); padding-left: 11px; }
  .dcol.warn { border-left-color: rgba(138,45,58,0.45); }
  .dl { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(26,16,8,0.55); margin-bottom: 4px; }
  .dl.tight { margin-top: 10px; }
  .dl em { font-style: italic; color: #8a2d3a; }
  .dcol p { font-size: var(--fs-label); line-height: 1.55; color: rgba(26,16,8,0.84); margin: 0; }
  .dcol.warn p { color: #6d232d; }
  .dcol p.prec { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink, #0e5b66); line-height: 1.5; }

  /* OpenSAFELY */
  .os { border-top: 1.5px solid rgba(26,16,8,0.4); padding: 18px; background: var(--surface-elevated, #e8dece); }
  .os-head { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .os-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; color: var(--accent-ink, #0e5b66); }
  .os-head h4 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(24px, 3.4vw, 38px); line-height: 1.05; margin: 4px 0 6px; color: var(--ink); }
  .os-strap { font-family: var(--fs-serif); font-size: clamp(15px, 1.8vw, 19px); font-style: italic; line-height: 1.35; color: var(--accent-ink, #0e5b66); margin: 0; max-width: 100%; }
  .os-body { font-size: var(--fs-nav); line-height: 1.6; color: rgba(26,16,8,0.84); margin: 14px 0 16px; max-width: 100%; }

  .os-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
  .osc { background: #ffffff; border: 1.4px solid rgba(26,16,8,0.35); border-radius: var(--radius-sharp); padding: 12px 14px; }
  .osc.proves { border-left: 4px solid #2f7d4f; }
  .osc.limits { border-left: 4px solid #a8701a; }
  .osc-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600;
    letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 10px; }
  .osc.proves .osc-lab { color: #216b3f; }
  .osc.limits .osc-lab { color: #8c5a10; }
  .osc-lab em { font-style: italic; }
  .pt { margin-bottom: 10px; }
  .pt:last-child { margin-bottom: 0; }
  .pt b { display: block; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); line-height: 1.3; }
  .pt span { display: block; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(26,16,8,0.75); margin-top: 2px; }

  .os-foot { font-size: var(--fs-nav); line-height: 1.6; color: rgba(26,16,8,0.84); margin: 16px 0 0; max-width: 100%;
    padding-top: 14px; border-top: 1px solid rgba(26,16,8,0.18); }
  .os-foot b { color: var(--ink); }
  .os-foot em { font-style: italic; color: var(--accent-ink, #0e5b66); }

  /* ELI5 methods table */
  .e-tbl { width: 100%; min-width: 700px; border-collapse: collapse; }
  .e-tbl th, .e-tbl td { text-align: left; vertical-align: top; padding: 9px 11px; font-size: var(--fs-label); line-height: 1.5; border-bottom: 1px solid rgba(26,16,8,0.12); }
  .e-tbl thead th { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(26,16,8,0.55); border-bottom: 1.5px solid rgba(26,16,8,0.3); }
  .e-tbl tbody th.c-n { font-family: var(--font-body); font-weight: 600; color: var(--ink); width: 210px; }
  .e-tbl tbody th.c-n .real { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 400; letter-spacing: 0.06em; color: rgba(26,16,8,0.5); margin-top: 2px; }
  .e-tbl td { color: rgba(26,16,8,0.84); }
  .e-tbl td.c-x, .e-tbl th.c-x { width: 30%; color: #6d232d; }
  .e-note { font-size: var(--fs-label); line-height: 1.55; color: rgba(26,16,8,0.72); margin: 12px 0 4px; max-width: 100%; }

  /* OpenSAFELY Schools */
  .oss { border-top: 1.5px solid rgba(26,16,8,0.4); padding: 18px; background: #ffffff; }
  .oss-head { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .oss-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; color: #216b3f; }
  .oss-head h4 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(22px, 3vw, 34px); line-height: 1.05; margin: 4px 0 6px; color: var(--ink); }
  .oss-strap { font-family: var(--fs-serif); font-size: clamp(15px, 1.8vw, 19px); font-style: italic; line-height: 1.35; color: #216b3f; margin: 0; max-width: 100%; }
  .oss-body { font-size: var(--fs-nav); line-height: 1.6; color: rgba(26,16,8,0.84); margin: 14px 0 16px; max-width: 100%; }

  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .fact { border-left: 3px solid #2f7d4f; padding-left: 10px; }
  .fact b { display: block; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); line-height: 1.3; }
  .fact span { display: block; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(26,16,8,0.72); margin-top: 3px; }

  .oss-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(26,16,8,0.58); margin-bottom: 9px; }
  .tbl-wrap { overflow-x: auto; }
  .l-tbl { width: 100%; min-width: 700px; border-collapse: collapse; }
  .l-tbl th, .l-tbl td { text-align: left; vertical-align: top; padding: 10px 11px; font-size: var(--fs-label); line-height: 1.55; border-bottom: 1px solid rgba(26,16,8,0.12); }
  .l-tbl thead th { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(26,16,8,0.55); border-bottom: 1.5px solid rgba(26,16,8,0.3); }
  .l-tbl tbody th.c-n { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); width: 220px; }
  .l-tbl td { color: rgba(26,16,8,0.84); }
  .l-tbl td.c-s, .l-tbl th.c-s { width: 34%; color: var(--accent-ink, #0e5b66); }

  .oss-caveat { font-size: var(--fs-label); line-height: 1.6; color: #6f460b; background: #fdf4e6; border: 1px solid rgba(168,112,26,0.4);
    border-radius: var(--radius-sharp); padding: 11px 14px; margin: 18px 0 0; max-width: 100%; }
  .oss-caveat b { color: #8c5a10; }

  @media (max-width: 700px) {
    .grid-scroll { padding: 12px 12px 8px; }
    .detail, .os, .oss { padding-left: 12px; padding-right: 12px; }
    .d-layer { margin-left: 0; }
  }
</style>
