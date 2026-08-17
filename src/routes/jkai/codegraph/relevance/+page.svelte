<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const bar = (n: number) => Math.max(1, Math.round(n * 100));
</script>

<svelte:head><title>Codegraph — relevance</title></svelte:head>

<section class="wrap">
  <h1>What would be served, and why</h1>
  <p class="lede">
    Ranking is <strong>belief × recency × liveness</strong>, where belief blends a neutral prior
    with the measured outcome and the blend shifts as evidence accrues. With nothing observed,
    recency sorts. Once serves resolve, outcomes take over — nothing switches mode, the weights move.
  </p>

  <p class="regime" class:mature={data.regime.regime !== 'recency'}>{data.regime.label}</p>

  <dl class="tiles">
    <div><dt>Units</dt><dd>{data.counts.units}</dd></div>
    <div><dt>Never served</dt><dd>{data.counts.neverServed}</dd></div>
    <div><dt>Proven</dt><dd>{data.counts.proven}</dd></div>
    <div><dt>Atrophying</dt><dd class:warn={data.counts.atrophying > 0}>{data.counts.atrophying}</dd></div>
    <div><dt>Resolved serves</dt><dd>{data.counts.resolvedServes}</dd></div>
  </dl>

  <h2>Most likely to be pulled into a build</h2>
  <table>
    <thead>
      <tr><th>Score</th><th></th><th>What</th><th>Recency</th><th>Outcome</th><th>Why</th></tr>
    </thead>
    <tbody>
      {#each data.top as r (r.id)}
        <tr>
          <td class="score">{r.relevance.score.toFixed(3)}</td>
          <td class="meter"><span style="--w:{bar(r.relevance.score)}%"></span></td>
          <td class="what"><span class="kind {r.kind}">{r.kind}</span> {r.title}</td>
          <td class="num">{pct(r.relevance.recency)}</td>
          <td class="num" class:warn={r.relevance.outcome < 0.5 && r.relevance.observations > 0}>
            {pct(r.relevance.outcome)}
          </td>
          <td class="why">{r.relevance.because}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <h2>The tail — what the budget will never reach</h2>
  <p class="hint">
    Nothing here is filtered out by score; the budget simply runs out first. That is why a demoted
    unit is one good outcome away from climbing again, rather than deleted. Worth reading for the
    opposite reason too: something valuable sitting down here means the scoring is wrong.
  </p>
  <table>
    <tbody>
      {#each data.bottom as r (r.id)}
        <tr>
          <td class="score dim">{r.relevance.score.toFixed(3)}</td>
          <td class="what"><span class="kind {r.kind}">{r.kind}</span> {r.title}</td>
          <td class="why">{r.relevance.because}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .wrap { width: 100%; box-sizing: border-box; padding: 14px 16px 3rem; max-width: 1200px; }
  h1 { font-family: var(--font-display); font-size: var(--fs-display-sm); margin: 0 0 0.4rem; }
  h2 { font-size: var(--fs-body); font-family: var(--font-mono); text-transform: uppercase;
       letter-spacing: 0.05em; margin: 2rem 0 0.5rem; color: var(--text-secondary); }
  .lede { color: var(--text-secondary); max-width: 78ch; margin: 0 0 1rem; font-size: var(--fs-body-sm); }
  .regime { font-family: var(--font-mono); font-size: var(--fs-label); padding: 0.5rem 0.7rem;
            border: 1px solid var(--divider); color: var(--text-secondary); margin: 0 0 1.2rem; }
  .regime.mature { border-color: var(--accent-ink); color: var(--accent-ink); }
  .tiles { display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 0 0 1rem; }
  .tiles div { display: flex; flex-direction: column; }
  .tiles dt { font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-secondary);
              letter-spacing: 0.06em; }
  .tiles dd { margin: 0; font-family: var(--font-mono); font-size: var(--fs-body-lg); }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-label); }
  th { text-align: left; font-weight: 400; font-size: var(--fs-label-xs); text-transform: uppercase;
       color: var(--text-secondary); padding: 0.3rem 0.5rem; }
  td { padding: 0.3rem 0.5rem; border-top: 1px solid var(--divider); vertical-align: top; }
  .score { font-family: var(--font-mono); white-space: nowrap; }
  .score.dim { color: var(--text-secondary); }
  .meter { width: 90px; }
  .meter span { display: block; height: 6px; width: var(--w); background: var(--accent-ink); }
  .what { max-width: 40ch; }
  .kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
          border: 1px solid var(--divider); padding: 0 0.3rem; margin-right: 0.3rem;
          color: var(--text-secondary); }
  .num { font-family: var(--font-mono); text-align: right; white-space: nowrap; }
  .warn { color: var(--accent); }
  .why { color: var(--text-secondary); }
  .hint { color: var(--text-secondary); font-size: var(--fs-label); max-width: 78ch; margin: 0 0 0.6rem; }
</style>
