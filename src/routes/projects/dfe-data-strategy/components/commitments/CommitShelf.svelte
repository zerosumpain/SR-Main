<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { DOCUMENTS, DOCUMENTS_BY_ID, COMMITMENTS_BY_DOC, THEME_META } from '../../lib/commitments';
  import CommitList from './CommitList.svelte';

  // the shelf: newest documents first; counts respect the current filters.
  // Master–detail: the documents live in a sticky rail so picking one (or several —
  // selection is additive) filters the list WITHOUT scrolling the details off screen.
  const docs = [...DOCUMENTS].sort((a, b) => (a.date < b.date ? 1 : -1));
  const filteredByDoc = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const c of ledger.filtered) map[c.docId] = (map[c.docId] ?? 0) + 1;
    return map;
  });
  // counts ignoring the doc selection itself, so unselected docs show what picking them would add
  const countsSansDocs = $derived.by(() => {
    const map: Record<string, number> = {};
    const q = ledger.q.trim().toLowerCase();
    for (const d of docs) {
      map[d.id] = (COMMITMENTS_BY_DOC[d.id] ?? []).filter((c) => {
        if (ledger.themes.length && !ledger.themes.includes(c.theme)) return false;
        if (ledger.status !== 'all' && c.status !== ledger.status) return false;
        if (ledger.role !== 'all' && c.dfeRole !== ledger.role) return false;
        if (q) {
          const hay = `${c.title} ${c.what} ${c.strategyImplication} ${c.aliases.join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }).length;
    }
    return map;
  });

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
      .slice(0, 4)
      .map(([t]) => THEME_META[t as keyof typeof THEME_META].color);
  }
</script>

<div class="shelf2">
  <aside class="rail" aria-label="Documents — pick one or several">
    <div class="rail-head">
      <span class="rail-lab">Documents · newest first</span>
      {#if ledger.docIds.length}
        <button class="rail-clear" onclick={() => (ledger.docIds = [])}>✕ all</button>
      {/if}
    </div>
    <div class="rail-scroll">
      {#each docs as d (d.id)}
        {@const n = countsSansDocs[d.id] ?? 0}
        {@const on = ledger.docIds.includes(d.id)}
        <button
          class="doc"
          class:on
          class:mute={n === 0 && !on}
          onclick={() => ledger.toggleDoc(d.id)}
          title={d.title}
          aria-pressed={on}
        >
          <span class="d-check" aria-hidden="true">{on ? '✓' : '+'}</span>
          <span class="d-body">
            <span class="d-type">{TYPE_LABEL[d.type] ?? d.type} · {fmtDate(d.date)}</span>
            <span class="d-name">{d.shortName}</span>
          </span>
          <span class="d-side">
            <b class="d-n">{n}</b>
            <span class="d-dots">{#each themeDots(d.id) as c}<i style="--c:{c}"></i>{/each}</span>
          </span>
        </button>
      {/each}
    </div>
  </aside>

  <div class="main">
    <div class="list-head">
      {#if ledger.docIds.length}
        <span class="lh-lab">{ledger.filtered.length} commitment{ledger.filtered.length === 1 ? '' : 's'} from</span>
        {#each ledger.docIds as id (id)}
          <button class="sel-chip" onclick={() => ledger.toggleDoc(id)} title={DOCUMENTS_BY_ID[id]?.title}>
            {DOCUMENTS_BY_ID[id]?.shortName ?? id} <i>✕</i>
          </button>
        {/each}
        <button class="unpick" onclick={() => (ledger.docIds = [])}>show every document</button>
      {:else}
        <h3 class="list-h">All commitments ({ledger.filtered.length})</h3>
        <span class="lh-hint">← pick documents to focus; selection is additive</span>
      {/if}
    </div>
    <CommitList items={ledger.filtered} />
  </div>
</div>

<style>
  .shelf2 {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .rail {
    position: sticky;
    top: calc(var(--topH, 90px) + 10px);
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.4);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - var(--topH, 90px) - 22px);
  }
  .rail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px 7px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.1);
  }
  .rail-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
  }
  .rail-clear {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 2px 8px;
    background: transparent;
    border: 1px dashed rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-sharp);
    color: rgba(28, 22, 17, 0.6);
    cursor: pointer;
  }
  .rail-scroll {
    overflow-y: auto;
    padding: 7px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .doc {
    display: flex;
    align-items: center;
    gap: 9px;
    text-align: left;
    border: 1px solid rgba(28, 22, 17, 0.12);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    padding: 7px 9px;
    cursor: pointer;
  }
  .doc:hover {
    border-color: rgba(28, 22, 17, 0.4);
    background: rgba(255, 255, 255, 0.85);
  }
  .doc.on {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .doc.mute {
    opacity: 0.45;
  }
  .d-check {
    flex: none;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-label-xs);
    font-weight: 700;
    border: 1px solid rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-sharp, 2px);
    color: rgba(28, 22, 17, 0.45);
    background: rgba(255, 255, 255, 0.7);
  }
  .doc.on .d-check {
    background: var(--accent-ink);
    border-color: var(--accent-ink);
    color: #fff;
  }
  .d-body {
    flex: 1;
    min-width: 0;
  }
  .d-type {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
  }
  .d-name {
    display: block;
    font-family: var(--fs-serif);
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--ink);
    line-height: 1.2;
  }
  .d-side {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .d-dots {
    display: inline-flex;
    gap: 2px;
  }
  .d-dots i {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--c);
  }
  .d-n {
    font-family: var(--fs-serif);
    font-size: var(--fs-nav);
    font-weight: 600;
    color: var(--accent-ink);
    line-height: 1;
  }
  .main {
    min-width: 0;
  }
  .list-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 10px;
    min-height: 28px;
  }
  .list-h {
    margin: 0;
    font-family: var(--fs-serif);
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
  }
  .lh-lab {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--ink);
  }
  .lh-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.45);
  }
  .sel-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    padding: 3px 10px;
    border: 1px solid var(--accent-ink);
    border-radius: var(--radius-sharp);
    background: var(--accent-ink);
    color: #fff;
    cursor: pointer;
  }
  .sel-chip i {
    font-style: normal;
    font-size: var(--fs-label-xs);
    opacity: 0.8;
  }
  .sel-chip:hover i {
    opacity: 1;
  }
  .unpick {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 3px 9px;
    background: transparent;
    border: 1px dashed rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-sharp);
    color: rgba(28, 22, 17, 0.6);
    cursor: pointer;
  }
  @media (max-width: 940px) {
    .shelf2 {
      grid-template-columns: 1fr;
    }
    .rail {
      position: static;
      max-height: none;
    }
    .rail-scroll {
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 9px;
    }
    .doc {
      flex: none;
      width: 218px;
    }
  }
</style>
