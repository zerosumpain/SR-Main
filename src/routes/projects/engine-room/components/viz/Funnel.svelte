<script lang="ts">
  // Funnel — successive stages, each narrower than the last, with the drop between them
  // named. The loss is the story on every funnel in this study, so the drop is drawn as a
  // labelled gap rather than left to be inferred from two numbers.
  interface Stage { label: string; value: number; note?: string; lossLabel?: string }
  interface Props {
    stages: Stage[];
    unit?: string;
    tone?: string;
    height?: number;
  }
  let { stages, unit = '', tone, height = 40 }: Props = $props();

  const top = $derived(Math.max(...stages.map((s) => s.value), 1));
  const pct = (v: number) => Math.max((v / top) * 100, 1.5);
  const fmt = (v: number) => v.toLocaleString('en-GB');

  const summary = $derived(
    'Funnel: ' + stages.map((s) => `${s.label} ${fmt(s.value)}${unit}`).join(', then ') + '.',
  );
  import { shown } from '../../lib/motion';
</script>

<div class="fn" {@attach shown()} style={tone ? `--tone:${tone}` : ""} role="img" aria-label={summary}>
  {#each stages as s, i (s.label)}
    <div class="fs">
      <div class="f-row">
        <span class="f-lab">{s.label}</span>
        <div class="f-track" style="height:{height}px">
          <div class="f-fill" style="width:{pct(s.value)}%"></div>
          <span class="f-val">{fmt(s.value)}{unit}</span>
        </div>
      </div>
      {#if s.note}<p class="f-note">{s.note}</p>{/if}
      {#if i < stages.length - 1}
        {@const drop = s.value - stages[i + 1].value}
        {#if drop > 0}
          <p class="f-drop">
            <span class="d-arrow" aria-hidden="true">↓</span>
            <b>−{fmt(drop)}</b>
            {stages[i + 1].lossLabel ?? 'dropped'}
          </p>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .fn { display: flex; flex-direction: column; gap: 2px; }
  .f-row { display: grid; grid-template-columns: minmax(90px, 20ch) 1fr; gap: 11px; align-items: center; }
  .f-lab { font-size: var(--fs-label); line-height: 1.3; color: var(--fg-2); text-align: right; }
  .f-track { position: relative; display: flex; align-items: center; background: var(--wash);
    border-radius: var(--radius-sharp); overflow: hidden; }
  .f-fill { position: absolute; inset: 0 auto 0 0; background: var(--tone); opacity: 0.75;
    transition: width 0.4s cubic-bezier(0.3,0,0.2,1); }
  .f-val { position: relative; margin-left: 10px; font-family: var(--er-mono);
    font-size: var(--fs-label-xs); font-weight: 600; color: var(--fg);
     }
  .f-note { margin: 2px 0 0; padding-left: calc(20ch + 11px); font-size: var(--fs-label-xs); line-height: 1.45; color: var(--fg-3); }
  .f-drop { display: flex; align-items: center; gap: 6px; margin: 3px 0 3px;
    padding-left: calc(20ch + 11px); font-family: var(--er-mono); font-size: var(--fs-label-xs);
    color: var(--fg-3); }
  .f-drop b { color: var(--accent); font-weight: 600; }
  .d-arrow { color: var(--fg-3); }

  @media (max-width: 560px) {
    .f-row { grid-template-columns: 1fr; gap: 3px; }
    .f-lab { text-align: left; }
    .f-note, .f-drop { padding-left: 0; }
  }
  .fn:global([data-armed]) .f-fill { transform-origin: left; transform: scaleX(0); transition: transform 1.1s var(--er-ease), width 0.45s var(--er-ease); }
  .fn:global([data-armed][data-shown]) .f-fill { transform: none; }
</style>
