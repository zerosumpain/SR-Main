<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { COMMITMENTS, DOCUMENTS_BY_ID, THEME_META, STATUS_META, ROLE_META } from '../../lib/commitments';
  import { ORG_BY_ID } from '../../lib/orgs';
  import { CAPABILITY_BY_ID } from '../../lib/capabilities';
  import { PRESSURES_BY_ID } from '$lib/dfe-data-strategy/pressures';
  import { app } from '../../lib/appState.svelte';
  import { author } from '../../lib/author/authorState.svelte';
  import { markdownToHtml } from '../../lib/author/serialize';
  import ConfidenceBadge from '../ConfidenceBadge.svelte';

  const c = $derived(COMMITMENTS.find((x) => x.id === ledger.selectedId) ?? null);
  const doc = $derived(c ? DOCUMENTS_BY_ID[c.docId] : null);
  const eli = $derived(app.narrative === 'eli5');
  let added = $state(false);

  function addToDraft() {
    if (!c) return;
    const target = author.doc.sections.find((s) => s.templateId === 'commitments-obligations') ?? author.doc.sections[0];
    author.appendHtml(
      target.id,
      markdownToHtml(`- **${c.title}** (${doc?.shortName ?? c.docId}${c.timeframe ? `, ${c.timeframe}` : ''}) — ${c.strategyImplication}`),
    );
    added = true;
    setTimeout(() => (added = false), 1500);
  }
  function close() {
    ledger.select(null);
  }
</script>

