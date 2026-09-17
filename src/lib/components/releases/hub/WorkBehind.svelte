<script lang="ts">
  /**
   * Band D — the work behind the releases on this page.
   *
   * This is what /admin/ops/claude-changelog was kept for: the per-session
   * timeline, and related changes grouped rather than listed. It is owner-only
   * structurally, not by a template guard — the loader fetches it inside the
   * owner branch, so an anonymous render never receives these bytes at all.
   *
   * The join is pull-request number. See $lib/releases/sessions.server.ts for
   * why the three obvious alternatives all fail on real data.
   */
  import type { ReleaseSession, ReleaseSessionsBand } from '$lib/releases/sessions.server';

  let { band, versionById }: { band: ReleaseSessionsBand; versionById: Map<number, string> } = $props();

  let open = $state<string | null>(null);

  /** Stage colours follow the run's shape, not a palette: request → fixes is a
   *  sequence, so it reads as one ramp rather than six unrelated hues. */
  const STAGE_ORDER = ['request', 'design', 'plan', 'result', 'fixes'];

  function money(n: number | null): string {
    if (n === null) return '—';
    return n >= 1 ? `$${n.toFixed(2)}` : `${(n * 100).toFixed(1)}¢`;
  }

  function span(s: ReleaseSession): string {
    if (!s.startedAt) return '—';
    const d = new Date(s.startedAt);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  /** Bar height ∝ cost, floored so a cheap stage is still visible as a stage. */
  function barHeight(cost: number | null, max: number): number {
    if (!cost || max <= 0) return 8;
    return Math.max(8, Math.round((cost / max) * 46));
  }

  function maxStageCost(s: ReleaseSession): number {
    return s.stages.reduce((m, st) => Math.max(m, st.costUsd ?? 0), 0);
  }
</script>

<section class="band">
  <header class="hd">
    <h2>The work behind it</h2>
    <p class="sub">
      {band.sessions.length}
      {band.sessions.length === 1 ? 'session' : 'sessions'} joined to the releases on this page by
      pull-request number. Each bar is one stage of the run, its height the cost of that stage.
    </p>
  </header>

  {#if band.sessions.length === 0}
    <p class="empty">
      No session on record produced these releases. That is ordinary for anything deployed before the
      transcript log began, or shipped without a pull request.
    </p>
  {:else}
    <ul class="list">
      {#each band.sessions as s (s.id)}
        {@const max = maxStageCost(s)}
        <li class:open={open === s.id}>
          <button
            class="row"
            aria-expanded={open === s.id}
            onclick={() => (open = open === s.id ? null : s.id)}
          >
            <span class="when">{span(s)}</span>
            <span class="title">{s.title ?? 'Untitled session'}</span>

            <!-- The stage timeline: the thing the changelog page was liked for. -->
            <span class="strip" aria-hidden="true">
              {#each s.stages as st (st.ordinal)}
                <span
                  class="bar"
                  data-stage={STAGE_ORDER.includes(st.stage) ? st.stage : 'other'}
                  style="height:{barHeight(st.costUsd, max)}px"
                  title="{st.stage} · {money(st.costUsd)}"
                ></span>
              {/each}
            </span>

            <span class="cost">{s.costKnown ? money(s.estCostUsd) : `~${money(s.estCostUsd)}`}</span>
          </button>

          {#if open === s.id}
            <div class="detail">
              <dl class="facts">
                <div><dt>Project</dt><dd>{s.project}</dd></div>
                <div><dt>Messages</dt><dd>{s.messageCount}</dd></div>
                <div><dt>Tool calls</dt><dd>{s.toolCallCount}</dd></div>
                <div>
                  <dt>Pull requests</dt>
                  <dd class="prs">
                    {#each s.pullRequests as n (n)}
                      <a href="https://github.com/zerosumpain/SR-Main/pull/{n}" rel="noreferrer">#{n}</a>
                    {/each}
                  </dd>
                </div>
              </dl>

              <!-- Related changes, grouped: one session, every release it shipped. -->
              <div class="shipped">
                <span class="lbl">Shipped as</span>
                <span class="vers">
                  {#each s.releaseIds as rid (rid)}
                    <span class="ver">{versionById.get(rid) ?? `#${rid}`}</span>
                  {/each}
                </span>
              </div>

              <ol class="stages">
                {#each s.stages as st (st.ordinal)}
                  <li>
                    <span class="s-k" data-stage={STAGE_ORDER.includes(st.stage) ? st.stage : 'other'}>
                      {st.stage}
                    </span>
                    <span class="s-t">{st.title ?? '—'}</span>
                    <span class="s-c">{money(st.costUsd)}</span>
                  </li>
                {/each}
              </ol>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if band.unlinkedInWindow > 0}
    <p class="caveat">
      {band.unlinkedInWindow}
      {band.unlinkedInWindow === 1 ? 'session ran' : 'sessions ran'} in this window carrying no pull
      request, so nothing links {band.unlinkedInWindow === 1 ? 'it' : 'them'} to a release.
      {band.sessionsWithoutPrs} of all sessions on record are in that position — usually reading,
      debugging or planning work that shipped later under someone else's branch.
    </p>
  {/if}
</section>

<style>
  .band { margin-top: 3.5rem; }
  .hd h2 {
    font-family: var(--font-display);
    font-size: var(--fs-h3);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .sub {
    color: var(--text-muted);
    font-size: 0.86rem;
    line-height: 1.55;
    margin: 0.4rem 0 1.2rem;
    max-width: 62ch;
  }
  .empty,
  .caveat {
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.6;
    max-width: 66ch;
  }
  .caveat { margin-top: 1rem; border-top: 1px solid var(--rule); padding-top: 0.8rem; }

  .list { list-style: none; margin: 0; padding: 0; }
  .list > li { border-top: 1px solid var(--rule); }
  .list > li:last-child { border-bottom: 1px solid var(--rule); }

  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem 0.2rem;
    background: none;
    border: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .row:hover { background: var(--surface-2, transparent); }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .title {
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cost {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }

  /* The stage strip. Bars sit on a shared baseline so the heights compare. */
  .strip {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 46px;
  }
  .bar { width: 5px; background: var(--text-ghost); }
  .bar[data-stage='request'] { background: var(--accent-ink); }
  .bar[data-stage='design'] { background: color-mix(in srgb, var(--accent-ink) 62%, var(--accent)); }
  .bar[data-stage='plan'] { background: color-mix(in srgb, var(--accent-ink) 32%, var(--accent)); }
  .bar[data-stage='result'] { background: var(--accent); }
  .bar[data-stage='fixes'] { background: color-mix(in srgb, var(--accent) 60%, var(--text-ghost)); }

  .detail { padding: 0 0.2rem 1.1rem; }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 2rem;
    margin: 0 0 0.9rem;
  }
  .facts div { display: flex; gap: 0.5rem; align-items: baseline; }
  .facts dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .facts dd { margin: 0; font-size: 0.85rem; }
  .prs { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .prs a { font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-ink); }

  .shipped {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    flex-wrap: wrap;
    margin-bottom: 0.9rem;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .vers { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .ver {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    padding: 0.1rem 0.4rem;
    background: var(--surface-2, transparent);
    border: 1px solid var(--rule);
  }

  .stages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .stages li {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) auto;
    gap: 0.8rem;
    align-items: baseline;
    padding: 0.3rem 0;
    font-size: 0.82rem;
  }
  .s-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--accent-ink);
  }
  .s-k[data-stage='result'] { color: var(--accent); }
  .s-t { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }
  .s-c {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-ghost);
  }

  @media (max-width: 640px) {
    .row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0.4rem; }
    .when { grid-column: 1; }
    .strip { grid-column: 1 / -1; }
  }
</style>
