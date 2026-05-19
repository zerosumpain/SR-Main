<script lang="ts" module>
  /** Exported type — import via `import { type Execution } from '...'` */
  export interface Execution {
    id: string;
    runId: string;
    status: string;
    inputData: unknown;
    outputData: unknown;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
    costUsd: number | null;
  }
</script>

<script lang="ts">
  import { formatUsd } from './stats/costFormat';

  interface Props {
    executions: Execution[];
    selectedId: string | null;
    onselect: (id: string) => void;
  }
  let { executions, selectedId, onselect }: Props = $props();

  function relative(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
  }
</script>

<div class="ih" role="tablist" aria-label="Execution history">
  {#each executions as e (e.id)}
    <button
      class="dot"
      class:active={e.id === selectedId}
      class:s-completed={e.status === 'completed'}
      class:s-failed={e.status === 'failed'}
      class:s-running={e.status === 'running'}
      title={`${e.status} · ${relative(e.completedAt ?? e.startedAt)} ago${e.costUsd ? ' · ' + formatUsd(e.costUsd) : ''}${e.error ? '\n' + e.error.slice(0, 200) : ''}`}
      onclick={() => onselect(e.id)}
      role="tab"
      aria-selected={e.id === selectedId}
    >
      <span class="rel">{relative(e.completedAt ?? e.startedAt)}</span>
    </button>
  {/each}
</div>

<style>
  .ih {
    display: flex;
    gap: 2px;
    padding: 4px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  }
  .dot {
    flex: 0 0 auto;
    background: var(--bg-card, rgba(255,255,255,0.04));
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    color: var(--text-muted, #888);
    padding: 2px 6px;
    font: 9px / 1 ui-monospace, Menlo, monospace;
    border-radius: 2px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .dot:hover { background: var(--bg-hover, rgba(255,255,255,0.08)); }
  .dot.active {
    background: var(--accent, #3a8a56);
    color: white;
    border-color: var(--accent, #3a8a56);
  }
  .dot.s-completed { border-left: 2px solid #3a8a56; }
  .dot.s-failed    { border-left: 2px solid #c44; }
  .dot.s-running   { border-left: 2px solid #ffcf40; }
  .rel { font-weight: 600; }
</style>
