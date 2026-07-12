<script lang="ts">
  // Shape-driven editor for one block, with three curated exceptions:
  // prose gets a style dropdown + a formatting toolbar (H1–H4 / B / I / U over
  // the markdown-lite body), charts open the friendly ChartEditorModal instead
  // of raw fields, and everything else renders from the block object's own
  // shape (the zod registry is the validation gate on save). Mutates the
  // parent-owned $state draft directly and reports edits via onEdited().
  import { EFFECTS, EFFECT_CATEGORIES } from '$lib/presentation/effects';
  import type { ChartBlock } from '$lib/presentation/types';
  import ChartEditorModal from './ChartEditorModal.svelte';

  let { block, onEdited }: { block: Record<string, unknown>; onEdited: () => void } = $props();

  const LONG_TEXT = new Set(['body', 'thesis', 'text', 'detail', 'sub', 'description']);

  const keys = $derived(Object.keys(block).filter((k) => k !== 'type' && !(block.type === 'prose' && (k === 'style' || k === 'lede'))));

  const isProse = $derived(block.type === 'prose');
  const isChart = $derived(block.type === 'chart');
  const isEffect = $derived(block.type === 'effect');
  let chartOpen = $state(false);

  const effectDef = $derived(isEffect ? EFFECTS[String(block.effect)] : undefined);

  function setEffect(id: string) {
    const def = EFFECTS[id];
    if (!def) return;
    block.effect = id;
    // keep the role legal for the chosen effect
    if (!def.roles.includes(block.role as 'background' | 'transition')) block.role = def.roles[0];
    onEdited();
  }
  // textarea handle for the prose toolbar — plain let (nothing reactive reads it)
  let bodyTa: HTMLTextAreaElement | null = null;

  const PROSE_STYLES = [
    { id: 'body', label: 'body — paragraphs' },
    { id: 'lede', label: 'lede — large opener' },
    { id: 'band', label: 'band — inverted emphasis' },
    { id: 'cards', label: 'cards — paragraph cards' },
    { id: 'aside', label: 'aside — mono footnote' },
    { id: 'pull', label: 'pull — italic pull-text' },
    { id: 'columns', label: 'columns — two-column body' },
    { id: 'callout', label: 'callout — petrol note box' },
  ];
  const proseStyle = $derived(
    typeof block.style === 'string' ? block.style : block.lede ? 'lede' : 'body',
  );

  function setProseStyle(style: string) {
    block.style = style;
    delete block.lede; // style supersedes the legacy flag
    onEdited();
  }

  /** Wrap the textarea selection (or the caret word) with markers. */
  function wrapSel(before: string, after = before) {
    if (!bodyTa) return;
    const v = String(block.body ?? '');
    const s = bodyTa.selectionStart ?? 0;
    const e = bodyTa.selectionEnd ?? s;
    const sel = v.slice(s, e) || 'text';
    block.body = v.slice(0, s) + before + sel + after + v.slice(e);
    onEdited();
    const ta = bodyTa;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  }

  /** Toggle a #-heading prefix on the line the caret sits in. */
  function setHeading(level: number) {
    if (!bodyTa) return;
    const v = String(block.body ?? '');
    const caret = bodyTa.selectionStart ?? 0;
    const lineStart = v.lastIndexOf('\n', caret - 1) + 1;
    const lineEnd = v.indexOf('\n', caret);
    const end = lineEnd === -1 ? v.length : lineEnd;
    const line = v.slice(lineStart, end);
    const stripped = line.replace(/^#{1,4}\s+/, '');
    const already = line.match(/^(#{1,4})\s/)?.[1].length === level;
    const next = already ? stripped : `${'#'.repeat(level)} ${stripped}`;
    block.body = v.slice(0, lineStart) + next + v.slice(end);
    onEdited();
    const ta = bodyTa;
    requestAnimationFrame(() => ta.focus());
  }

  function chartSummary(): string {
    const c = block as unknown as ChartBlock;
    if (c.kind === 'donut') return `donut · ${c.segments?.length ?? 0} segments`;
    if (c.kind === 'sankey') return `sankey · ${c.flows?.length ?? 0} flows`;
    const pts = (c.series ?? []).reduce((a, s) => a + s.points.length, 0);
    return `${c.kind} · ${c.series?.length ?? 0} series · ${pts} points`;
  }

  function applyChart(updated: ChartBlock) {
    for (const k of Object.keys(block)) if (k !== 'type') delete block[k];
    Object.assign(block, updated);
    chartOpen = false;
    onEdited();
  }

  function kind(v: unknown): 'string' | 'number' | 'boolean' | 'strings' | 'rows' | 'json' {
    if (typeof v === 'string') return 'string';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === 'string')) return 'strings';
      if (
        v.length > 0 &&
        v.every(
          (x) =>
            x !== null &&
            typeof x === 'object' &&
            !Array.isArray(x) &&
            Object.values(x as object).every((y) => ['string', 'number', 'boolean'].includes(typeof y)),
        )
      )
        return 'rows';
      return 'json';
    }
    return 'json';
  }

  function setJson(key: string, raw: string) {
    try {
      block[key] = JSON.parse(raw);
      onEdited();
    } catch {
      /* keep typing — invalid JSON isn't committed */
    }
  }

  function rowsOf(key: string): Record<string, unknown>[] {
    return block[key] as Record<string, unknown>[];
  }

  function addRow(key: string) {
    const rows = rowsOf(key);
    const template = rows[rows.length - 1] ?? {};
    rows.push({ ...template });
    onEdited();
  }

  function removeRow(key: string, i: number) {
    rowsOf(key).splice(i, 1);
    onEdited();
  }
