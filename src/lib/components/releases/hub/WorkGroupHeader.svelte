<script lang="ts">
  import type { WorkGroup } from './work-groups';

  let { group }: { group: WorkGroup } = $props();

  const stages = ['request', 'design', 'plan', 'result', 'fixes'];

  function money(n: number | null): string {
    if (n === null) return '—';
    return n >= 1 ? `$${n.toFixed(2)}` : `${(n * 100).toFixed(1)}¢`;
  }

  function barHeight(cost: number | null, max: number): number {
    if (!cost || max <= 0) return 8;
    return Math.max(6, Math.round((cost / max) * 32));
  }

  function date(value: Date | string | null): string {
    return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
  }
</script>

<div class="group-head" class:unlinked={group.sessions.length === 0}>
  <div class="group-label">
    <span class="eyebrow">{group.sessions.length ? 'Work sessions' : 'Session not recorded'}</span>
    <span class="group-count">
      {group.releases.length} {group.releases.length === 1 ? 'release' : 'releases'}
      <span aria-hidden="true">·</span>
      {group.commitCount} {group.commitCount === 1 ? 'commit' : 'commits'}
    </span>
  </div>

  {#if group.sessions.length === 0}
    <p class="unlinked-note">No PR-linked session is on record for this release.</p>
  {:else}
    {#each group.sessions as session (session.id)}
      {@const maxCost = Math.max(0, ...session.stages.map((stage) => stage.costUsd ?? 0))}
      <details class="session">
        <summary>
          <span class="session-date">{date(session.startedAt)}</span>
          <span class="session-title">{session.title ?? 'Untitled session'}</span>
          <span class="strip" aria-hidden="true">
            {#each session.stages as stage (stage.ordinal)}
              <span
                class="bar"
                data-stage={stages.includes(stage.stage) ? stage.stage : 'other'}
                style="height:{barHeight(stage.costUsd, maxCost)}px"
              ></span>
            {/each}
          </span>
          <span class="cost" title={session.costKnown ? 'Recorded estimate' : 'Partial estimate'}>
            {session.costKnown ? '' : '~'}{money(session.estCostUsd)}
          </span>
          <span class="chev" aria-hidden="true">▾</span>
        </summary>
        <div class="session-detail">
          <p class="session-context">
            {session.project} · {session.messageCount} messages · {session.toolCallCount} tool calls
            {#if session.pullRequests.length}
              · PR {#each session.pullRequests as pr, i (pr)}{#if i > 0}, {/if}<a href="https://github.com/zerosumpain/SR-Main/pull/{pr}" rel="noreferrer">#{pr}</a>{/each}
            {/if}
          </p>
          {#if session.stages.length}
            <ol class="stages">
              {#each session.stages as stage (stage.ordinal)}
                <li>
                  <span class="stage-name">{stage.stage}</span>
                  <span class="stage-title">{stage.title ?? '—'}</span>
                  <span class="stage-cost">{money(stage.costUsd)}</span>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </details>
    {/each}
  {/if}
</div>

<style>
  .group-head { background: var(--surface-sunken); border-top: 2px solid var(--text-primary); padding: 8px 12px 6px; }
  .group-head.unlinked { border-top-color: var(--line-strong); }
  .group-label { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; margin-bottom: 5px; }
  .eyebrow, .group-count, .session-date, .cost, .session-context, .stage-name, .stage-cost {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-variant-numeric: tabular-nums;
  }
  .eyebrow { color: var(--accent); text-transform: uppercase; letter-spacing: var(--tracking-label); font-weight: 700; }
  .group-count { color: var(--text-muted); white-space: nowrap; }
  .unlinked-note { color: var(--text-muted); font-size: var(--fs-label); margin: 0.5rem 0 0; }
  .session { border-top: 1px solid var(--line-hair); }
  .session summary { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr) auto auto 1rem; gap: 0.75rem; align-items: center; min-height: 45px; cursor: pointer; list-style: none; }
  .session summary::-webkit-details-marker { display: none; }
  .session summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .session-date { color: var(--text-ghost); white-space: nowrap; }
  .session-title { font-size: var(--fs-body-sm); font-weight: 600; line-height: 1.35; min-width: 0; overflow-wrap: anywhere; }
  .strip { display: flex; align-items: flex-end; gap: 2px; height: 32px; }
  .bar { width: 5px; min-height: 6px; background: var(--text-ghost); }
  .bar[data-stage='request'] { background: var(--accent-ink); }
  .bar[data-stage='design'] { background: color-mix(in srgb, var(--accent-ink) 62%, var(--accent)); }
  .bar[data-stage='plan'] { background: color-mix(in srgb, var(--accent-ink) 32%, var(--accent)); }
  .bar[data-stage='result'] { background: var(--accent); }
  .bar[data-stage='fixes'] { background: color-mix(in srgb, var(--accent) 60%, var(--text-ghost)); }
  .cost { color: var(--text-secondary); text-align: right; white-space: nowrap; }
  .chev { color: var(--text-ghost); transition: transform var(--t-fast) var(--ease-out); }
  .session[open] .chev { transform: rotate(180deg); }
  .session-detail { padding: 0 0 8px 5.5rem; }
  .session-context { color: var(--text-muted); line-height: 1.5; margin: 0 0 8px; }
  .session-context a { color: var(--accent-ink); }
  .stages { list-style: none; margin: 0; padding: 0; }
  .stages li { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr) auto; gap: 0.8rem; padding: 3px 0; border-top: 1px solid var(--line-hair); }
  .stage-name { text-transform: uppercase; color: var(--accent-ink); }
  .stage-title { font-size: var(--fs-label); color: var(--text-secondary); }
  .stage-cost { color: var(--text-muted); white-space: nowrap; }
  @media (max-width: 680px) {
    .group-label { flex-wrap: wrap; gap: 0.2rem 1rem; }
    .session summary { grid-template-columns: minmax(0, 1fr) auto 1rem; gap: 0.4rem 0.7rem; padding: 8px 0; }
    .session-date { grid-column: 1; }
    .session-title { grid-column: 1 / -1; grid-row: 2; }
    .strip { grid-column: 1; grid-row: 3; }
    .cost { grid-column: 2; grid-row: 1; }
    .chev { grid-column: 3; grid-row: 1; }
    .session-detail { padding-left: 0; }
  }
</style>
