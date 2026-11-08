<script lang="ts">
  // Steps — a track of stages you can select, with per-stage state.
  //
  // Drawn as stations on a rail: a numbered node per stage, joined by a line that fills up to
  // the selected stage, so "where it has got to" reads before any label does. Wraps on a narrow
  // screen into a vertical rail. Selection is a callback prop, not an event.
  export type StepState = 'idle' | 'running' | 'done' | 'failed' | 'skipped';
  interface Item { id: string; label: string; sub?: string; state?: StepState }
  interface Props {
    items: Item[];
    selected?: string | null;
    onselect?: (id: string) => void;
    /** A colour override. Normally the page's part colour is right. */
    tone?: string;
    /** Show the connecting rail. Off for unordered sets. */
    railed?: boolean;
  }
  let { items, selected = null, onselect, tone, railed = true }: Props = $props();
  const at = $derived(items.findIndex((i) => i.id === selected));
</script>

<ol class="steps" class:railed style="--n:{items.length};{tone ? `--tone:${tone};--tone-text:${tone}` : ''}">
  {#each items as it, i (it.id)}
    <li class="step" data-state={it.state ?? 'idle'} class:past={railed && at >= 0 && i < at} class:on={selected === it.id}>
      <button class="s-btn" disabled={!onselect} onclick={() => onselect?.(it.id)}
              aria-pressed={onselect ? selected === it.id : undefined}>
        <span class="s-dot" aria-hidden="true">
          {#if it.state === 'done'}✓{:else if it.state === 'failed'}✕{:else if it.state === 'skipped'}–{:else}{i + 1}{/if}
        </span>
        <span class="s-txt">
          <b>{it.label}</b>
          {#if it.sub}<em>{it.sub}</em>{/if}
        </span>
      </button>
    </li>
  {/each}
</ol>

<style>
  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 0; }
  .step { position: relative; min-width: 0; }
  .railed .step::before { content: ''; position: absolute; top: 19px; left: 0; right: 0; height: 2px; background: var(--rule); }
  .railed .step:first-child::before { left: 50%; }
  .railed .step:last-child::before { right: 50%; }
  .railed .step.past::before, .railed .step.on::before { background: var(--tone-text); }
  .railed .step.on::before { right: 50%; }
  .railed .step.on:first-child::before { display: none; }

  .s-btn { position: relative; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
    padding: 0 6px 6px; border: none; background: none; cursor: pointer; font-family: inherit; color: inherit; }
  .s-btn:disabled { cursor: default; }
  .s-dot { position: relative; z-index: 1; width: 40px; height: 40px; border-radius: var(--radius-pill); display: grid; place-items: center;
    font-family: var(--er-mono); font-size: var(--fs-label); font-weight: 600; background: var(--ground); color: var(--fg-2);
    border: 2px solid var(--rule-strong); transition: background 0.3s, color 0.3s, border-color 0.3s, transform 0.4s var(--er-ease); }
  .s-btn:not(:disabled):hover .s-dot { border-color: var(--tone-text); transform: scale(1.06); }
  .past .s-dot { border-color: var(--tone-text); color: var(--tone-text); }
  .on .s-dot { background: var(--tone); border-color: var(--tone); color: #fff; transform: scale(1.12); }
  .s-txt { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .s-txt b { font-size: var(--fs-label); font-weight: 600; color: var(--fg); line-height: 1.25; }
  .on .s-txt b { color: var(--tone-text); }
  .s-txt em { font-style: normal; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); }

  .step[data-state='done'] .s-dot { border-color: var(--tone-text); color: var(--tone-text); }
  .step[data-state='failed'] .s-dot { background: var(--fail); border-color: var(--fail); color: #fff; }
  .step[data-state='failed'] .s-txt b { color: var(--fail); }
  .step[data-state='skipped'] { opacity: 0.4; }
  .step[data-state='skipped']::before { background: repeating-linear-gradient(90deg, var(--rule-strong) 0 4px, transparent 4px 8px) !important; }

  @media (max-width: 560px) {
    .steps { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    .railed .step::before { top: 0; bottom: 0; left: 19px !important; right: auto !important; width: 2px; height: auto; }
    .railed .step:first-child::before { top: 20px; }
    .railed .step:last-child::before { bottom: calc(100% - 20px); }
    .s-btn { flex-direction: row; text-align: left; padding: 4px 0; }
  }
</style>
