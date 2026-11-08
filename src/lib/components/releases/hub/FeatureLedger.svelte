<script lang="ts">
  // The feature ledger: what each feature area has cost, cumulatively, across
  // every session that worked on it — and a finder that adds up any feature you
  // can name, by area or by words.
  //
  // A session's cost is split across areas by the attribution in
  // $lib/releases/spend (its released PRs' churn, else its edits). Ticking areas
  // sums exactly those shares; typing words matches session titles, projects,
  // PR numbers and the release entries those sessions shipped, and counts each
  // matching session in full. Both together narrow to sessions matching the
  // words, credited with their share of the ticked areas.
  //
  // Sparklines share ONE time axis — the whole window — so two features can be
  // compared by when their money was spent, not only by how much.
  import { gbp, type FeatureArea, type FeatureGroup, type SpendSession } from '$lib/releases/spend';

  interface Props {
    areas: FeatureArea[];
    /** Group totals counted once per session upstream — the insights read the same rows. */
    groupTotals: FeatureGroup[];
    sessions: SpendSession[];
  }

  let { areas, groupTotals, sessions }: Props = $props();

  let selected = $state<string[]>([]);
  let query = $state('');
  let expanded = $state<string[]>([]);
  let showAll = $state(false);

  // ——— ledger groups ————————————————————————————————————————————————
  interface Group {
    key: string;
    label: string;
    costUsd: number;
    sessions: number;
    prs: number;
    first: string | null;
    last: string | null;
    linkedShare: number;
    path: [string, number][];
    children: FeatureArea[];
  }

  function mergePaths(paths: [string, number][][]): [string, number][] {
    const inc = new Map<string, number>();
    for (const p of paths) {
      let prev = 0;
      for (const [d, v] of p) {
        inc.set(d, (inc.get(d) ?? 0) + v - prev);
        prev = v;
      }
    }
    let run = 0;
    return [...inc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => [d, (run += v)]);
  }

  const groups = $derived.by((): Group[] => {
    const by = new Map<string, FeatureArea[]>();
    for (const a of areas) (by.get(a.group) ?? by.set(a.group, []).get(a.group)!).push(a);
    return [...by.entries()]
      .map(([key, children]) => {
        const totals = groupTotals.find((g) => g.key === key);
        const cost = children.reduce((n, c) => n + c.costUsd, 0);
        return {
          key,
          label: children[0].groupLabel,
          costUsd: cost,
          sessions: totals?.sessions ?? children[0].sessions,
          prs: totals?.prs ?? children[0].prs,
          first: children.map((c) => c.first).filter(Boolean).sort()[0] ?? null,
          last: children.map((c) => c.last).filter(Boolean).sort().at(-1) ?? null,
          linkedShare: cost > 0 ? children.reduce((n, c) => n + c.costUsd * c.linkedShare, 0) / cost : 0,
          path: children.length === 1 ? children[0].path : mergePaths(children.map((c) => c.path)),
          children: children.length > 1 ? children : [],
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd);
  });

  const visible = $derived(showAll ? groups : groups.slice(0, 15));
  const maxCost = $derived(Math.max(1, ...groups.map((g) => g.costUsd)));

  const domain = $derived.by(() => {
    const dates = sessions.map((s) => s.date).filter((d): d is string => !!d).sort();
    const lo = dates[0] ? Date.parse(dates[0]) : 0;
    const hi = dates.at(-1) ? Date.parse(dates.at(-1)!) : lo + 1;
    return { lo, span: Math.max(86400000, hi - lo) };
  });

  function x(day: string): number {
    return ((Date.parse(day) - domain.lo) / domain.span) * 100;
  }

  /** A step line on a 100×100 box: flat until a session, then up. */
  function stepPath(path: [string, number][], peak: number): string {
    if (!path.length || peak <= 0) return '';
    let d = 'M0 100';
    let prevY = 100;
    for (const [day, v] of path) {
      const px = x(day).toFixed(2);
      const py = (100 - (v / peak) * 100).toFixed(2);
      d += ` L${px} ${prevY} L${px} ${py}`;
      prevY = Number(py);
    }
    return `${d} L100 ${prevY}`;
  }

  function toggle(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }

  function span(first: string | null, last: string | null): string {
    const f = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (!first) return '—';
    return first === last ? f(first) : `${f(first)} – ${f(last!)}`;
  }

  // ——— the finder ———————————————————————————————————————————————————
  const labelOf = $derived(new Map(areas.map((a) => [a.key, a.label])));
  const groupOf = $derived(new Map(areas.map((a) => [a.key, a.group])));

  const tokens = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));

  function haystack(s: SpendSession): string {
    return [
      s.title, s.project, ...s.items, ...s.prs.map((p) => `#${p}`),
      ...s.areas.map((a) => labelOf.get(a.key) ?? a.key),
    ].join(' ').toLowerCase();
  }

  const active = $derived(selected.length > 0 || tokens.length > 0);

  const matches = $derived.by(() => {
    if (!active) return [];
    const picked = new Set(selected);
    return sessions
      .map((s) => {
        const share = picked.size
          ? s.areas.filter((a) => picked.has(a.key) || picked.has(groupOf.get(a.key) ?? '')).reduce((n, a) => n + a.share, 0)
          : 1;
        return { s, share, cost: s.costUsd * share };
      })
      .filter((m) => m.share > 0 && tokens.every((t) => haystack(m.s).includes(t)))
      .sort((a, b) => (a.s.date ?? '').localeCompare(b.s.date ?? ''));
  });

  const found = $derived.by(() => {
    let run = 0;
    const byDay = new Map<string, number>();
    for (const m of matches) if (m.s.date) byDay.set(m.s.date, (byDay.get(m.s.date) ?? 0) + m.cost);
    const path = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => [d, (run += v)] as [string, number]);
    const total = matches.reduce((n, m) => n + m.cost, 0);
    const shipped = matches.filter((m) => m.s.basis === 'pull-request').reduce((n, m) => n + m.cost, 0);
    const dates = matches.map((m) => m.s.date).filter((d): d is string => !!d);
    return {
      path,
      total,
      shipped,
      prs: new Set(matches.flatMap((m) => m.s.prs)).size,
      first: dates[0] ?? null,
      last: dates.at(-1) ?? null,
    };
  });

  const priciest = $derived([...sessions].sort((a, b) => b.costUsd - a.costUsd).slice(0, 12));
  const listed = $derived(active ? [...matches].sort((a, b) => b.cost - a.cost).slice(0, 40) : []);
  let hoverDot = $state<{ title: string; cost: number; date: string } | null>(null);

  const BASIS: Record<SpendSession['basis'], string> = {
    'pull-request': 'released PR',
    edits: 'edits',
    none: 'no trail',
  };

  function basisLabel(s: SpendSession): string {
    return s.basis !== 'pull-request' && !s.prRecorded ? 'PR not recorded' : BASIS[s.basis];
  }
