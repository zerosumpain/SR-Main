<script lang="ts" module>
  export type DetectedFormat =
    | 'empty'
    | 'string'
    | 'number'
    | 'boolean'
    | 'json-obj'
    | 'json-array-of-objects'
    | 'json-array-of-primitives'
    | 'html'
    | 'url-image'
    | 'url-video'
    | 'url-audio'
    | 'url-web'
    | 'csv';

  export function detectFormat(data: unknown): DetectedFormat {
    if (data === null || data === undefined) return 'empty';
    if (typeof data === 'number') return 'number';
    if (typeof data === 'boolean') return 'boolean';
    if (typeof data === 'string') {
      const s = data.trim();
      if (!s) return 'empty';
      if (/^https?:\/\/\S+$/.test(s)) {
        if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(s)) return 'url-image';
        if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(s)) return 'url-video';
        if (/\.(mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i.test(s)) return 'url-audio';
        return 'url-web';
      }
      if (/^\s*<(!doctype|html|[a-z][a-z0-9-]*[\s>/])/i.test(s) && /<\/[a-z][^>]*>|\/>/i.test(s)) {
        return 'html';
      }
      const lines = s.split('\n').filter((l) => l.trim());
      if (lines.length >= 2) {
        const headerCommas = (lines[0].match(/,/g) || []).length;
        if (
          headerCommas > 0 &&
          lines.every((l) => Math.abs((l.match(/,/g) || []).length - headerCommas) <= 1)
        ) {
          return 'csv';
        }
      }
      return 'string';
    }
    if (Array.isArray(data)) {
      if (data.length === 0) return 'json-array-of-primitives';
      const allObjects = data.every((d) => d && typeof d === 'object' && !Array.isArray(d));
      return allObjects ? 'json-array-of-objects' : 'json-array-of-primitives';
    }
    if (typeof data === 'object') return 'json-obj';
    return 'string';
  }

  function parseCsv(text: string): string[][] {
    // Small, forgiving CSV parser — handles quoted fields, escaped quotes.
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          cell += c;
        }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') {
          row.push(cell);
          cell = '';
        } else if (c === '\n') {
          row.push(cell);
          cell = '';
          rows.push(row);
          row = [];
        } else if (c === '\r') {
          // skip
        } else {
          cell += c;
        }
      }
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((v) => v.trim().length > 0));
  }

  function unionKeys(rows: Record<string, unknown>[]): string[] {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    return Array.from(keys);
  }

  function cellText(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
</script>

<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import CollapsibleOutput from './CollapsibleOutput.svelte';
  import InspectorBody from './InspectorBody.svelte';

  let {
    data,
    depth = 0,
    maxDepth = 4,
  }: { data: unknown; depth?: number; maxDepth?: number } = $props();
  const format = $derived(detectFormat(data));

  const csvRows = $derived(format === 'csv' ? parseCsv(data as string) : []);
  const csvHeader = $derived(csvRows[0] ?? []);
  const csvBody = $derived(csvRows.slice(1));

  const objRows = $derived(
    format === 'json-obj'
      ? Object.entries(data as Record<string, unknown>)
      : ([] as [string, unknown][]),
  );
  const tableRows = $derived(
    format === 'json-array-of-objects' ? (data as Record<string, unknown>[]) : [],
  );
  const tableKeys = $derived(tableRows.length > 0 ? unionKeys(tableRows) : []);

  const arrPrims = $derived(
    format === 'json-array-of-primitives' ? (data as unknown[]) : [],
  );

  // Tracks which nested cells are currently expanded.
  // Key shape: `${rowKey}:${cellKey}` for kv-rows, `${rowIndex}:${columnKey}` for tables.
  // SvelteSet (not plain Set) so .add()/.delete() trigger reactivity.
  const expanded = new SvelteSet<string>();

  function toggle(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
  }

  function isComplexCell(v: unknown): boolean {
    return v !== null && typeof v === 'object';
  }

  function pillLabel(v: unknown): string {
    if (Array.isArray(v)) return `[${v.length} ${v.length === 1 ? 'item' : 'items'}]`;
    if (v && typeof v === 'object') {
      const n = Object.keys(v as Record<string, unknown>).length;
      return `{${n} ${n === 1 ? 'field' : 'fields'}}`;
    }
    return '';
  }

  let copiedKey = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  function copyCell(value: string, key: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    copiedKey = key;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedKey = null;
    }, 900);
  }

  // Long-string truncation: cells with text above this length collapse by
  // default with a "▾ +N chars" toggle. Avoids one giant value forcing the
  // whole panel to scroll forever.
  const STRING_TRUNCATE = 160;
  const stringExpanded = new SvelteSet<string>();
  function toggleString(key: string) {
    if (stringExpanded.has(key)) stringExpanded.delete(key);
    else stringExpanded.add(key);
  }

  // Modal drill-in: clicking "↗" beside a pill opens the value in a full-size
  // dialog with a fresh InspectorBody at depth=0, so deep nesting doesn't get
  // squashed by the parent panel's width or the maxDepth cap.
  let modalData = $state<unknown>(undefined);
  let modalCrumb = $state<string>('');
  let dialogEl: HTMLDialogElement | undefined = $state();
  function openModal(value: unknown, crumb: string) {
    modalData = value;
    modalCrumb = crumb;
    dialogEl?.showModal();
  }
  function closeModal() {
    dialogEl?.close();
    modalData = undefined;
  }
