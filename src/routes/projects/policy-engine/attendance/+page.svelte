<script lang="ts">
  // Attendance — Field Study №8: the leading indicator. England's biggest
  // post-COVID schooling problem and its biggest data success, on one page —
  // with the open evidence question (has the instrument changed outcomes?) at
  // the centre rather than an attribution claim.
  import { app } from '../lib/appState.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import { STORIES } from '../lib/stories';
  import {
    ATT_HERO, DIALS, WHO_STATS, EBSA_NOTE, INSTRUMENT, VERDICT, FINES, DOWNSTREAM,
    EVIDENCE_NOTE, SOCIAL_CONTRACT, COMPARATORS, ATT_ASKS, ATT_CLOSER,
  } from '../lib/attendanceIntel';

  const eli = $derived(app.narrative === 'eli5');

  // dial mini-chart geometry
  const D = { w: 300, h: 170, padL: 14, padT: 38, barW: 52, gap: 16, padB: 30 };
  const dialMax = (d: { data: { v: number }[] }) => Math.max(...d.data.map((p) => p.v)) * 1.18;
</script>

<svelte:head><title>Attendance — the leading indicator · Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.attendance} />

  <!-- ===================== 1 · the number ===================== -->
  <section class="block">
    <h2 class="pe-h2">1 · The number that frames everything</h2>
    <div class="heroA">
      <span class="hA-big">{ATT_HERO.big}</span>
      <p class="hA-lab">{eli ? ATT_HERO.labelEli5 : ATT_HERO.label}</p>
    </div>
    <p class="hA-kicker">{eli ? ATT_HERO.kicker.eli5 : ATT_HERO.kicker.research}</p>
    <div class="refrow">
      {#each ATT_HERO.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 2 · the three dials ===================== -->
  <section class="block">
    <h2 class="pe-h2">2 · The three dials — two recovering, one still rising</h2>
    <p class="cap">
      {eli
        ? 'Three ways of measuring missed school. The first two are getting better (though nowhere near back to normal). The third — children missing more than half of school — keeps climbing.'
        : 'The same problem measured on three thresholds (DfE full-year series). The composition is the finding: the marginal absentee is returning; the child furthest from school is not. The headline average conceals this divergence.'}
    </p>
    <div class="dials">
      {#each DIALS as d (d.title)}
        {@const mx = dialMax(d)}
        <div class="dial" class:bad={d.trend === 'rising'}>
          <div class="dial-head">
            <span class="dial-t">{eli ? d.eli5 : d.title}</span>
            <span class="dial-trend" class:up={d.trend === 'rising'}>{d.trend === 'rising' ? '▲ still rising' : '▼ improving'}</span>
          </div>
          <svg viewBox="0 0 {D.w} {D.h}" role="img" aria-label="{d.title} trend">
            {#each d.data as p, i (p.y)}
              {@const bh = (p.v / mx) * (D.h - D.padT - D.padB)}
              {@const x = D.padL + i * (D.barW + D.gap)}
              <rect {x} y={D.h - D.padB - bh} width={D.barW} height={bh} rx="4"
                    class="dbar" class:first={i === 0} class:last={i === d.data.length - 1} />
              <text x={x + D.barW / 2} y={D.h - D.padB - bh - 6} class="dval" text-anchor="middle">{p.label}</text>
              <text x={x + D.barW / 2} y={D.h - 10} class="dax" text-anchor="middle">{p.y.slice(2)}</text>
            {/each}
          </svg>
          <p class="dial-note">{d.note}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- ===================== 3 · who is absent ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · Who is absent — disadvantage, SEND, illness</h2>
    <div class="stat-tiles">
      {#each WHO_STATS as s (s.big)}
        <div class="st"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>
    <div class="aside">
      <span class="aside-lab">△ A caution on the evidence</span>
      <p>{eli ? EBSA_NOTE.eli5 : EBSA_NOTE.research}</p>
      <div class="refrow">
        {#each EBSA_NOTE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
      </div>
    </div>
  </section>

  <!-- ===================== 4 · the instrument ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · The instrument — before and after</h2>
    <p class="cap">
      {eli
        ? 'In 2024 attendance became the one thing the government sees daily, from nearly every school. Here’s what changed.'
        : 'The estate’s one genuine near-real-time asset, built in under three years from voluntary trial to statutory feed. The before/after is the proof — cited throughout this project — that data cadence is a design choice, not a law of nature.'}
    </p>
    <div class="ba">
      <div class="ba-col before">
        <span class="ba-t">{INSTRUMENT.before.title}</span>
        <ul>{#each INSTRUMENT.before.points as p (p)}<li>{p}</li>{/each}</ul>
      </div>
      <div class="ba-col after">
        <span class="ba-t">{INSTRUMENT.after.title}</span>
        <ul>{#each INSTRUMENT.after.points as p (p)}<li>{p}</li>{/each}</ul>
      </div>
    </div>
    <div class="aside warn">
      <span class="aside-lab">⚖ The trust account</span>
      <p>{eli ? INSTRUMENT.caveat.eli5 : INSTRUMENT.caveat.research}</p>
    </div>
    <div class="refrow">
      {#each INSTRUMENT.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 5 · the verdict ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · Has the instrument changed outcomes? On current evidence: unproven</h2>
    <div class="verdict">
      <div class="v-col claim">
        <span class="v-t">{eli ? 'What the government says' : 'The claim'}</span>
        <p>{eli ? VERDICT.claim.eli5 : VERDICT.claim.research}</p>
      </div>
      <div class="v-col counter">
        <span class="v-t">{eli ? 'What the evidence supports' : 'The evidence that qualifies the attribution'}</span>
        <p>{eli ? VERDICT.counter.eli5 : VERDICT.counter.research}</p>
      </div>
    </div>
    <div class="refrow">
      {#each VERDICT.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 6 · the fines machine ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · The fines machine — half a million notices, zero evaluations</h2>
    <div class="stat-tiles">
      {#each FINES.stats as s (s.big)}
        <div class="st warn"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>
    <p class="note">{eli ? FINES.verdict.eli5 : FINES.verdict.research}</p>
    <div class="refrow">
      {#each FINES.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 7 · downstream ===================== -->
  <section class="block">
    <h2 class="pe-h2">7 · Why it matters — the downstream ledger</h2>
    <div class="stat-tiles">
      {#each DOWNSTREAM as s (s.big)}
        <div class="st">
          <span class="st-big">{s.big}</span>
          <p class="st-lab">{eli ? s.eli5 : s.label}</p>
          {#if s.link}<a class="st-link" href={s.link.href}>{s.link.label}</a>{/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- ===================== 8 · what works ===================== -->
  <section class="block">
    <h2 class="pe-h2">8 · What works — the startlingly thin evidence</h2>
    <p class="note">{eli ? EVIDENCE_NOTE.eli5 : EVIDENCE_NOTE.research}</p>
    <div class="refrow">
      {#each EVIDENCE_NOTE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
    <div class="aside">
      <span class="aside-lab">◉ The demand side</span>
      <p>{eli ? SOCIAL_CONTRACT.eli5 : SOCIAL_CONTRACT.research}</p>
      <div class="refrow">
        {#each SOCIAL_CONTRACT.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
      </div>
    </div>
  </section>

  <!-- ===================== 9 · comparators ===================== -->
  <section class="block">
    <h2 class="pe-h2">9 · The comparators — typical recovery, missing caseworker</h2>
    <div class="comp-cards">
      {#each COMPARATORS as c (c.name)}
        <article class="comp">
          <span class="comp-name">{c.name}</span>
          <p class="comp-what">{eli ? c.eli5 : c.what}</p>
          <p class="comp-verdict">▸ {c.verdict}</p>
        </article>
      {/each}
    </div>
  </section>

  <!-- ===================== 10 · open evidence questions ===================== -->
  <section class="block">
    <h2 class="pe-h2">10 · The highest-frequency collection in the estate — three open evidence questions</h2>
    <div class="asks">
      {#each ATT_ASKS as a, i (a.ask)}
        <div class="ask">
          <span class="ask-n">{i + 1}</span>
          <div class="ask-body">
            <span class="ask-t">{a.ask}</span>
            <p class="ask-w">{eli ? a.eli5 : a.what}</p>
          </div>
        </div>
      {/each}
    </div>
    <div class="closer">
      <p>{eli ? ATT_CLOSER.eli5 : ATT_CLOSER.research}</p>
    </div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/memo">Where this lands in the synthesis → The Memo</a>
</div>

<style>
  .block { margin: 34px 0; }
  .cap { margin: 0 0 16px; font-size: 14.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 92ch; }
  .note { margin: 12px 0 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.76); max-width: 96ch; }

  /* hero */
  .heroA { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 18px 22px; border-radius: 14px;
    border: 1.5px solid rgba(177,69,94,0.45); background: rgba(177,69,94,0.06); max-width: 96ch; }
  .hA-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(44px, 7.5vw, 80px); line-height: 0.9; color: #8a2d3a; }
  .hA-lab { margin: 0; flex: 1 1 320px; font-size: 15px; line-height: 1.55; color: rgba(28,22,17,0.8); }
  .hA-kicker { margin: 12px 0 0; font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 96ch; }

  /* dials */
  .dials { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 12px; }
  .dial { border: 1px solid rgba(28,22,17,0.14); border-radius: 12px; background: rgba(255,255,255,0.45); padding: 12px 14px; }
  .dial.bad { border-color: rgba(177,69,94,0.45); background: rgba(177,69,94,0.04); }
  .dial-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
  .dial-t { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13.5px; color: var(--ink, #1c1611); }
  .dial-trend { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; color: #2f7d4f; }
  .dial-trend.up { color: #8a2d3a; }
  .dial svg { display: block; width: 100%; height: auto; }
  .dbar { fill: rgba(28,22,17,0.35); }
  .dbar.first { fill: rgba(47,125,79,0.55); }
  .dbar.last { fill: rgba(138,45,58,0.75); }
  .dval { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; fill: var(--ink, #1c1611); }
  .dax { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; fill: rgba(28,22,17,0.55); }
  .dial-note { margin: 6px 0 0; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.66); }

  /* stat tiles */
  .stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 10px; margin-top: 4px; }
  .st { border: 1px solid rgba(28,22,17,0.14); border-radius: 10px; background: rgba(255,255,255,0.45); padding: 12px 14px; }
  .st.warn { border-color: rgba(177,69,94,0.4); background: rgba(177,69,94,0.04); }
  .st-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(19px, 2.8vw, 25px); color: var(--ink, #1c1611); }
  .st.warn .st-big { color: #8a2d3a; }
  .st-lab { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.72); }
  .st-link { display: inline-block; margin-top: 7px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }

  /* asides */
  .aside { margin-top: 14px; border: 1px dashed rgba(28,22,17,0.35); border-radius: 10px; background: rgba(28,22,17,0.035); padding: 12px 15px; max-width: 96ch; }
  .aside.warn { border-color: rgba(154,123,31,0.55); background: rgba(154,123,31,0.05); }
  .aside-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; color: rgba(28,22,17,0.6); margin-bottom: 5px; }
  .aside p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); }

  /* before/after */
  .ba { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: 12px; max-width: 96ch; }
  .ba-col { border-radius: 12px; padding: 13px 16px; }
  .ba-col.before { border: 1px solid rgba(28,22,17,0.2); background: rgba(28,22,17,0.04); }
  .ba-col.after { border: 1.5px solid rgba(47,125,79,0.5); background: rgba(47,125,79,0.05); }
  .ba-t { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); margin-bottom: 7px; }
  .ba-col ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
  .ba-col li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.76); }

  /* verdict */
  .verdict { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: 12px; max-width: 96ch; }
  .v-col { border-radius: 12px; padding: 13px 16px; }
  .v-col.claim { border: 1px solid rgba(47,111,151,0.4); background: rgba(47,111,151,0.05); }
  .v-col.counter { border: 1.5px solid rgba(177,69,94,0.5); background: rgba(177,69,94,0.05); }
  .v-t { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
  .v-col.claim .v-t { color: #2f6f97; }
  .v-col.counter .v-t { color: #8a2d3a; }
  .v-col p { margin: 0; font-size: 12.5px; line-height: 1.58; color: rgba(28,22,17,0.78); }

  /* comparators */
  .comp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap: 12px; }
  .comp { border: 1px solid rgba(28,22,17,0.14); border-top: 3px solid #2f6f97; border-radius: 10px; background: rgba(255,255,255,0.42); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
  .comp-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); }
  .comp-what { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .comp-verdict { margin: 0; font-size: 11.5px; line-height: 1.45; font-weight: 600; color: #2f6f97; }

  /* asks + closer */
  .asks { display: flex; flex-direction: column; gap: 9px; max-width: 96ch; margin-bottom: 14px; }
  .ask { display: flex; gap: 12px; align-items: flex-start; border: 1px solid rgba(47,125,79,0.3); border-radius: 10px; padding: 11px 14px; background: rgba(47,125,79,0.04); }
  .ask-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: #2f7d4f; color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
  .ask-body { display: flex; flex-direction: column; gap: 3px; }
  .ask-t { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); }
  .ask-w { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .closer { border: 1px solid rgba(74,124,124,0.35); border-left: 3px solid #4a7c7c; border-radius: 10px;
    background: rgba(74,124,124,0.06); padding: 13px 16px; max-width: 96ch; }
  .closer p { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }

  /* citation chips */
  .refrow { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .refchip { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: #2f6f97; text-decoration: none;
    border: 1px solid rgba(47,111,151,0.3); border-radius: 5px; padding: 2px 7px; background: rgba(47,111,151,0.05); }
  .refchip:hover { border-color: #2f6f97; background: rgba(47,111,151,0.1); }
</style>
