<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface StageEvent {
    stage: string;
    iteration?: number;
    totalEstimate?: number;
    previewUrl?: string | null;
    failureKind?: string;
    message?: string;
  }

  let { buildId, variant = 'sticky' }: { buildId: string; variant?: 'sticky' | 'inline' } = $props();

  let stage = $state<StageEvent | null>(null);
  let lastActivity = $state<string>('');
  let startedAt = $state<number>(Date.now());
  let elapsedMs = $state<number>(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let es: EventSource | null = null;

  function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  }

  function isTerminal(s: string | undefined): boolean {
    return s === 'completed' || s === 'failed';
  }

  function stageLabel(): string {
    if (!stage) return 'Starting…';
    switch (stage.stage) {
      case 'planning': return 'Planning';
      case 'awaiting_plan_approval': return 'Plan ready — awaiting approval';
      case 'iterating': {
        const itLabel = stage.iteration ? `Iteration ${stage.iteration}` : 'Iterating';
        const total = stage.totalEstimate ? ` / ~${stage.totalEstimate}` : '';
        return `${itLabel}${total}`;
      }
      case 'running_tests': return stage.iteration ? `Iteration ${stage.iteration} — running tests` : 'Running tests';
      case 'promoting': return 'Promoting';
      case 'awaiting_iter_approval': return stage.iteration ? `Iteration ${stage.iteration} complete — awaiting approval` : 'Awaiting iteration approval';
      case 'paused': return 'Paused';
      case 'completed': return `✓ Completed in ${formatDuration(elapsedMs)}`;
      case 'failed': return `× Failed: ${stage.failureKind ?? 'unknown'}`;
      default: return stage.stage;
    }
  }

  function statusColor(): string {
    if (!stage) return 'var(--text-secondary)';
    if (stage.stage === 'completed') return 'var(--color-emerald, #10b981)';
    if (stage.stage === 'failed') return 'var(--color-red, #ef4444)';
    if (stage.stage === 'paused' || stage.stage === 'awaiting_plan_approval' || stage.stage === 'awaiting_iter_approval') {
      return 'var(--color-amber, #f59e0b)';
    }
    return 'var(--color-cyan, #06b6d4)';
  }

  onMount(() => {
    startedAt = Date.now();
    elapsedTimer = setInterval(() => {
      if (!stage || !isTerminal(stage.stage)) elapsedMs = Date.now() - startedAt;
    }, 1000);

    es = new EventSource(`/api/jkai/builds/${buildId}/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'stage') {
          const parsed = JSON.parse(data.content) as StageEvent;
          // Preserve previewUrl across stage transitions if not set on the new event
          stage = parsed.previewUrl !== undefined ? parsed : { ...parsed, previewUrl: stage?.previewUrl ?? null };
        } else if (data.type === 'system' && typeof data.content === 'string') {
          lastActivity = data.content.slice(0, 120);
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do
    };
  });

  onDestroy(() => {
    if (es) {
      es.close();
      es = null;
    }
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  });

  let visible = $derived(variant === 'inline' || (stage ? !isTerminal(stage.stage) : true));
</script>

{#if visible}
  <div class="build-pill" class:inline={variant === 'inline'} class:sticky={variant === 'sticky'} role="status">
    <span class="dot" style:background={statusColor()}></span>
    <span class="label">{stageLabel()}</span>
    <span class="elapsed">· {formatDuration(elapsedMs)}</span>
    {#if stage?.previewUrl}
      <a href={stage.previewUrl} target="_blank" rel="noopener noreferrer" class="link">Open preview</a>
    {/if}
    <a href={`/jkai/builds/${buildId}`} class="link secondary">Build →</a>
  </div>
{/if}

<style>
  .build-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--border-default, rgba(255,255,255,0.08));
    background: var(--bg-elevated, rgba(255,255,255,0.04));
    font-family: var(--font-mono, 'DM Mono', ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--text-primary);
  }
  .build-pill.inline {
    margin: 0.5rem 0;
  }
  .build-pill.sticky {
    width: 100%;
    border-radius: 8px;
    justify-content: flex-start;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .label {
    font-weight: 500;
  }
  .elapsed {
    color: var(--text-secondary);
  }
  .link {
    margin-left: auto;
    color: var(--text-link, #60a5fa);
    text-decoration: none;
  }
  .link:hover {
    text-decoration: underline;
  }
  .link.secondary {
    margin-left: 0.5rem;
    color: var(--text-secondary);
  }
</style>
