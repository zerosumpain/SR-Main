<script lang="ts">
  /**
   * T6 · Anatomy, T7 · Chronicle, T8 · Precedent — the section-scale three.
   *
   * They sit INSIDE a T1 or T2 beat rather than owning one, so they render
   * together here: a beat hands over its `sections` and each is drawn in its
   * own register.
   *
   * The stack diagram and the archetype key are two of only three licensed
   * homes for the categorical hues on the whole site. Nothing else in a study
   * may use them, and nothing here may use them on a claim.
   */
  import ConfidenceChip from '../ConfidenceChip.svelte';
  import { say, type Section, type Depth } from '../study';

  let { sections, depth = 'research' }: { sections: Section[]; depth?: Depth } = $props();

  const HUE: Record<string, string> = {
    identifier: 'var(--fs-cat-identifier)',
    operational: 'var(--fs-cat-operational)',
    standards: 'var(--fs-cat-standards)',
    trust: 'var(--fs-cat-trust)',
    // The fifth tag the schema allows. It shares operational's green: both are
    // "the plumbing", and a legend with five hues is one more than a reader
    // can hold.
    infrastructure: 'var(--fs-cat-operational)',
  };
</script>

{#each sections as s, si (si)}
  <section class="fs-section" data-template={s.template}>
    {#if s.title}<h2 class="fs-section-title">{s.title}</h2>{/if}
    {#if s.claim}
      <p class="fs-section-claim">{say(s.claim.text, depth)} <ConfidenceChip level={s.claim.confidence} /></p>
    {/if}

    {#if s.template === 'T6'}
      <!-- Anatomy: one thing, N layers, each with a named fight. -->
      <div class="fs-layers">
        {#each s.layers ?? [] as l, li (li)}
          <div class="fs-layer" style={l.tag ? `--hue: ${HUE[l.tag]}` : ''}>
            <div class="fs-layer-head">
              <!-- `no` carries its own label. Both studies author it as "L1",
                   and the template used to prefix another "L" on top, which is
                   why the reference study shipped reading LL1 through LL5. -->
              <span class="fs-layer-no">{l.no}</span>
              <b>{l.name}</b>
              <span class="fs-layer-q">{l.question}</span>
            </div>
            <div class="fs-layer-grid">
              <div><span class="fs-margin-label">Today</span><p>{l.today}</p></div>
              <div><span class="fs-margin-label">With it</span><p>{l.withIt}</p></div>
              <div><span class="fs-margin-label">The fight</span><p>{l.theFight}</p></div>
            </div>
          </div>
        {/each}
      </div>
      {#if s.leastDesigned}
        <p class="fs-least">{s.leastDesigned}</p>
      {/if}

    {:else if s.template === 'T7'}
      <!-- Chronicle: two named threads, never one undifferentiated one. -->
      {#if s.threads?.length}
        <div class="fs-threads">
          {#each s.threads as t, ti (ti)}
            <div><span class="fs-margin-label">{t.name}</span><p>{t.detail}</p></div>
          {/each}
        </div>
      {/if}
      <ol class="fs-timeline">
        {#each s.entries ?? [] as e, i (i)}
          <li class:here={e.present} style={e.tag ? `--hue: ${HUE[e.tag]}` : ''}>
            <span class="fs-tl-date">{e.date}</span>
            <span class="fs-tl-dot" aria-hidden="true"></span>
            <div class="fs-tl-body">
              <b>{e.title}</b>
              {#if e.detail}<p>{e.detail}</p>{/if}
            </div>
            {#if e.tag}<span class="fs-tl-tag">{e.tag}</span>{/if}
          </li>
        {/each}
      </ol>
      {#if s.balance}<p class="fs-least">{s.balance}</p>{/if}

    {:else if s.template === 'T8'}
      <!-- Precedent: every case has a fate and a transferable lesson. -->
      {#if s.archetypes?.length}
        <div class="fs-key">
          {#each s.archetypes as a, ai (ai)}
            <span class="fs-key-item"><span class="fs-swatch" aria-hidden="true"></span>{a.label}</span>
          {/each}
        </div>
      {/if}
      <div class="fs-cases">
        {#each s.cases ?? [] as c, ci (ci)}
          <article class="fs-case">
            <span class="fs-margin-label">{c.place} · {c.year}</span>
            <b class="fs-case-name">{c.name}</b>
            <p class="fs-case-what">{c.what}</p>
            <p class="fs-case-fate"><span class="fs-margin-label">Fate</span> {c.fate}</p>
            <p class="fs-case-lesson">{c.lesson}</p>
          </article>
        {/each}
      </div>
      {#if s.pattern?.length}
        <div class="fs-cells fs-pattern">
          {#each s.pattern as p, pi (pi)}<div><p>{p}</p></div>{/each}
        </div>
      {/if}
    {/if}
  </section>
{/each}

<style>
  .fs-section { margin-top: 34px; }
  .fs-section-title {
    font-family: var(--fs-serif);
    font-weight: 600;
    font-size: 24px;
    letter-spacing: -0.02em;
    margin: 0 0 10px;
  }
  .fs-section-claim {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0 0 18px;
    max-width: 100%;
  }

  /* ——— T6 ——— */
  .fs-layers { display: flex; flex-direction: column; gap: 10px; }
  .fs-layer {
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--hue, var(--line-strong));
    padding: 13px 15px;
  }
  .fs-layer-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .fs-layer-no {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .fs-layer-q {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .fs-layer-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    margin-top: 10px;
  }
  .fs-layer-grid p {
    margin: 5px 0 0;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .fs-least {
    margin: 16px 0 0;
    font-family: var(--fs-serif);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 100%;
  }

  /* ——— T7 ——— */
  .fs-threads {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  .fs-threads p { margin: 5px 0 0; font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); }
  .fs-timeline { list-style: none; margin: 16px 0 0; padding: 0 0 0 2px; border-left: 2px solid var(--line-strong); }
  .fs-timeline li {
    display: grid;
    grid-template-columns: 92px 14px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    padding: 10px 0 10px 12px;
  }
  .fs-tl-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .fs-tl-dot {
    width: 8px; height: 8px;
    border-radius: var(--radius-pill);
    background: var(--hue, var(--line-strong));
  }
  .fs-timeline li.here .fs-tl-dot { background: var(--accent); }
  .fs-timeline li.here .fs-tl-date { color: var(--accent); }
  .fs-tl-body p { margin: 4px 0 0; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); }
  .fs-tl-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }

  /* ——— T8 ——— */
  .fs-key { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 14px; }
  .fs-key-item {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .fs-swatch { width: 10px; height: 10px; background: var(--line-strong); }
  .fs-cases {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
  }
  .fs-case { background: var(--bg); padding: 14px 16px; min-width: 0; }
  .fs-case-name { display: block; margin-top: 5px; }
  .fs-case-what, .fs-case-fate {
    margin: 7px 0 0; font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary);
  }
  /* The lesson sits below a hairline, in italic serif, and is one sentence. */
  .fs-case-lesson {
    margin: 10px 0 0;
    padding-top: 9px;
    border-top: 1px solid var(--line-hair);
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-primary);
  }
  .fs-pattern { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 16px; }
  .fs-pattern p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); }

  @media (max-width: 900px) {
    .fs-layer-grid, .fs-threads, .fs-pattern { grid-template-columns: minmax(0, 1fr); }
    .fs-timeline li { grid-template-columns: 78px 12px minmax(0, 1fr); }
    .fs-tl-tag { grid-column: 3; }
  }
</style>
