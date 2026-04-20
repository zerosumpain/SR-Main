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
  let { data }: { data: unknown } = $props();
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
        <tr>
          <th>{k}</th>
          <td>
            {#if v && typeof v === 'object'}
              <pre class="sub">{JSON.stringify(v, null, 2)}</pre>
            {:else}
              {cellText(v)}
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
          <tr>
            {#each tableKeys as k (k)}
              <td>{cellText(r[k])}</td>
            {/each}
          </tr>
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
  .kv pre.sub {
    margin: 0;
    font-size: 10px;
    color: var(--text-muted);
    white-space: pre-wrap;
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
</style>
