<script lang="ts">
  // Shape-driven editor for one block. Fields render from the block object's
  // own shape (the zod registry is the validation gate on save): primitives
  // get typed inputs, string[] one-per-line, arrays of flat objects a row
  // table, anything deeper a JSON textarea. Mutates the parent-owned $state
  // draft directly and reports edits via onEdited().
  let { block, onEdited }: { block: Record<string, unknown>; onEdited: () => void } = $props();

  const LONG_TEXT = new Set(['body', 'thesis', 'text', 'detail', 'sub', 'description']);

  const keys = $derived(Object.keys(block).filter((k) => k !== 'type'));

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
  {#each keys as key (key)}
    {@const v = block[key]}
    {@const k = kind(v)}
    <label class="bf-field">
      <span class="bf-lab">{key}</span>
      {#if k === 'string' && LONG_TEXT.has(key)}
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
  .bf-x:hover, .bf-add:hover { color: var(--error); border-color: var(--error); }
  .bf-add:hover { color: var(--accent); border-color: var(--accent); }
</style>
