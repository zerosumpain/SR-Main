<script lang="ts">
  type Phase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'awaiting_user' | 'stalled';

  interface Props {
    phase: Phase;
    label: string;
    elapsedSec: number;
    watchdog?: { idleMs: number; idleLimitMs: number };
    onClick?: () => void;
  }

  let { phase = 'idle', label, elapsedSec, watchdog, onClick }: Props = $props();

  const colour: Record<Phase, string> = {
    idle: 'var(--surface-mute, #888)',
    thinking: 'var(--info, #4a8cff)',
    streaming: 'var(--success, #2eaf5f)',
    tool: 'var(--warning, #d99a3a)',
    awaiting_user: 'var(--accent, #8b6cd1)',
    stalled: 'var(--danger, #d24b4b)',
  };

  let countdownSec = $derived(
    watchdog ? Math.max(0, Math.round((watchdog.idleLimitMs - watchdog.idleMs) / 1000)) : null,
  );
</script>

<button class="pill" style:--pill-color={colour[phase]} onclick={() => onClick?.()} aria-live="polite">
  <span class="dot" data-phase={phase}></span>
  <span class="label">{label}</span>
  <span class="elapsed">{elapsedSec}s</span>
  {#if countdownSec !== null && phase === 'stalled'}
    <span class="watchdog" title="Watchdog will terminate after {watchdog!.idleLimitMs / 1000}s idle">
      kill in {countdownSec}s
    </span>
  {/if}
</button>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.6rem;
    background: color-mix(in srgb, var(--pill-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--pill-color) 40%, transparent);
    color: var(--pill-color);
    border-radius: 999px;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .pill:hover { background: color-mix(in srgb, var(--pill-color) 22%, transparent); }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--pill-color);
  }
  .dot[data-phase='streaming'],
  .dot[data-phase='thinking'] {
    animation: pulse 1.6s ease-in-out infinite;
  }
  .dot[data-phase='stalled'] {
    animation: pulse 0.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }
  .elapsed { opacity: 0.7; font-variant-numeric: tabular-nums; }
  .watchdog { opacity: 0.9; font-weight: 600; }
</style>
