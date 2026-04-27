<script lang="ts">
  interface Step { id: string; title: string }
  interface PlanInfo { steps: Step[]; activeStepId: string | null; coveredStepIds: string[] }
  interface EventEntry { type: string; summary: string; relMs: number }
  interface PulseEntry { id: string; kind: string; severity: 'info' | 'warn' | 'error'; summary: string; relMs: number }

  interface Props {
    phase: string;
    label: string;
    watchdog: { idleMs: number; idleLimitMs: number; totalMs: number; totalLimitMs: number };
    plan: PlanInfo | null;
    events: EventEntry[];
    pulseEvents: PulseEntry[];
    onClose: () => void;
  }

  let { phase, label, watchdog, plan, events, pulseEvents, onClose }: Props = $props();

  function fmtRel(ms: number): string {
    if (ms < 1000) return 'now';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    return `${Math.round(ms / 60_000)}m ago`;
  }
</script>

<div class="panel" role="dialog" aria-label="Orchestrator status">
  <header class="head">
    <strong>{label}</strong>
    <span class="phase">{phase}</span>
    <button onclick={onClose} aria-label="Close" class="close">×</button>
  </header>

  <section>
    <h4>Watchdog</h4>
    <ul class="meters">
      <li>Idle: {Math.round(watchdog.idleMs / 1000)}s / {Math.round(watchdog.idleLimitMs / 1000)}s</li>
      <li>Total: {Math.round(watchdog.totalMs / 1000)}s / {Math.round(watchdog.totalLimitMs / 1000)}s</li>
    </ul>
  </section>

  {#if plan}
    <section>
      <h4>Plan</h4>
      <ol class="steps">
        {#each plan.steps as step}
          <li
            class:active={plan.activeStepId === step.id}
            class:covered={plan.coveredStepIds.includes(step.id)}
          >
            {step.title}
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <section>
    <h4>Recent events</h4>
    <ul class="events">
      {#each events as e}
        <li><code>{e.type}</code> {e.summary} <span class="rel">{fmtRel(e.relMs)}</span></li>
      {/each}
      {#if events.length === 0}<li class="empty">No events yet</li>{/if}
    </ul>
  </section>

  {#if pulseEvents.length > 0}
    <section>
      <h4>Background activity</h4>
      <ul class="pulse">
        {#each pulseEvents as p}
          <li class="sev-{p.severity}"><strong>{p.kind}</strong> {p.summary} <span class="rel">{fmtRel(p.relMs)}</span></li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .panel {
    background: var(--surface, #181818);
    border: 1px solid var(--border, #333);
    border-radius: 12px;
    padding: 0.9rem 1rem;
    max-width: 380px;
    font-size: 0.82rem;
    color: var(--text, #e6e6e6);
  }
  .head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
  .head .phase { opacity: 0.6; font-size: 0.72rem; }
  .head .close { margin-left: auto; background: transparent; border: 0; color: inherit; font-size: 1.1rem; cursor: pointer; }
  h4 { margin: 0.5rem 0 0.3rem; font-size: 0.74rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; }
  ul, ol { margin: 0; padding-left: 1.1rem; }
  .meters { padding-left: 0; list-style: none; }
  .meters li { font-variant-numeric: tabular-nums; }
  .steps li.active { font-weight: 600; color: var(--accent, #8b6cd1); }
  .steps li.covered { opacity: 0.55; text-decoration: line-through; }
  .events code { background: rgba(255,255,255,0.06); padding: 0 0.3em; border-radius: 4px; }
  .rel { opacity: 0.6; }
  .pulse li.sev-warn { color: var(--warning, #d99a3a); }
  .pulse li.sev-error { color: var(--danger, #d24b4b); }
  .empty { opacity: 0.5; }
</style>
