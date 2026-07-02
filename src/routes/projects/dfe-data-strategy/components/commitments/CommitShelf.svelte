<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { DOCUMENTS, COMMITMENTS_BY_DOC, THEME_META } from '../../lib/commitments';
  import CommitList from './CommitList.svelte';

  // the shelf: newest documents first; counts respect the current filters
  const docs = [...DOCUMENTS].sort((a, b) => (a.date < b.date ? 1 : -1));
  const filteredByDoc = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const c of ledger.filtered) map[c.docId] = (map[c.docId] ?? 0) + 1;
    return map;
  });
  const openDoc = $derived(ledger.docId !== 'all' ? ledger.docId : null);
  const openList = $derived(openDoc ? ledger.filtered.filter((c) => c.docId === openDoc) : ledger.filtered);

  const fmtDate = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };
  const TYPE_LABEL: Record<string, string> = {
    'white-paper': 'White paper',
    act: 'Act',
    bill: 'Bill',
    strategy: 'Strategy',
    'action-plan': 'Action plan',
    review: 'Review',
    consultation: 'Consultation',
    roadmap: 'Roadmap',
    framework: 'Framework',
    guidance: 'Guidance',
    blog: 'Programme',
    evidence: 'Evidence',
  };
  function themeDots(docId: string) {
    const counts: Record<string, number> = {};
    for (const c of COMMITMENTS_BY_DOC[docId] ?? []) counts[c.theme] = (counts[c.theme] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => THEME_META[t as keyof typeof THEME_META].color);
  }
</script>

<div class="shelf">
  {#each docs as d (d.id)}
    {@const n = filteredByDoc[d.id] ?? 0}
    <button
      class="doc"
      class:on={openDoc === d.id}
      class:mute={n === 0}
      onclick={() => (ledger.docId = openDoc === d.id ? 'all' : d.id)}
      title={d.title}
    >
      <span class="d-type">{TYPE_LABEL[d.type] ?? d.type} · {fmtDate(d.date)}</span>
      <span class="d-name">{d.shortName}</span>
      <span class="d-one">{d.oneLiner}</span>
      <span class="d-foot">
        <span class="d-dots">{#each themeDots(d.id) as c}<i style="--c:{c}"></i>{/each}</span>
        <b class="d-n">{n}</b>
      </span>
    </button>
  {/each}
</div>

<h3 class="list-h">
  {#if openDoc}
    {docs.find((d) => d.id === openDoc)?.title}
    <button class="unpick" onclick={() => (ledger.docId = 'all')}>✕ show every document</button>
  {:else}
    All commitments ({ledger.filtered.length})
  {/if}
</h3>
<CommitList items={openList} />

<style>
  .shelf {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
    gap: 10px;
    margin-bottom: 20px;
  }
  .doc {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-top: 4px solid rgba(28, 22, 17, 0.55);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.55);
    padding: 11px 13px 10px;
    cursor: pointer;
    min-height: 118px;
  }
  .doc:hover {
    border-color: rgba(28, 22, 17, 0.4);
    background: rgba(255, 255, 255, 0.8);
  }
  .doc.on {
    border-color: var(--accent-ink);
    border-top-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .doc.mute {
    opacity: 0.45;
  }
  .d-type {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
  }
  .d-name {
    font-family: 'Fraunces', serif;
    font-size: 16px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.15;
  }
  .d-one {
    font-size: 11px;
    line-height: 1.45;
    color: rgba(28, 22, 17, 0.62);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .d-foot {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 6px;
  }
  .d-dots {
    display: inline-flex;
    gap: 3px;
  }
  .d-dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c);
  }
  .d-n {
    font-family: 'Fraunces', serif;
    font-size: 17px;
    font-weight: 600;
    color: var(--accent-ink);
  }
  .list-h {
    margin: 0 0 10px;
    font-family: 'Fraunces', serif;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
  }
  .unpick {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    padding: 3px 9px;
    background: transparent;
    border: 1px dashed rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-round);
    color: rgba(28, 22, 17, 0.6);
    cursor: pointer;
  }
</style>
