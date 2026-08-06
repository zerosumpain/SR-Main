<script lang="ts">
  // Steps — a horizontal track of stages you can select, with per-stage state.
  // Used for anything that is a sequence with a current position: the deploy pipeline, the
  // night build, a frame stream. Selection is a callback prop, not an event.
  export type StepState = 'idle' | 'running' | 'done' | 'failed' | 'skipped';
  interface Item { id: string; label: string; sub?: string; state?: StepState }
  interface Props {
    items: Item[];
    selected?: string | null;
    onselect?: (id: string) => void;
    tone?: string;
    /** Show the connecting rail. Off for unordered sets. */
    railed?: boolean;
  }
  let { items, selected = null, onselect, tone = 'var(--accent-ink)', railed = true }: Props = $props();
</script>

<div class="steps" class:railed style="--tone:{tone}">
  {#each items as it, i}
    <div class="step" data-state={it.state ?? 'idle'}>
      {#if railed && i > 0}<span class="rail" aria-hidden="true"></span>{/if}
      <button class="s-btn" class:on={selected === it.id} disabled={!onselect}
              onclick={() => onselect?.(it.id)}
              aria-pressed={onselect ? selected === it.id : undefined}>
        <span class="s-dot" aria-hidden="true">
          {#if it.state === 'done'}✓{:else if it.state === 'failed'}✕{:else if it.state === 'skipped'}–{:else}{i + 1}{/if}
        </span>
        <span class="s-txt">
          <b>{it.label}</b>
          {#if it.sub}<em>{it.sub}</em>{/if}
        </span>
      </button>
    </div>
  {/each}
</div>

<style>
  .steps { display: flex; gap: 4px; flex-wrap: wrap; align-items: stretch; }
  .step { position: relative; display: flex; align-items: stretch; flex: 1 1 140px; min-width: 0; }
  .rail { position: absolute; left: -4px; top: 50%; width: 4px; border-top: 1px solid rgba(28,22,17,0.22); }

  .s-btn { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; text-align: left;
    padding: 8px 10px; border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.55); cursor: pointer; font-family: inherit;
    transition: background 0.13s, border-color 0.13s; }
  .s-btn:disabled { cursor: default; }
  .s-btn:not(:disabled):hover { background: rgba(255,255,255,0.85); border-color: rgba(28,22,17,0.36); }
  .s-btn.on { border-color: var(--tone); background: color-mix(in srgb, var(--tone) 10%, transparent); }

  .s-dot { flex-shrink: 0; width: 20px; height: 20px; border-radius: var(--radius-pill);
    display: grid; place-items: center; font-family: 'JetBrains Mono', monospace; font-size: 10px;
    font-weight: 600; background: rgba(28,22,17,0.1); color: rgba(28,22,17,0.65); }
  .s-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .s-txt b { font-size: 12.5px; font-weight: 600; color: var(--text-primary); line-height: 1.25;
    overflow: hidden; text-overflow: ellipsis; }
  .s-txt em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: rgba(28,22,17,0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .step[data-state='running'] .s-dot { background: var(--tone); color: #fff; }
  .step[data-state='running'] .s-btn { border-color: var(--tone); }
  .step[data-state='done'] .s-dot { background: rgba(45,122,58,0.9); color: #fff; }
  .step[data-state='failed'] .s-dot { background: #c44; color: #fff; }
  .step[data-state='failed'] .s-btn { border-color: rgba(196,68,68,0.6); background: rgba(196,68,68,0.07); }
  .step[data-state='skipped'] { opacity: 0.5; }
</style>
