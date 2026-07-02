<script lang="ts">
  import { author } from '../../lib/author/authorState.svelte';
  import { COMMITMENTS, DOCUMENTS_BY_ID, THEME_META } from '../../lib/commitments';

  // commitments × sections heat grid: which sections speak to which commitments.
  const BY_ID = Object.fromEntries(COMMITMENTS.map((c) => [c.id, c]));
  const sections = $derived(author.doc.sections);
  const rows = $derived(
    author.coverage.items
      .filter((i) => i.kind === 'commitment')
      .map((i) => ({ ...i, c: BY_ID[i.id] }))
      .filter((r) => r.c)
      .sort((a, b) => (a.c!.docId < b.c!.docId ? -1 : a.c!.docId > b.c!.docId ? 1 : 0)),
  );
  let open = $state<string | null>(null);

  const initials = (title: string) =>
    title
      .split(/[\s&]+/)
      .filter((w) => w.length > 2)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
</script>

<div class="cm">
  {#if !rows.length}
    <p class="empty">No commitments loaded yet.</p>
  {:else}
    <div class="legend">
      <span><i class="cell addressed"></i> addressed here</span>
      <span><i class="cell touched"></i> touched</span>
      <span><i class="cell"></i> silent</span>
      <span class="lg-note">columns = your sections · rows = the ledger</span>
    </div>
    <div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th class="rowh"></th>
            {#each sections as s (s.id)}
              <th class="colh" title={s.title}><span>{initials(s.title)}</span></th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.id)}
            <tr class:open={open === r.id}>
              <th class="rowh" onclick={() => (open = open === r.id ? null : r.id)}>
                <i class="dot" style="--c:{THEME_META[r.c!.theme].color}"></i>
                <span class="rt">{r.c!.title}</span>
                <span class="rd">{DOCUMENTS_BY_ID[r.c!.docId]?.shortName}</span>
              </th>
              {#each sections as s (s.id)}
                {@const hit = r.sectionIds.includes(s.id)}
                <td>
                  <i
                    class="cell"
                    class:addressed={hit && r.level === 'addressed'}
                    class:touched={hit && r.level === 'touched'}
                    title={hit ? `${r.c!.title} — mentioned in “${s.title}”` : ''}
                  ></i>
                </td>
              {/each}
            </tr>
            {#if open === r.id}
              <tr class="detail">
                <td colspan={sections.length + 1}>
                  <p><b>{r.c!.title}</b> — {r.c!.strategyImplication}</p>
                  <p class="d-hits">
                    {#if r.hits.length}
                      matched: {r.hits.map((h) => `“${h}”`).join(', ')} in {r.sectionIds.map((id) => sections.find((s) => s.id === id)?.title).filter(Boolean).join(' · ')}
                    {:else}
                      no mention anywhere in the draft — aliases looked for: {r.c!.aliases.slice(0, 4).map((a) => `“${a}”`).join(', ')}
                    {/if}
                  </p>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .empty {
    margin: 0;
    font-size: 12.5px;
    color: rgba(28, 22, 17, 0.6);
  }
  .legend {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.6);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .lg-note {
    margin-left: auto;
  }
  .grid-wrap {
    max-height: 480px;
    overflow: auto;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.45);
  }
  .grid {
    border-collapse: collapse;
    width: 100%;
  }
  thead th {
    position: sticky;
    top: 0;
    background: rgba(241, 234, 214, 0.97);
    z-index: 2;
    padding: 5px 2px;
  }
  .colh span {
    display: inline-block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    color: rgba(28, 22, 17, 0.55);
    transform: none;
  }
  .rowh {
    text-align: left;
    padding: 4px 8px;
    max-width: 300px;
    cursor: pointer;
    background: transparent;
  }
  tbody .rowh:hover {
    background: rgba(28, 22, 17, 0.04);
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c);
    margin-right: 6px;
  }
  .rt {
    font-family: 'DM Sans', sans-serif;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--ink);
  }
  .rd {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    color: rgba(28, 22, 17, 0.45);
    margin-left: 6px;
    white-space: nowrap;
  }
  td {
    text-align: center;
    padding: 3px 2px;
  }
  .cell {
    display: inline-block;
    width: 13px;
    height: 13px;
    border-radius: 3px;
    background: rgba(28, 22, 17, 0.07);
    border: 1px solid rgba(28, 22, 17, 0.1);
  }
  .cell.addressed {
    background: #2f6155;
    border-color: #2f6155;
  }
  .cell.touched {
    background: #b07d2b;
    border-color: #b07d2b;
  }
  tr.open .rowh {
    background: rgba(28, 22, 17, 0.05);
  }
  .detail td {
    text-align: left;
    padding: 6px 12px 10px;
    background: rgba(241, 234, 214, 0.5);
  }
  .detail p {
    margin: 0 0 4px;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.75);
  }
  .d-hits {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: rgba(28, 22, 17, 0.55);
  }
</style>
