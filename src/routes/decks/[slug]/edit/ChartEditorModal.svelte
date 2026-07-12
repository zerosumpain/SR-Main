<script lang="ts">
  // Friendly chart editor — no JSON. Edits a draft copy per kind (series
  // tables, donut segments, sankey flows) with a live preview via the real
  // Chart component; Save validates through the registry before handing the
  // draft back. Opaque panel + local body portal (modal token rules).
  import Chart from '$lib/components/presentation/blocks/Chart.svelte';
  import { validateBlocks } from '$lib/presentation/registry';
  import { CHART_TEMPLATES } from '$lib/presentation/templates';
  import type { ChartBlock, ChartKind } from '$lib/presentation/types';

  let {
    block,
    onSave,
    onClose,
  }: {
    block: ChartBlock;
    onSave: (updated: ChartBlock) => void;
    onClose: () => void;
  } = $props();

  let draft = $state<ChartBlock>(structuredClone($state.snapshot(block)) as ChartBlock);
  let issues = $state<string[]>([]);

  const KINDS: { id: ChartKind; label: string; hint: string }[] = [
    { id: 'bar', label: 'bar', hint: 'comparison' },
    { id: 'line', label: 'line', hint: 'trend' },
    { id: 'area', label: 'area', hint: 'weighted trend' },
    { id: 'slope', label: 'slope', hint: 'before → after' },
    { id: 'scatter', label: 'scatter', hint: 'correlation' },
    { id: 'donut', label: 'donut', hint: 'share of whole' },
    { id: 'sankey', label: 'sankey', hint: 'flow' },
  ];

  const isSeries = $derived(['line', 'bar', 'area', 'scatter', 'slope'].includes(draft.kind));

  function switchKind(kind: ChartKind) {
    if (kind === draft.kind) return;
    const tpl = structuredClone(CHART_TEMPLATES[kind]);
    const wasSeries = isSeries;
    const willBeSeries = ['line', 'bar', 'area', 'scatter', 'slope'].includes(kind);
    draft.kind = kind;
    // carry data across compatible kinds; seed from the template otherwise
    if (willBeSeries && !(wasSeries && draft.series?.length)) draft.series = tpl.series;
    if (kind === 'donut' && !draft.segments?.length) draft.segments = tpl.segments;
    if (kind === 'sankey' && !draft.flows?.length) draft.flows = tpl.flows;
    if (kind === 'slope' && draft.series) {
      // slope needs ≥2 points per series
      for (const s of draft.series) while (s.points.length < 2) s.points.push({ x: s.points.length, y: 0 });
    }
    issues = [];
  }

  function save() {
    const clean = structuredClone($state.snapshot(draft)) as ChartBlock;
    // drop data fields foreign to the kind so the registry stays happy
    if (isSeries) {
      delete clean.segments;
      delete clean.flows;
    } else if (clean.kind === 'donut') {
      delete clean.series;
      delete clean.flows;
    } else {
      delete clean.series;
      delete clean.segments;
    }
    if (!clean.title) delete clean.title;
    if (!clean.xLabel) delete clean.xLabel;
    if (!clean.yLabel) delete clean.yLabel;
    if (!clean.xLabels?.length) delete clean.xLabels;
    const res = validateBlocks([clean]);
    if (!res.ok) {
      issues = res.issues;
      return;
    }
    onSave(clean);
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
</script>

<svelte:window onkeydown={onKeydown} />

<div class="cem-backdrop" use:portal role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="cem" role="dialog" aria-modal="true" aria-label="Edit chart">
    <header class="cem-hd">
      <span class="cem-title">EDIT CHART</span>
      <div class="kinds">
        {#each KINDS as k (k.id)}
          <button class:active={draft.kind === k.id} title={k.hint} onclick={() => switchKind(k.id)}>{k.label}</button>
        {/each}
      </div>
      <button class="cem-x" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <div class="cem-body">
      <div class="col form-col">
        <label class="field">
          <span class="lab">TITLE</span>
          <input type="text" value={draft.title ?? ''} oninput={(e) => (draft.title = e.currentTarget.value)} />
        </label>

        {#if isSeries}
          {#each draft.series ?? [] as s, si (si)}
            <div class="series">
              <div class="series-hd">
                <input class="series-label" type="text" value={s.label} oninput={(e) => (s.label = e.currentTarget.value)} title="Series label" />
                {#if (draft.series?.length ?? 0) > 1}
                  <button class="mini danger" onclick={() => draft.series?.splice(si, 1)} title="Remove series">✕ series</button>
                {/if}
              </div>
              <div class="pts">
                <span class="pts-lab">x</span><span class="pts-lab">y</span><span></span>
                {#each s.points as p, pi (pi)}
                  <input type="number" step="any" value={p.x} oninput={(e) => (p.x = num(e.currentTarget.value))} />
                  <input type="number" step="any" value={p.y} oninput={(e) => (p.y = num(e.currentTarget.value))} />
                  <button
                    class="mini danger"
                    disabled={s.points.length <= (draft.kind === 'slope' ? 2 : 1)}
                    onclick={() => s.points.splice(pi, 1)}
                    title="Remove point">✕</button
                  >
                {/each}
              </div>
              <button class="mini" onclick={() => s.points.push({ x: (s.points.at(-1)?.x ?? 0) + 1, y: s.points.at(-1)?.y ?? 0 })}>+ point</button>
            </div>
          {/each}
          {#if (draft.series?.length ?? 0) < 5}
            <button class="mini add" onclick={() => draft.series?.push({ label: `series ${(draft.series?.length ?? 0) + 1}`, points: structuredClone($state.snapshot(draft.series?.[0]?.points ?? [{ x: 0, y: 0 }])) })}>
              + series
            </button>
          {/if}
          {#if draft.kind === 'bar' || draft.kind === 'slope'}
            <label class="field">
              <span class="lab">{draft.kind === 'slope' ? 'END LABELS (two, comma-separated)' : 'CATEGORY LABELS (comma-separated, in x order)'}</span>
              <input
                type="text"
                value={(draft.xLabels ?? []).join(', ')}
                oninput={(e) => (draft.xLabels = e.currentTarget.value.split(',').map((v) => v.trim()).filter(Boolean))}
              />
            </label>
          {/if}
          {#if draft.kind !== 'slope'}
            <div class="axis-row">
              <label class="field grow"><span class="lab">X AXIS LABEL</span><input type="text" value={draft.xLabel ?? ''} oninput={(e) => (draft.xLabel = e.currentTarget.value)} /></label>
              <label class="field grow"><span class="lab">Y AXIS LABEL</span><input type="text" value={draft.yLabel ?? ''} oninput={(e) => (draft.yLabel = e.currentTarget.value)} /></label>
            </div>
          {/if}
        {:else if draft.kind === 'donut'}
          <span class="lab">SEGMENTS — SHARES OF THE WHOLE</span>
          {#each draft.segments ?? [] as seg, i (i)}
            <div class="row3">
              <input type="text" placeholder="label" value={seg.label} oninput={(e) => (seg.label = e.currentTarget.value)} />
              <input type="number" step="any" placeholder="value" value={seg.value} oninput={(e) => (seg.value = num(e.currentTarget.value))} />
              <button class="mini danger" disabled={(draft.segments?.length ?? 0) <= 2} onclick={() => draft.segments?.splice(i, 1)}>✕</button>
            </div>
          {/each}
          {#if (draft.segments?.length ?? 0) < 8}
            <button class="mini add" onclick={() => draft.segments?.push({ label: 'segment', value: 10 })}>+ segment</button>
          {/if}
        {:else}
          <span class="lab">FLOWS — FROM → TO, RIBBON = VALUE (no cycles)</span>
          {#each draft.flows ?? [] as f, i (i)}
            <div class="row4">
              <input type="text" placeholder="from" value={f.from} oninput={(e) => (f.from = e.currentTarget.value)} />
              <input type="text" placeholder="to" value={f.to} oninput={(e) => (f.to = e.currentTarget.value)} />
              <input type="number" step="any" placeholder="value" value={f.value} oninput={(e) => (f.value = num(e.currentTarget.value))} />
              <button class="mini danger" disabled={(draft.flows?.length ?? 0) <= 1} onclick={() => draft.flows?.splice(i, 1)}>✕</button>
            </div>
          {/each}
          {#if (draft.flows?.length ?? 0) < 24}
            <button class="mini add" onclick={() => draft.flows?.push({ from: 'a', to: 'b', value: 10 })}>+ flow</button>
          {/if}
        {/if}

        {#if issues.length}
          <ul class="issues">
            {#each issues as issue (issue)}<li>{issue}</li>{/each}
          </ul>
        {/if}
      </div>

      <div class="col preview-col">
        <span class="lab">LIVE PREVIEW</span>
        <div class="cem-preview">
          {#key JSON.stringify($state.snapshot(draft))}
            <Chart block={draft} />
          {/key}
        </div>
        <button class="save" onclick={save}>apply chart</button>
      </div>
    </div>
  </div>
</div>

<style>
  .cem-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    background: rgba(26, 16, 8, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4vh 4vw;
  }
  .cem {
    width: min(1100px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-elevated);
    border: 2px solid var(--text-primary);
    border-radius: 4px;
    overflow: hidden;
  }
  .cem-hd {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 2px solid var(--text-primary);
  }
  .cem-title { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em; font-weight: 600; color: var(--text-primary); }
  .kinds { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; }
  .kinds button {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .kinds button.active { color: var(--accent); border-color: var(--accent); }
  .cem-x { font-size: 13px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
  .cem-x:hover { color: var(--error); }

  .cem-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 380px 1fr;
    gap: 18px;
    padding: 14px 16px;
    overflow: hidden;
  }
  .col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .form-col { overflow-y: auto; padding-right: 4px; }
  .preview-col { overflow-y: auto; }
  .lab { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.16em; color: var(--text-muted); }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field.grow { flex: 1; }
  .axis-row { display: flex; gap: 10px; }
  input {
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
  }
  .series { border: 1px solid var(--card-border); border-radius: 2px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .series-hd { display: flex; gap: 8px; align-items: center; }
  .series-label { font-weight: 600; }
  .pts { display: grid; grid-template-columns: 1fr 1fr 32px; gap: 4px; align-items: center; }
  .pts-lab { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-ghost); text-align: center; }
  .mini {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-muted);
    background: none;
    border: 1px dashed var(--card-border);
    border-radius: 2px;
    padding: 4px 8px;
    cursor: pointer;
    align-self: flex-start;
  }
  .mini:hover { color: var(--accent); border-color: var(--accent); }
  .mini.danger:hover { color: var(--error); border-color: var(--error); }
  .mini:disabled { opacity: 0.35; cursor: default; }
  .mini.add { align-self: stretch; text-align: center; }
  .row3 { display: grid; grid-template-columns: 2fr 1fr 32px; gap: 6px; }
  .row4 { display: grid; grid-template-columns: 1.5fr 1.5fr 1fr 32px; gap: 6px; }
  .issues { margin: 0; padding-left: 16px; font-family: var(--font-mono); font-size: 10px; color: var(--error); }

  .cem-preview {
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 18px;
    --ink: var(--text-primary);
    --ink-soft: var(--text-muted);
  }
  .save {
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--accent-ink);
    border: none;
    border-radius: 2px;
    padding: 10px 18px;
    cursor: pointer;
    align-self: flex-start;
  }
  .save:hover { background: var(--accent-ink-hover); }

  @media (max-width: 900px) {
    .cem-body { grid-template-columns: 1fr; overflow-y: auto; }
  }
</style>
