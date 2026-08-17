<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const n = (v: unknown) => (v === null || v === undefined ? '—' : String(v));
</script>

<svelte:head><title>Codegraph — serves</title></svelte:head>

<section class="wrap">
  <h1>Is this actually being used?</h1>
  <p class="lede">
    Every retrieval, including the ones that found nothing. The builder's tool bridge once
    reported itself healthy for sixty days while never being called — self-reported health
    proves nothing, so this page counts rows.
  </p>

  <h2>Last 30 days, by channel</h2>
  {#if !data.byChannel.length}
    <p class="alarm">
      No retrievals recorded at all. If a build has run since this shipped, the push channel
      is not firing — check the build log for a "Codegraph:" line.
    </p>
  {:else}
    <table>
      <thead><tr><th>Channel</th><th>Total</th><th>Served</th><th>Empty</th><th>Failed</th><th>Avg ms</th></tr></thead>
      <tbody>
        {#each data.byChannel as r (r.channel)}
          <tr>
            <td>{r.channel}</td><td>{n(r.total)}</td><td>{n(r.served)}</td>
            <td>{n(r.empty)}</td><td class:bad={Number(r.failed) > 0}>{n(r.failed)}</td><td>{n(r.avg_ms)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h2>The measure: iterations per repo build</h2>
  <p class="lede small">
    Baseline frozen at ship time — 66 builds, 280 iterations, mean 4.24 (5.14 over the
    preceding 30 days). Fewer iterations for the same work is the whole point.
  </p>
  <table>
    <thead><tr><th></th><th>Builds</th><th>Mean iterations</th></tr></thead>
    <tbody>
      <tr><td>Before 2026-08-17</td><td>{n(data.iterations.builds_before)}</td><td>{n(data.iterations.mean_before)}</td></tr>
      <tr><td>Since</td><td>{n(data.iterations.builds_after)}</td><td>{n(data.iterations.mean_after)}</td></tr>
    </tbody>
  </table>

  <h2>Did it change the builds?</h2>
  <p class="lede small">
    Repo builds only — an app build has no history in this graph, so including them would dilute
    the thing being measured. Two arms, not a before/after line: a date split would credit the
    graph for anything else that changed on the same day.
  </p>
  <table>
    <thead><tr><th></th><th>Builds</th><th>Mean iterations</th></tr></thead>
    <tbody>
      <tr><td>Without a served block</td><td>{n(data.impact.builds_without)}</td><td>{n(data.impact.mean_without)}</td></tr>
      <tr><td>With a served block</td><td>{n(data.impact.builds_with)}</td><td>{n(data.impact.mean_with)}</td></tr>
    </tbody>
  </table>

  <h2>Feedback resolved</h2>
  <p class="lede small">
    A serve is <strong>helpful</strong> when the failure that triggered it did not come back, and
    <strong>unhelpful</strong> when it did. Anything the gate cannot answer stays
    <strong>unresolved</strong> rather than being guessed at — a wrong "helpful" is
    indistinguishable from a real one afterwards and would bias every future ranking.
  </p>
  <p class="lede small">
    A serve keyed on the <strong>file set</strong> rather than on a gate error is
    <strong>unattributable</strong>: it was made before anything had failed, so a build that then
    passes first time says nothing about it. Those are closed and never counted. Only helpful and
    unhelpful are evidence, and only they move the ranking.
  </p>
  <dl class="tiles">
    <div><dt>Helpful</dt><dd>{n(data.resolution.helpful)}</dd></div>
    <div><dt>Unhelpful</dt><dd>{n(data.resolution.unhelpful)}</dd></div>
    <div><dt>Unresolved</dt><dd>{n(data.resolution.unresolved)}</dd></div>
    <div><dt>Unattributable</dt><dd>{n(data.resolution.unattributable)}</dd></div>
  </dl>

  <h2>Per build</h2>
  {#if !data.perBuild.length}
    <p class="alarm">No build has been served yet.</p>
  {:else}
    <table>
      <thead><tr><th>Build</th><th>Status</th><th>Iters</th><th>Served</th><th>Empty</th><th>Helped</th><th>Didn't</th></tr></thead>
      <tbody>
        {#each data.perBuild as b (b.id)}
          <tr>
            <td class="t">{b.title}</td>
            <td>{b.status}</td>
            <td class="num">{n(b.iterations)}</td>
            <td class="num">{n(b.served)}</td>
            <td class="num">{n(b.empty)}</td>
            <td class="num good">{n(b.helpful)}</td>
            <td class="num" class:bad={Number(b.unhelpful) > 0}>{n(b.unhelpful)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h2>Recent queries</h2>
  {#if !data.recent.length}
    <p class="alarm">Nothing recorded yet.</p>
  {:else}
    <ul>
      {#each data.recent as r, i (i)}
        <li>
          <span class="tag o-{r.outcome}">{r.outcome}</span>
          <span class="tag">{r.channel}</span>
          <code>{String(r.query).slice(0, 150)}</code>
          <span class="muted">{n(r.duration_ms)}ms · {n(r.chars_served)} chars</span>
          {#if r.error_message}<span class="err">{r.error_message}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .wrap { max-width: 980px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-family: var(--font-display); font-size: var(--fs-display-sm); margin: 0 0 0.4rem; }
  h2 { font-size: 0.9rem; font-family: var(--font-mono); text-transform: uppercase; margin: 2rem 0 0.6rem; color: var(--text-secondary); }
  .lede { color: var(--text-secondary); margin: 0 0 1rem; max-width: 66ch; }
  .lede.small { font-size: 0.85rem; }
  table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 0.82rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--divider); }
  th { color: var(--text-secondary); font-weight: 400; font-size: var(--fs-label-xs); text-transform: uppercase; }
  td.bad { color: var(--error); }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap;
       padding: 0.4rem 0; border-bottom: 1px solid var(--divider); font-size: 0.8rem; }
  .tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
         border: 1px solid var(--divider); padding: 0.05rem 0.35rem; color: var(--text-secondary); }
  .o-served { border-color: var(--accent-ink); color: var(--accent-ink); }
  .o-failed { border-color: var(--error-border); color: var(--error); }
  code { font-family: var(--font-mono); font-size: 0.76rem; word-break: break-all; flex: 1; min-width: 200px; }
  .muted { color: var(--text-secondary); font-size: var(--fs-label-xs); }
  .err { color: var(--error); font-size: var(--fs-label-xs); }
  .tiles { display: flex; gap: 1.5rem; margin: 0 0 1rem; }
  .tiles div { display: flex; flex-direction: column; }
  .tiles dt { font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-secondary); }
  .tiles dd { margin: 0; font-family: var(--font-mono); font-size: var(--fs-body-lg); }
  td.t { max-width: 44ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.num { text-align: right; }
  td.good { color: var(--accent-ink); }
  .alarm { border: 1px solid var(--error-border); background: var(--error-bg); color: var(--error); padding: 0.8rem; font-size: 0.85rem; }
</style>