</script>

<div class="ledger">
  <figure class="panel finder" aria-labelledby="finder-title">
    <figcaption class="panel-hd">
      <span class="panel-name" id="finder-title">Cost of a feature</span>
      <span class="panel-meta">tick areas below, or name it</span>
    </figcaption>

    <div class="finder-controls">
      <label class="search">
        <span class="visually-hidden">Words to match</span>
        <input type="search" placeholder="e.g. releases, whoop, #966" bind:value={query} autocomplete="off" />
      </label>
      {#each selected as key (key)}
        <button type="button" class="chip" onclick={() => (selected = toggle(selected, key))} aria-label="Remove {labelOf.get(key) ?? groups.find((g) => g.key === key)?.label ?? key}">
          {labelOf.get(key) ?? groups.find((g) => g.key === key)?.label ?? key}<span aria-hidden="true">×</span>
        </button>
      {/each}
      {#if active}
        <button type="button" class="clear" onclick={() => { selected = []; query = ''; }}>Clear</button>
      {/if}
    </div>

    {#if !active}
      <p class="hint">Nothing selected — the priciest sessions in this window:</p>
      <ol class="sessions">
        {#each priciest as s (s.id)}
          <li>
            <span class="s-date">{s.date ? new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</span>
            <span class="s-title">{s.title}<span class="s-proj">{s.project}</span></span>
            <span class="s-basis" data-basis={s.basis}>{basisLabel(s)}</span>
            <span class="s-cost">{gbp(s.costUsd)}</span>
          </li>
        {/each}
      </ol>
    {:else if matches.length === 0}
      <p class="hint">No session matches.</p>
    {:else}
      <div class="found-stats">
        <div><span class="fs-label">Cumulative cost</span><span class="fs-value">{gbp(found.total)}</span></div>
        <div><span class="fs-label">Sessions</span><span class="fs-value">{matches.length}</span></div>
        <div><span class="fs-label">Released PRs</span><span class="fs-value">{found.prs}</span></div>
        <div><span class="fs-label">Became releases</span><span class="fs-value">{found.total ? Math.round((found.shipped / found.total) * 100) : 0}%</span></div>
        <div><span class="fs-label">Span</span><span class="fs-value small">{span(found.first, found.last)}</span></div>
      </div>

      <div class="found-plot">
        <span class="peak">{gbp(found.total)}</span>
        <div class="found-box">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path class="line" vector-effect="non-scaling-stroke" d={stepPath(found.path, found.total)} />
          </svg>
          {#each found.path as [day, v] (day)}
            {@const m = matches.filter((mm) => mm.s.date === day)}
            <button
              type="button"
              class="dot"
              style="left: {x(day)}%; bottom: {(v / Math.max(0.01, found.total)) * 100}%"
              aria-label="{day}: {m.map((mm) => mm.s.title).join('; ')} — {gbp(m.reduce((n, mm) => n + mm.cost, 0))}, {gbp(v)} to date"
              onpointerenter={() => (hoverDot = { title: m.map((mm) => mm.s.title).join(' · '), cost: m.reduce((n, mm) => n + mm.cost, 0), date: day })}
              onpointerleave={() => (hoverDot = null)}
              onfocus={() => (hoverDot = { title: m.map((mm) => mm.s.title).join(' · '), cost: m.reduce((n, mm) => n + mm.cost, 0), date: day })}
              onblur={() => (hoverDot = null)}
            ></button>
          {/each}
        </div>
        <p class="dot-readout" aria-live="polite">
          {#if hoverDot}
            {new Date(hoverDot.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · +{gbp(hoverDot.cost)} · {hoverDot.title}
          {:else}
            One step per day with matching work · time axis shared with the ledger
          {/if}
        </p>
      </div>

      <ol class="sessions">
        {#each listed as m (m.s.id)}
          <li>
            <span class="s-date">{m.s.date ? new Date(m.s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</span>
            <span class="s-title">
              {m.s.title}
              {#if m.s.prs.length}
                <span class="s-prs">{#each m.s.prs.slice(0, 4) as pr, i (pr)}{i ? ', ' : ''}<a href="https://github.com/zerosumpain/SR-Main/pull/{pr}" rel="noreferrer">#{pr}</a>{/each}{m.s.prs.length > 4 ? ` +${m.s.prs.length - 4}` : ''}</span>
              {/if}
              <span class="s-proj">{m.s.project}</span>
            </span>
            <span class="s-basis" data-basis={m.s.basis}>{basisLabel(m.s)}</span>
            <span class="s-cost">
              {gbp(m.cost)}
              {#if m.share < 0.999}<span class="s-of">{Math.round(m.share * 100)}% of {gbp(m.s.costUsd)}</span>{/if}
            </span>
          </li>
        {/each}
      </ol>
      {#if matches.length > listed.length}
        <p class="hint">{matches.length - listed.length} smaller sessions not listed; they are in the totals.</p>
      {/if}
    {/if}
  </figure>

  <figure class="panel table-panel">
    <figcaption class="panel-hd">
      <span class="panel-name">Feature ledger · {groups.length} areas</span>
      <span class="panel-meta">cumulative · shared time axis</span>
    </figcaption>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">Select</span></th>
            <th scope="col">Area</th>
            <th scope="col" class="num">Cost</th>
            <th scope="col" class="bar-col"><span class="visually-hidden">Share of the largest</span></th>
            <th scope="col" class="num">Sessions</th>
            <th scope="col" class="num">PRs</th>
            <th scope="col" class="num">Shipped</th>
            <th scope="col">Active</th>
            <th scope="col">Over time</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as g (g.key)}
            {@render row(g.key, g.label, g, g.children.length > 0, false)}
            {#if g.children.length && expanded.includes(g.key)}
              {#each g.children as c (c.key)}
                {@render row(c.key, c.label, c, false, true)}
              {/each}
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    {#if groups.length > 15}
      <button type="button" class="more" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Show the top 15' : `Show all ${groups.length} areas`}
      </button>
    {/if}
  </figure>
</div>

{#snippet row(key: string, label: string, r: { costUsd: number; sessions: number; prs: number; linkedShare: number; first: string | null; last: string | null; path: [string, number][] }, expandable: boolean, child: boolean)}
  <tr class:child class:picked={selected.includes(key)}>
    <td>
      <input type="checkbox" checked={selected.includes(key)} onchange={() => (selected = toggle(selected, key))} aria-label="Add {label} to the cost finder" />
    </td>
    <th scope="row" class="area">
      {#if expandable}
        <button type="button" class="expander" aria-expanded={expanded.includes(key)} onclick={() => (expanded = toggle(expanded, key))}>
          <span class="chev" aria-hidden="true">▸</span>{label}
        </button>
      {:else}
        <span class:indent={child}>{label}</span>
      {/if}
    </th>
    <td class="num strong">{gbp(r.costUsd)}</td>
    <td class="bar-col"><span class="track"><span class="fill" style="width: {(r.costUsd / maxCost) * 100}%"></span></span></td>
    <td class="num">{r.sessions}</td>
    <td class="num">{r.prs || '—'}</td>
    <td class="num">{Math.round(r.linkedShare * 100)}%</td>
    <td class="when">{span(r.first, r.last)}</td>
    <td class="spark-cell">
      <svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="{label}: cumulative {gbp(r.costUsd)} from {r.first ?? '—'} to {r.last ?? '—'}">
        <path vector-effect="non-scaling-stroke" d={stepPath(r.path, r.costUsd)} />
      </svg>
    </td>
  </tr>
{/snippet}

<style>
  .ledger { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 12px; align-items: start; }
  @media (max-width: 1100px) { .ledger { grid-template-columns: minmax(0, 1fr); } }
  .panel { border: 1px solid var(--line-strong); padding: 15px 17px; margin: 0; min-width: 0; }
  .panel-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
  .panel-name, .panel-meta, .hint, .fs-label, .s-date, .s-proj, .s-basis, .s-cost, .s-of, .s-prs, .dot-readout, .peak, th, td, .chip, .clear, .more {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-variant-numeric: tabular-nums;
  }
  .panel-name { text-transform: uppercase; letter-spacing: 0.15em; font-weight: 500; }
  .panel-meta { text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }

  .finder-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 12px; }
  .search { flex: 1 1 220px; }
  .search input { width: 100%; box-sizing: border-box; border: 1px solid var(--line-strong); background: transparent; color: var(--text-primary); font: var(--fs-body-sm) var(--font-body); padding: 7px 9px; border-radius: 0; }
  .search input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--accent); background: var(--accent-tint-08); color: var(--text-primary); padding: 5px 8px; border-radius: 100px; cursor: pointer; }
  .clear, .more { border: 1px solid var(--line-strong); background: transparent; color: var(--text-muted); padding: 5px 9px; cursor: pointer; }
  .more { margin-top: 10px; }
  .chip:focus-visible, .clear:focus-visible, .more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .hint { color: var(--text-muted); margin: 6px 0 8px; }

  .found-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; margin-bottom: 12px; }
  .found-stats div { display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--line-hair); padding-top: 6px; }
  .fs-label { text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .fs-value { font-weight: 800; font-size: 1.35rem; font-variant-numeric: tabular-nums; }
  .fs-value.small { font-size: var(--fs-body-sm); font-weight: 600; }

  .found-plot { position: relative; padding-left: 46px; margin-bottom: 12px; }
  .peak { position: absolute; left: 0; top: 0; color: var(--text-ghost); }
  .found-box { position: relative; height: 130px; border-bottom: 1px solid var(--line-strong); }
  .found-box svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .line { fill: none; stroke: var(--accent); stroke-width: 2; }
  .dot { position: absolute; width: 12px; height: 12px; margin: 0 0 -6px -6px; padding: 0; border-radius: 100px; border: 2px solid var(--bg); background: var(--accent); cursor: pointer; }
  .dot:hover, .dot:focus-visible { background: var(--text-primary); outline: none; }
  .dot-readout { color: var(--text-muted); margin: 8px 0 0; min-height: 1.4em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .sessions { list-style: none; margin: 0; padding: 0; }
  .sessions li { display: grid; grid-template-columns: 3.4rem minmax(0, 1fr) auto 4.6rem; gap: 10px; align-items: baseline; padding: 6px 0; border-top: 1px solid var(--line-hair); }
  .s-date { color: var(--text-ghost); white-space: nowrap; }
  .s-title { font-size: var(--fs-body-sm); line-height: 1.35; overflow-wrap: anywhere; }
  .s-prs { color: var(--text-muted); margin-left: 6px; }
  .s-prs a { color: var(--accent-ink); }
  .s-proj { display: block; color: var(--text-ghost); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .s-basis { color: var(--text-muted); border: 1px solid var(--line-strong); padding: 1px 6px; border-radius: 100px; white-space: nowrap; }
  .s-basis[data-basis='pull-request'] { border-color: var(--accent); color: var(--text-primary); }
  .s-cost { text-align: right; color: var(--text-primary); display: flex; flex-direction: column; align-items: flex-end; }
  .s-of { color: var(--text-ghost); }
  @media (max-width: 640px) {
    .sessions li { grid-template-columns: 3.4rem minmax(0, 1fr) 4.6rem; }
    .s-basis { display: none; }
  }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line-hair); white-space: nowrap; }
  thead th { text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); font-weight: 500; border-bottom-color: var(--line-strong); }
  th.area { font-weight: 600; font-family: var(--font-body); font-size: var(--fs-body-sm); white-space: normal; min-width: 11rem; }
  tr.child th.area { font-weight: 400; color: var(--text-secondary); }
  tr.picked { background: var(--accent-tint-08); }
  .indent { padding-left: 18px; }
  .num { text-align: right; }
  .strong { color: var(--text-primary); font-weight: 600; }
  .when { color: var(--text-muted); }
  .bar-col { width: 18%; min-width: 70px; }
  .track { display: block; height: 8px; background: var(--accent-tint-14); }
  .fill { display: block; height: 100%; background: var(--accent); }
  .spark-cell { width: 120px; }
  .spark { display: block; width: 120px; height: 26px; }
  .spark path { fill: none; stroke: var(--accent); stroke-width: 2; }
  .expander { border: 0; background: none; padding: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .expander:focus-visible, input[type='checkbox']:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .chev { display: inline-block; width: 18px; color: var(--text-ghost); transition: transform var(--t-fast) var(--ease-out); }
  .expander[aria-expanded='true'] .chev { transform: rotate(90deg); }
  input[type='checkbox'] { accent-color: var(--accent); width: 15px; height: 15px; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