{#if c}
  <button class="scrim" aria-label="Close" onclick={close}></button>
  <aside class="dw" role="dialog" aria-label="Commitment detail">
    <header class="dw-head">
      <span class="dw-theme" style="--c:{THEME_META[c.theme].color}">{THEME_META[c.theme].label}</span>
      <span class="dw-status" class:hard={c.status === 'statutory-duty' || c.status === 'legislated-not-commenced'}>{STATUS_META[c.status].label}</span>
      <button class="dw-close" onclick={close} aria-label="Close">✕</button>
    </header>
    <div class="dw-body">
      <h2>{c.title}</h2>
      <p class="dw-doc">
        {doc?.title}
        {#if doc}<a href={doc.url} target="_blank" rel="noopener">↗</a>{/if}
        · {ROLE_META[c.dfeRole].label}{c.timeframe ? ` · ${c.timeframe}` : ''}
      </p>

      <p class="dw-what">{eli && c.eli5 ? c.eli5 : c.what}</p>
      {#if c.quote}
        <blockquote class="dw-quote">“{c.quote}”</blockquote>
      {/if}

      <div class="dw-imp">
        <span class="lab">▸ What this means for the strategy</span>
        <p>{c.strategyImplication}</p>
        <button class="add" class:ok={added} onclick={addToDraft}>{added ? '✓ added to your draft' : '+ add to your draft'}</button>
      </div>

      {#if c.flows.length}
        <span class="lab">New data flows</span>
        <ul class="flows">
          {#each c.flows as f}
            <li><b>{ORG_BY_ID[f.from]?.short ?? f.from}</b> <i>→</i> <b>{ORG_BY_ID[f.to]?.short ?? f.to}</b><span>{f.what}</span></li>
          {/each}
        </ul>
      {/if}

      {#if c.newServices.length || c.identifiers.length || c.standards.length || c.partners.length}
        <div class="chips-grid">
          {#if c.newServices.length}<div><span class="lab">New services</span>{#each c.newServices as x}<span class="chip">{x}</span>{/each}</div>{/if}
          {#if c.identifiers.length}<div><span class="lab">Identifiers</span>{#each c.identifiers as x}<span class="chip">{x}</span>{/each}</div>{/if}
          {#if c.standards.length}<div><span class="lab">Standards</span>{#each c.standards as x}<span class="chip">{x}</span>{/each}</div>{/if}
          {#if c.partners.length}<div><span class="lab">Partners</span>{#each c.partners as x}<span class="chip">{x}</span>{/each}</div>{/if}
        </div>
      {/if}

      <span class="lab">Capabilities this demands</span>
      <p class="caps">{c.capabilityIds.map((id) => CAPABILITY_BY_ID[id]?.name ?? id).join(' · ')}</p>

      {#if c.pressureIds?.length}
        <span class="lab">Evidence in the pressures landscape</span>
        <p class="caps">
          {#each c.pressureIds as pid, i}{i > 0 ? ' · ' : ''}<a href="/projects/dfe-data-strategy/landscape">{PRESSURES_BY_ID[pid]?.title ?? pid}</a>{/each}
        </p>
      {/if}

      <div class="dw-foot">
        <ConfidenceBadge level={c.confidence} label="Research confidence" note="How firmly the sweep could verify this against primary sources." small />
        <div class="srcs">
          {#each c.sourceUrls as u, i}
            <a href={u} target="_blank" rel="noopener">source {i + 1} ↗</a>
          {/each}
        </div>
      </div>
    </div>
  </aside>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(28, 22, 17, 0.28);
    border: none;
    cursor: pointer;
  }
  .dw {
    position: fixed;
    z-index: 71;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(480px, 94vw);
    background: var(--bg, #f1ead6);
    border-left: 1px solid rgba(28, 22, 17, 0.18);
    display: flex;
    flex-direction: column;
  }
  .dw-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 13px 16px 11px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.12);
  }
  .dw-theme {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--c);
    font-weight: 600;
  }
  .dw-theme::before {
    content: '';
    width: 9px;
    height: 9px;
    border-radius: var(--radius-pill);
    background: var(--c);
  }
  .dw-status {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--radius-sharp);
    border: 1px solid rgba(28, 22, 17, 0.25);
    color: rgba(28, 22, 17, 0.6);
  }
  .dw-status.hard {
    border-color: #b04a2f;
    color: #b04a2f;
    font-weight: 600;
  }
  .dw-close {
    margin-left: auto;
    background: none;
    border: none;
    font-size: var(--fs-body-sm);
    color: rgba(28, 22, 17, 0.5);
    cursor: pointer;
  }
  .dw-close:hover {
    color: var(--ink);
  }
  .dw-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 18px 26px;
  }
  h2 {
    margin: 0 0 5px;
    font-family: var(--fs-serif);
    font-size: 21px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--ink);
  }
  .dw-doc {
    margin: 0 0 12px;
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.6);
  }
  .dw-doc a {
    color: var(--accent-ink);
    text-decoration: none;
  }
  .dw-what {
    margin: 0 0 10px;
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: rgba(28, 22, 17, 0.8);
  }
  .dw-quote {
    margin: 0 0 14px;
    padding: 8px 14px;
    border-left: 3px solid rgba(28, 22, 17, 0.35);
    background: rgba(255, 255, 255, 0.45);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.75);
  }
  .lab {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin: 14px 0 5px;
  }
  .dw-imp {
    border: 1px solid var(--accent-ink-tint-35);
    border-left: 4px solid var(--accent-ink);
    border-radius: var(--radius-sharp);
    background: var(--accent-ink-tint-06);
    padding: 10px 13px 11px;
    margin: 14px 0 4px;
  }
  .dw-imp .lab {
    margin: 0 0 4px;
    color: var(--accent-ink);
  }
  .dw-imp p {
    margin: 0 0 8px;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--ink);
  }
  .add {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    padding: 6px 13px;
    background: var(--accent-ink);
    color: #fff;
    border: none;
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .add.ok {
    background: #2f6155;
  }
  .flows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flows li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
    font-size: var(--fs-label-xs);
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(28, 22, 17, 0.12);
    border-radius: var(--radius-sharp);
  }
  .flows b {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--ink);
  }
  .flows i {
    color: var(--accent-ink);
    font-style: normal;
  }
  .flows span {
    flex-basis: 100%;
    color: rgba(28, 22, 17, 0.65);
    line-height: 1.45;
  }
  .chips-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .chip {
    display: inline-block;
    font-size: var(--fs-label-xs);
    padding: 2px 9px;
    margin: 0 4px 4px 0;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-sharp);
    color: rgba(28, 22, 17, 0.75);
  }
  .caps {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.72);
  }
  .caps a {
    color: var(--accent-ink);
  }
  .dw-foot {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px dashed rgba(28, 22, 17, 0.2);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .srcs {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .srcs a {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
  }
</style>