</script>

{#if format === 'empty'}
  <div class="empty">no data captured yet — run the canvas to populate this</div>
{:else if format === 'string'}
  <pre class="mono">{data}</pre>
{:else if format === 'number'}
  <div class="num">{data}</div>
{:else if format === 'boolean'}
  <div class="num">{String(data)}</div>
{:else if format === 'url-image'}
  <img class="media" src={data as string} alt="" loading="lazy" />
  <a class="url-ref" href={data as string} target="_blank" rel="noopener">{data}</a>
{:else if format === 'url-video'}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video class="media" controls src={data as string}></video>
  <a class="url-ref" href={data as string} target="_blank" rel="noopener">{data}</a>
{:else if format === 'url-audio'}
  <audio class="media-audio" controls src={data as string}></audio>
  <a class="url-ref" href={data as string} target="_blank" rel="noopener">{data}</a>
{:else if format === 'url-web'}
  <iframe
    class="iframe"
    src={data as string}
    title="Inspector web content"
    sandbox="allow-same-origin"
    referrerpolicy="no-referrer"
  ></iframe>
  <a class="url-ref" href={data as string} target="_blank" rel="noopener">{data}</a>
{:else if format === 'html'}
  <!-- Sandboxed iframe with srcdoc disables scripts entirely (no allow-scripts) -->
  <iframe
    class="iframe"
    title="Inspector HTML"
    srcdoc={data as string}
    sandbox=""
  ></iframe>
{:else if format === 'json-obj'}
  <table class="kv">
    <tbody>
      {#each objRows as [k, v] (k)}
        {@const cellKey = `kv:${k}`}
        {@const isOpen = expanded.has(cellKey)}
        <tr>
          <th>{k}</th>
          <td>
            {#if isComplexCell(v)}
              <span class="pill-group">
                <button
                  type="button"
                  class="pill"
                  aria-expanded={isOpen}
                  onclick={() => toggle(cellKey)}
                >
                  <span class="pill-label">{pillLabel(v)}</span>
                  <span class="pill-caret">{isOpen ? '▾' : '▸'}</span>
                </button>
                <button
                  type="button"
                  class="pill pill-modal"
                  title="Open in modal"
                  aria-label="Open {k} in modal"
                  onclick={() => openModal(v, k)}
                >↗</button>
              </span>
              {#if isOpen}
                <div class="nested">
                  {#if depth + 1 >= maxDepth}
                    <CollapsibleOutput text={JSON.stringify(v, null, 2)} />
                  {:else}
                    <InspectorBody data={v} depth={depth + 1} {maxDepth} />
                  {/if}
                </div>
              {/if}
            {:else}
              {@const text = cellText(v)}
              {#if text === ''}
                <span class="missing">—</span>
              {:else if text.length > STRING_TRUNCATE}
                {@const isStringOpen = stringExpanded.has(cellKey)}
                <button
                  type="button"
                  class="copy-cell"
                  title="Click to copy full value"
                  onclick={() => copyCell(text, cellKey)}
                >{isStringOpen ? text : text.slice(0, STRING_TRUNCATE) + '…'}{#if copiedKey === cellKey}<span class="copied">copied</span>{/if}</button>
                <button
                  type="button"
                  class="str-toggle"
                  onclick={() => toggleString(cellKey)}
                >{isStringOpen ? '▴ collapse' : `▾ +${text.length - STRING_TRUNCATE} chars`}</button>
              {:else}
                <button
                  type="button"
                  class="copy-cell"
                  title={text}
                  onclick={() => copyCell(text, cellKey)}
                >{text}{#if copiedKey === cellKey}<span class="copied">copied</span>{/if}</button>
              {/if}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else if format === 'json-array-of-objects'}
  <div class="scroll-x">
    <table class="tbl">
      <thead>
        <tr>
          {#each tableKeys as k (k)}
            <th>{k}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each tableRows as r, i (i)}
          {@const rowHasOpen = tableKeys.some((k) => expanded.has(`row:${i}:${k}`))}
          <tr class:row-open={rowHasOpen}>
            {#each tableKeys as k (k)}
              {@const v = r[k]}
              {@const cellKey = `row:${i}:${k}`}
              {@const isOpen = expanded.has(cellKey)}
              <td class:cell-open={isOpen}>
                {#if v === undefined}
                  <span class="missing">—</span>
                {:else if isComplexCell(v)}
                  <span class="pill-group">
                    <button
                      type="button"
                      class="pill"
                      aria-expanded={isOpen}
                      onclick={() => toggle(cellKey)}
                    >
                      <span class="pill-label">{pillLabel(v)}</span>
                      <span class="pill-caret">{isOpen ? '▾' : '▸'}</span>
                    </button>
                    <button
                      type="button"
                      class="pill pill-modal"
                      title="Open in modal"
                      aria-label="Open {k} in modal"
                      onclick={() => openModal(v, `${k} (row ${i + 1})`)}
                    >↗</button>
                  </span>
                {:else}
                  {@const text = cellText(v)}
                  {#if text === ''}
                    <span class="missing">—</span>
                  {:else if text.length > STRING_TRUNCATE}
                    {@const isStringOpen = stringExpanded.has(cellKey)}
                    <button
                      type="button"
                      class="copy-cell"
                      title="Click to copy full value"
                      onclick={() => copyCell(text, cellKey)}
                    >{isStringOpen ? text : text.slice(0, STRING_TRUNCATE) + '…'}{#if copiedKey === cellKey}<span class="copied">copied</span>{/if}</button>
                    <button
                      type="button"
                      class="str-toggle"
                      onclick={() => toggleString(cellKey)}
                    >{isStringOpen ? '▴ collapse' : `▾ +${text.length - STRING_TRUNCATE} chars`}</button>
                  {:else}
                    <button
                      type="button"
                      class="copy-cell"
                      title={text}
                      onclick={() => copyCell(text, cellKey)}
                    >{text}{#if copiedKey === cellKey}<span class="copied">copied</span>{/if}</button>
                  {/if}
                {/if}
              </td>
            {/each}
          </tr>
          {#each tableKeys as k (k)}
            {@const v = r[k]}
            {@const cellKey = `row:${i}:${k}`}
            {#if expanded.has(cellKey) && isComplexCell(v)}
              <tr class="nested-row">
                <td colspan={tableKeys.length}>
                  <div class="nested nested-inline">
                    <span class="nested-crumb">{k}</span>
                    {#if depth + 1 >= maxDepth}
                      <CollapsibleOutput text={JSON.stringify(v, null, 2)} />
                    {:else}
                      <InspectorBody data={v} depth={depth + 1} {maxDepth} />
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        {/each}
      </tbody>
    </table>
  </div>
{:else if format === 'json-array-of-primitives'}
  {#if arrPrims.length === 0}
    <div class="empty">(empty list)</div>
  {:else}
    <ul class="list">
      {#each arrPrims as v, i (i)}
        <li>{cellText(v)}</li>
      {/each}
    </ul>
  {/if}
{:else if format === 'csv'}
  <div class="scroll-x">
    <table class="tbl">
      <thead>
        <tr>
          {#each csvHeader as h, i (i)}
            <th>{h}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each csvBody as r, i (i)}
          <tr>
            {#each r as c, j (j)}
              <td>{c}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<dialog bind:this={dialogEl} class="im-dialog" onclose={closeModal}>
  <div class="im-dialog-hdr">
    <span class="im-dialog-crumb">{modalCrumb}</span>
    <button type="button" class="im-dialog-close" onclick={closeModal} aria-label="Close">✕</button>
  </div>
  <div class="im-dialog-body">
    {#if modalData !== undefined}
      <InspectorBody data={modalData} depth={0} {maxDepth} />
    {/if}
  </div>
</dialog>

<style>
  .empty {
    padding: 16px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
  }
  .mono {
    margin: 0;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
  }
  .num {
    font-family: var(--font-mono);
    font-size: 20px;
    color: var(--accent);
    padding: 12px;
  }
  .media {
    display: block;
    max-width: 100%;
    max-height: 320px;
    margin: 0 auto;
    border: 1px solid var(--card-border);
  }
  .media-audio {
    width: 100%;
  }
  .url-ref {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    margin-top: 6px;
    word-break: break-all;
    text-decoration: none;
  }
  .url-ref:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .iframe {
    width: 100%;
    height: 240px;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }

  .kv,
  .tbl {
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 11px;
    width: 100%;
  }
  .kv th {
    text-align: left;
    padding: 4px 8px;
    background: var(--bg-section);
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 9px;
    border: 1px solid var(--card-border);
    width: 35%;
    vertical-align: top;
  }
  .kv td {
    padding: 4px 8px;
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    vertical-align: top;
    word-break: break-word;
  }
  .scroll-x {
    max-width: 100%;
    overflow-x: auto;
  }
  .tbl th {
    position: sticky;
    top: 0;
    background: var(--bg-section);
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 9px;
    padding: 4px 8px;
    border: 1px solid var(--card-border);
    text-align: left;
    white-space: nowrap;
  }
  .tbl td {
    padding: 3px 8px;
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tbl tr:nth-child(even) td {
    background: var(--bg-section);
  }
  .list {
    margin: 0;
    padding-left: 20px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-primary);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    cursor: pointer;
    outline: none;
  }
  .pill:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .pill[aria-expanded='true'] {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(196, 87, 10, 0.08);
  }
  .pill-caret {
    font-size: 9px;
    line-height: 1;
  }
  .copy-cell {
    display: inline;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    position: relative;
  }
  .copy-cell:hover {
    color: var(--accent);
  }
  .copied {
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .missing {
    color: var(--text-ghost);
    font-style: italic;
  }
  .nested {
    margin-top: 6px;
    padding: 6px 8px;
    border-left: 2px solid var(--accent);
    background: rgba(255, 255, 255, 0.02);
  }
  .nested-inline {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .nested-crumb {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .tbl tr.nested-row td {
    background: var(--bg);
    border-top: none;
    padding: 0 8px 8px;
  }
  .row-open td {
    border-bottom: none;
  }
  .tbl tr td.cell-open {
    background: rgba(196, 87, 10, 0.06);
  }
  .pill-group {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .pill-modal {
    padding: 1px 5px;
    font-size: 11px;
    line-height: 1;
  }
  .str-toggle {
    margin-left: 6px;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    vertical-align: baseline;
  }
  .str-toggle:hover {
    color: var(--accent);
  }
  .im-dialog {
    width: min(900px, 90vw);
    max-width: 90vw;
    max-height: 80vh;
    padding: 0;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-primary);
  }
  .im-dialog::backdrop {
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
  }
  .im-dialog-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--card-border);
    background: var(--bg-section);
    position: sticky;
    top: 0;
  }
  .im-dialog-crumb {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .im-dialog-close {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .im-dialog-close:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .im-dialog-body {
    padding: 12px 14px;
    overflow: auto;
    max-height: calc(80vh - 44px);
  }
</style>
