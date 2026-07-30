<script lang="ts">
  let {
    value,
    onChange,
  }: {
    value: Record<string, string>;
    onChange: (v: Record<string, string>) => void;
  } = $props();

  function rows(): Array<{ k: string; v: string }> {
    return Object.entries(value ?? {}).map(([k, v]) => ({ k, v: String(v) }));
  }

  function setRows(next: Array<{ k: string; v: string }>) {
    const out: Record<string, string> = {};
    for (const r of next) {
      if (r.k.trim()) out[r.k.trim()] = r.v;
    }
    onChange(out);
  }

  function addRow() {
    setRows([...rows(), { k: '', v: '' }]);
  }
  function updateRow(i: number, k: string, v: string) {
    const next = rows();
    next[i] = { k, v };
    setRows(next);
  }
  function removeRow(i: number) {
    const next = rows();
    next.splice(i, 1);
    setRows(next);
  }
</script>

<div class="kv">
  {#each rows() as r, i}
    <div class="kv-row">
      <input class="kv-k" type="text" placeholder="key" value={r.k} oninput={(e) => updateRow(i, (e.currentTarget as HTMLInputElement).value, r.v)} />
      <input class="kv-v" type="text" placeholder="value" value={r.v} oninput={(e) => updateRow(i, r.k, (e.currentTarget as HTMLInputElement).value)} />
      <button type="button" class="kv-rm" onclick={() => removeRow(i)} aria-label="remove">×</button>
    </div>
  {/each}
  <button type="button" class="kv-add" onclick={addRow}>+ Add</button>
</div>

<style>
  .kv { display: flex; flex-direction: column; gap: 4px; }
  .kv-row { display: grid; grid-template-columns: 1fr 1.6fr 24px; gap: 4px; }
  .kv-k, .kv-v { padding: 4px 6px; background: var(--bg); color: var(--text-primary); border: 1px solid var(--card-border); font-family: var(--font-mono); font-size: var(--fs-label); }
  .kv-rm { background: transparent; color: var(--text-muted); border: 1px solid var(--card-border); cursor: pointer; }
  .kv-rm:hover { color: var(--status-error, #c0392b); }
  .kv-add { align-self: flex-start; margin-top: 4px; padding: 3px 8px; background: var(--bg); color: var(--text-muted); border: 1px dashed var(--card-border); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; }
  .kv-add:hover { color: var(--text-primary); }
</style>
