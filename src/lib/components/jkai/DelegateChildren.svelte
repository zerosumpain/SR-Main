<script lang="ts">
  import type { DelegateChild } from '$lib/workflows/chat/job-store';

  let { children }: { children: DelegateChild[] } = $props();

  // The tool chain arrives as one raw entry per call (often dozens of identical
  // `mcp_jkai_jkai_extended`), which spilled a wall of arrows. Collapse it into
  // consecutive runs and strip the `mcp_<server>_` namespace so it reads as a
  // short "jkai_extended ×39" chip instead. Kept behind a per-child toggle so the
  // default view is just the headline + summary.
  const open = $state<Record<number, boolean>>({});

  function runs(trace: { tool: string; status: string }[] = []) {
    const out: { tool: string; count: number; error: boolean }[] = [];
    for (const t of trace) {
      const name = (t.tool || '').replace(/^mcp_[^_]+_/, '') || 'tool';
      const error = t.status === 'error' || t.status === 'failed';
      const last = out[out.length - 1];
      if (last && last.tool === name) { last.count++; last.error = last.error || error; }
      else out.push({ tool: name, count: 1, error });
    }
    return out;
  }

  const dur = (s?: number) => (s == null ? '' : s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)} min`);
  const badge = (s: string) => (s === 'completed' || s === 'done' ? '✓' : s === 'error' || s === 'failed' ? '✗' : '·');
</script>

<ul class="subagents">
  {#each children as child (child.index)}
    {@const r = runs(child.toolTrace)}
    <li class="subagent" data-status={child.status}>
      <div class="sa-hdr">
        <span class="sa-badge" data-status={child.status}>{badge(child.status)}</span>
        <span class="sa-title">sub-agent {child.index + 1}</span>
        <span class="sa-meta mono">
          {#if child.model}{child.model}{/if}
          {#if child.apiCalls != null} · {child.apiCalls} call{child.apiCalls === 1 ? '' : 's'}{/if}
          {#if child.durationSeconds != null} · {dur(child.durationSeconds)}{/if}
        </span>
        {#if r.length}
          <button
            type="button"
            class="sa-trace-toggle"
            onclick={() => { open[child.index] = !open[child.index]; }}
            aria-expanded={open[child.index] ? 'true' : 'false'}
          >
            {open[child.index] ? 'hide chain' : `chain (${r.length})`}
          </button>
        {/if}
      </div>
      {#if child.summary}<div class="sa-summary">{child.summary}</div>{/if}
      {#if open[child.index] && r.length}
        <div class="sa-trace mono">
          {#each r as run, i (i)}<span class="sa-tool" data-error={run.error ? 'true' : 'false'}>{run.tool}{#if run.count > 1} ×{run.count}{/if}</span>{#if i < r.length - 1}<span class="sa-arrow">→</span>{/if}{/each}
        </div>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .subagents { list-style: none; margin: 7px 0 0; padding: 0 0 0 12px; display: flex; flex-direction: column; gap: 7px; border-left: 2px solid var(--card-border); }
  .subagent { font-size: var(--fs-label); }
  .sa-hdr { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .sa-badge { font-size: var(--fs-label-xs); flex-shrink: 0; color: var(--text-muted); }
  .sa-badge[data-status='completed'], .sa-badge[data-status='done'] { color: var(--status-success); }
  .sa-badge[data-status='error'], .sa-badge[data-status='failed'] { color: var(--status-error); }
  .sa-title { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); flex-shrink: 0; }
  .sa-meta { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .sa-trace-toggle {
    margin-left: auto;
    background: transparent;
    border: 0;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .sa-trace-toggle:hover { color: var(--text-primary); }
  .sa-summary { margin-top: 4px; font-size: var(--fs-label); line-height: 1.45; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; max-height: 9rem; overflow-y: auto; }
  .sa-trace { margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 3px; font-size: var(--fs-label-xs); }
  .sa-tool { background: var(--bg-section); border-radius: var(--radius-sharp); padding: 0 4px; color: var(--text-secondary); }
  .sa-tool[data-error='true'] { color: var(--status-error); }
  .sa-arrow { color: var(--text-ghost); }
</style>
