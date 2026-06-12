<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { generateRows, rowsToCsv, rowsToJson, ROW_OPTIONS } from '../lib/synth';
  import { codelistById } from '../lib/codelists';
  const base = '/projects/data-standard-designer';

  let count = $state(100);
  let seed = $state(1);
  let rows = $state<Record<string, unknown>[]>([]);
  let generated = $state(0);
  let busy = $state(false);
  let useAi = $state(false);
  let aiBusy = $state(false);
  let aiError = $state('');
  let pools = $state<Record<string, string[]>>({});

  const machine = (f: { name?: string; title?: string }) => (f.name || f.title || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const cols = $derived(app.fields.map((f) => machine(f)));
  const preview = $derived(rows.slice(0, 25));

  async function fetchPools() {
    aiBusy = true;
    aiError = '';
    try {
      const res = await fetch(`${base}/assist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'synth-pools', fields: app.fields.map((f) => ({ name: machine(f), title: f.title, type: f.type, description: f.description })) }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const j = await res.json();
      pools = j?.pools && typeof j.pools === 'object' ? j.pools : {};
    } catch (e: any) {
      aiError = e?.message || 'AI enrichment unavailable';
      pools = {};
    } finally {
      aiBusy = false;
    }
  }

  async function generate() {
    if (!app.fields.length) return;
    busy = true;
    try {
      if (useAi && Object.keys(pools).length === 0) await fetchPools();
      // yield so the busy state paints before a 10k crunch
      await new Promise((r) => setTimeout(r, 10));
      rows = generateRows(app.fields, { rows: count, seed, pools: useAi ? pools : undefined });
      generated = rows.length;
    } finally {
      busy = false;
    }
  }

  function download(kind: 'csv' | 'json') {
    if (!rows.length) return;
    const content = kind === 'csv' ? rowsToCsv(app.fields, rows) : rowsToJson(rows);
    const blob = new Blob([content], { type: kind === 'csv' ? 'text/csv' : 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(app.brief.name || 'standard').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-synthetic.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function cell(v: unknown): string {
    if (Array.isArray(v)) return v.join(', ');
    return v === null || v === undefined ? '' : String(v);
  }
</script>

<div class="dsd-route wide">
  <span class="dsd-eyebrow">Test data</span>
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">Try the schema with real-shaped data.</h1>
  <p class="dsd-prose">Generate synthetic rows that conform to your schema — valid-format identifiers, dates, and values drawn from the actual codelists — so you can load it into a tool, write a validator, or show stakeholders what the data will look like. Nothing here is real personal data.</p>

  {#if app.mode === 'analyst'}
    <div class="dsd-note"><span class="tag">Analyst view</span>This makes a fake-but-realistic sample of the dataset so you can see it as a spreadsheet before any real data exists. Pick how many rows and download it.</div>
  {/if}

  {#if !app.fields.length}
    <div class="empty"><p>Your schema has no fields yet.</p><a class="dsd-btn primary" href={`${base}/schema`}>Build the schema first →</a></div>
  {:else}
    <div class="controls">
      <div class="ctl">
        <span class="dsd-label">Rows</span>
        <div class="seg">
          {#each ROW_OPTIONS as n}<button class:on={count === n} onclick={() => (count = n)}>{n.toLocaleString()}</button>{/each}
        </div>
      </div>
      <label class="ctl seedctl"><span class="dsd-label">Seed</span>
        <input class="dsd-input" type="number" bind:value={seed} min="1" /></label>
      <label class="ctl aictl">
        <input type="checkbox" bind:checked={useAi} />
        <span>✦ Enrich realism with AI <small>(fills free-text fields with plausible values)</small></span>
      </label>
      <button class="dsd-btn primary" disabled={busy || aiBusy} onclick={generate}>{busy || aiBusy ? 'Generating…' : `Generate ${count.toLocaleString()} rows`}</button>
    </div>
    {#if aiError}<p class="ai-error">⚠ {aiError} — generated with built-in values instead.</p>{/if}

    {#if generated}
      <div class="result-head">
        <span><b>{generated.toLocaleString()}</b> rows generated · showing first {preview.length}</span>
        <div class="dls">
          <button class="dsd-btn sm" onclick={() => download('csv')}>⤓ CSV</button>
          <button class="dsd-btn sm" onclick={() => download('json')}>⤓ JSON</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>{#each app.fields as f}<th>{machine(f)}{#if f.codelistId}<span class="cl">codelist</span>{:else if f.identifier}<span class="cl id">id</span>{/if}</th>{/each}</tr></thead>
          <tbody>
            {#each preview as r}
              <tr>{#each cols as c}<td>{cell(r[c])}</td>{/each}</tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .empty { border: 1.5px dashed var(--card-border); border-radius: var(--radius-round); padding: 30px; text-align: center; }
  .empty p { color: var(--text-muted); margin: 0 0 12px; }
  .controls { display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap; margin: 18px 0 8px; padding-bottom: 16px; border-bottom: 1px solid var(--divider); }
  .ctl { display: flex; flex-direction: column; gap: 6px; }
  .seg { display: inline-flex; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); overflow: hidden; }
  .seg button { font-family: var(--font-mono); font-size: 11px; padding: 8px 13px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); border-right: 1px solid var(--card-border); }
  .seg button:last-child { border-right: none; }
  .seg button.on { background: var(--accent); color: #fff; }
  .seedctl { max-width: 110px; }
  .aictl { flex-direction: row; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
  .aictl small { color: var(--text-muted); }
  .ai-error { font-size: 12px; color: var(--warn); background: var(--warn-bg); padding: 7px 10px; border-radius: var(--radius-sharp); }
  .result-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 0 8px; font-size: 13px; color: var(--text-secondary); flex-wrap: wrap; }
  .dls { display: flex; gap: 8px; }
  .table-wrap { overflow-x: auto; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-family: var(--font-mono); font-size: 10px; text-transform: lowercase; letter-spacing: 0.02em; color: var(--text-muted); padding: 8px 10px; border-bottom: 1.5px solid var(--card-border); background: var(--card-bg); white-space: nowrap; }
  th .cl { display: inline-block; margin-left: 5px; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); background: var(--accent-tint-08); padding: 1px 4px; border-radius: 2px; }
  th .cl.id { color: var(--info); background: var(--info-bg); }
  td { padding: 6px 10px; border-bottom: 1px solid var(--divider); color: var(--text-secondary); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  tbody tr:last-child td { border-bottom: none; }
</style>