</script>

<div class="bf">
  {#if isEffect}
    <label class="bf-field">
      <span class="bf-lab">effect</span>
      <select value={String(block.effect)} onchange={(e) => setEffect(e.currentTarget.value)}>
        {#each EFFECT_CATEGORIES as cat (cat)}
          <optgroup label={cat}>
            {#each Object.entries(EFFECTS).filter(([, d]) => d.category === cat) as [id, d] (id)}
              <option value={id}>{d.label}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      {#if effectDef}<span class="bf-hint">{effectDef.doc}</span>{/if}
    </label>
    <label class="bf-field">
      <span class="bf-lab">role</span>
      <select value={String(block.role)} onchange={(e) => { block.role = e.currentTarget.value; onEdited(); }}>
        {#each effectDef?.roles ?? ['background'] as r (r)}
          <option value={r}>{r === 'background' ? 'background — behind the content' : 'transition — plays on arrival'}</option>
        {/each}
      </select>
    </label>
    <label class="bf-field">
      <span class="bf-lab">tint</span>
      <select value={String(block.tint ?? 'ink')} onchange={(e) => { block.tint = e.currentTarget.value; onEdited(); }}>
        <option value="ink">ink</option>
        <option value="accent">burnt orange</option>
        <option value="petrol">petrol</option>
      </select>
    </label>
    <label class="bf-field">
      <span class="bf-lab">intensity — {Number(block.intensity ?? 0.5).toFixed(1)}</span>
      <input
        type="range"
        min="0.1"
        max="1"
        step="0.1"
        value={Number(block.intensity ?? 0.5)}
        oninput={(e) => { block.intensity = Number(e.currentTarget.value); onEdited(); }}
      />
    </label>
  {:else if isChart}
    <div class="bf-chart">
      <span class="bf-chart-sum">{chartSummary()}</span>
      <button class="bf-chart-btn" onclick={() => (chartOpen = true)}>✎ edit chart</button>
    </div>
    {#if chartOpen}
      <ChartEditorModal block={block as unknown as ChartBlock} onSave={applyChart} onClose={() => (chartOpen = false)} />
    {/if}
  {:else}
    {#if isProse}
      <label class="bf-field">
        <span class="bf-lab">style</span>
        <select value={proseStyle} onchange={(e) => setProseStyle(e.currentTarget.value)}>
          {#each PROSE_STYLES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
        </select>
      </label>
    {/if}
    {#each keys as key (key)}
      {@const v = block[key]}
      {@const k = kind(v)}
      <label class="bf-field">
        <span class="bf-lab">{key}</span>
        {#if isProse && key === 'body'}
          <div class="bf-toolbar">
            {#each [1, 2, 3, 4] as h (h)}
              <button title="Heading {h}" onclick={(e) => { e.preventDefault(); setHeading(h); }}>H{h}</button>
            {/each}
            <span class="bf-tb-sep"></span>
            <button class="tb-b" title="Bold" onclick={(e) => { e.preventDefault(); wrapSel('**'); }}>B</button>
            <button class="tb-i" title="Italic" onclick={(e) => { e.preventDefault(); wrapSel('*'); }}>I</button>
            <button class="tb-u" title="Underline" onclick={(e) => { e.preventDefault(); wrapSel('__'); }}>U</button>
          </div>
          <textarea
            rows="5"
            bind:this={bodyTa}
            value={v as string}
            oninput={(e) => { block[key] = e.currentTarget.value; onEdited(); }}
          ></textarea>
          <span class="bf-hint"># heading · **bold** · *italic* · __underline__ · [link](/path) · blank line = new paragraph{proseStyle === 'cards' ? ' = new card' : ''}</span>
        {:else if k === 'string' && LONG_TEXT.has(key)}
          <textarea rows="3" value={v as string} oninput={(e) => { block[key] = e.currentTarget.value; onEdited(); }}></textarea>
        {:else if k === 'string'}
          <input type="text" value={v as string} oninput={(e) => { block[key] = e.currentTarget.value; onEdited(); }} />
        {:else if k === 'number'}
          <input type="number" value={v as number} oninput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) { block[key] = n; onEdited(); } }} />
        {:else if k === 'boolean'}
          <input type="checkbox" checked={v as boolean} onchange={(e) => { block[key] = e.currentTarget.checked; onEdited(); }} />
        {:else if k === 'strings'}
          <textarea
            rows="3"
            value={(v as string[]).join('\n')}
            oninput={(e) => { block[key] = e.currentTarget.value.split('\n').filter(Boolean); onEdited(); }}
          ></textarea>
          <span class="bf-hint">one per line</span>
        {:else if k === 'rows'}
          <div class="bf-rows">
            {#each rowsOf(key) as row, i (i)}
              <div class="bf-row">
                {#each Object.keys(row) as rk (rk)}
                  <input
                    type={typeof row[rk] === 'number' ? 'number' : 'text'}
                    title={rk}
                    placeholder={rk}
                    value={row[rk] as string | number}
                    oninput={(e) => {
                      row[rk] = typeof row[rk] === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value;
                      onEdited();
                    }}
                  />
                {/each}
                <button class="bf-x" onclick={() => removeRow(key, i)} title="Remove row">✕</button>
              </div>
            {/each}
            <button class="bf-add" onclick={() => addRow(key)}>+ row</button>
          </div>
        {:else}
          <textarea rows="4" class="bf-json" value={JSON.stringify(v, null, 1)} onchange={(e) => setJson(key, e.currentTarget.value)}></textarea>
          <span class="bf-hint">JSON</span>
        {/if}
      </label>
    {/each}
  {/if}
</div>

<style>
  .bf { display: flex; flex-direction: column; gap: 10px; }
  .bf-field { display: flex; flex-direction: column; gap: 4px; }
  .bf-lab {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .bf-hint { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-ghost); }
  input[type='text'],
  input[type='number'],
  select,
  textarea {
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
  }
  .bf-json { font-family: var(--font-mono); font-size: 11px; }
  textarea { resize: vertical; }
  .bf-toolbar { display: flex; gap: 2px; align-items: center; }
  .bf-toolbar button {
    font-family: var(--font-mono);
    font-size: 10px;
    min-width: 26px;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 4px 5px;
    cursor: pointer;
  }
  .bf-toolbar button:hover { color: var(--accent); border-color: var(--accent); }
  .bf-tb-sep { width: 6px; }
  .tb-b { font-weight: 700; }
  .tb-i { font-style: italic; }
  .tb-u { text-decoration: underline; }
  .bf-rows { display: flex; flex-direction: column; gap: 6px; }
  .bf-row { display: flex; gap: 6px; align-items: center; }
  .bf-row input { flex: 1; min-width: 0; }
  .bf-x,
  .bf-add {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .bf-x:hover { color: var(--error); border-color: var(--error); }
  .bf-add:hover { color: var(--accent); border-color: var(--accent); }
  .bf-chart {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .bf-chart-sum { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .bf-chart-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--bg);
    background: var(--accent-ink);
    border: none;
    border-radius: 2px;
    padding: 7px 12px;
    cursor: pointer;
  }
  .bf-chart-btn:hover { background: var(--accent-ink-hover); }
</style>
