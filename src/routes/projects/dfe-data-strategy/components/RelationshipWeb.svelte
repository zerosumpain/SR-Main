<script lang="ts">
  import { RELATIONSHIPS, REL_DYNAMICS, RELATIONSHIP_BY_ID } from '../lib/relationships';

  // How the relationships play out: pick a partner, and the two-way deal —
  // what the department takes, what it gives back, the mandate, the friction — stays
  // right below the picker. Cross-cutting dynamics follow.
  let relId = $state<string>(RELATIONSHIPS[0]?.id ?? '');
  const rel = $derived(RELATIONSHIP_BY_ID[relId] ?? RELATIONSHIPS[0]);

  function jump(id: string) {
    if (RELATIONSHIP_BY_ID[id]) {
      relId = id;
      document.getElementById('rel-picker')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
</script>

<div class="rw">
  <div class="picker" id="rel-picker" role="tablist" aria-label="Partners">
    {#each RELATIONSHIPS as r (r.id)}
      <button class="pk" class:on={relId === r.id} role="tab" aria-selected={relId === r.id} onclick={() => (relId = r.id)}>
        {r.name}
        <i>{r.flowsIn.length}→ · ←{r.flowsOut.length}</i>
      </button>
    {/each}
  </div>

  {#if rel}
    <div class="panel">
      <p class="who">{rel.who}</p>
      <div class="flows">
        <section class="fcol in">
          <h4><i>→</i> What the department takes</h4>
          {#each rel.flowsIn as f}
            <div class="flow">
              <b>{f.what}</b>
              <span>{f.detail}</span>
            </div>
          {/each}
        </section>
        <section class="fcol out">
          <h4><i>←</i> What the department gives back</h4>
          {#each rel.flowsOut as f}
            <div class="flow">
              <b>{f.what}</b>
              <span>{f.detail}</span>
            </div>
          {/each}
        </section>
      </div>
      <div class="deal">
        <div class="d-item">
          <span class="d-lab">⚖ The mandate</span>
          <p>{rel.mandate}</p>
        </div>
        <div class="d-item friction">
          <span class="d-lab">⚡ The friction</span>
          <p>{rel.friction}</p>
        </div>
        <div class="d-item">
          <span class="d-lab">◎ What they want</span>
          <p>{rel.wants}</p>
        </div>
      </div>
      <div class="srcs">
        {#each rel.sources as s}
          <a href={s.url} target="_blank" rel="noopener">{s.name} ↗</a>
        {/each}
      </div>
    </div>
  {/if}

  <h3 class="dyn-h">How the relationships play out — the patterns</h3>
  <p class="dyn-sub">Watch the same five dynamics recur across every relationship above. A strategy that ignores them is writing about a different department.</p>
  <div class="pe-grid dyns">
    {#each REL_DYNAMICS as d (d.id)}
      <div class="dyn">
        <span class="dy-title">{d.title}</span>
        <p class="dy-text">{d.text}</p>
        <span class="dy-eg">
          Seen in:
          {#each d.exampleIds as id, i}{i > 0 ? ' · ' : ' '}<button class="dy-link" onclick={() => jump(id)}>{RELATIONSHIP_BY_ID[id]?.name ?? id}</button>{/each}
        </span>
      </div>
    {/each}
  </div>
</div>

<style>
  .picker {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
    scroll-margin-top: calc(var(--topH, 90px) + 12px);
  }
  .pk {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
    font-family: 'DM Sans', sans-serif;
    font-size: 12.5px;
    font-weight: 600;
    padding: 7px 12px;
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.55);
    color: var(--ink);
    cursor: pointer;
  }
  .pk i {
    font-style: normal;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    font-weight: 400;
    color: rgba(28, 22, 17, 0.5);
  }
  .pk:hover {
    border-color: rgba(28, 22, 17, 0.45);
  }
  .pk.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper, #f1ead6);
  }
  .pk.on i {
    color: rgba(241, 234, 214, 0.65);
  }

  .panel {
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.4);
    padding: 15px 18px 16px;
    margin-bottom: 28px;
  }
  .who {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.72);
    max-width: 90ch;
  }
  .flows {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .fcol h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 7px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .fcol h4 i {
    font-style: normal;
    font-size: 13px;
  }
  .fcol.in h4 i {
    color: #8a2d3a;
  }
  .fcol.out h4 i {
    color: #2f6155;
  }
  .flow {
    border: 1px solid rgba(28, 22, 17, 0.11);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.55);
    padding: 8px 11px;
    margin-bottom: 6px;
  }
  .fcol.in .flow {
    border-left: 3px solid rgba(138, 45, 58, 0.55);
  }
  .fcol.out .flow {
    border-left: 3px solid rgba(47, 97, 85, 0.55);
  }
  .flow b {
    display: block;
    font-family: 'DM Sans', sans-serif;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .flow span {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.65);
  }
  .deal {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
    padding-top: 11px;
    border-top: 1px dashed rgba(28, 22, 17, 0.18);
  }
  .d-lab {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin-bottom: 4px;
  }
  .d-item p {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.75);
  }
  .d-item.friction p {
    color: #7a2d3a;
  }
  .srcs {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .srcs a {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
  }

  .dyn-h {
    margin: 0 0 4px;
    font-family: 'Fraunces', serif;
    font-size: 19px;
    font-weight: 600;
    color: var(--ink);
  }
  .dyn-sub {
    margin: 0 0 12px;
    font-size: 12.5px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.65);
    max-width: 80ch;
  }
  .dyn {
    border: 1px solid rgba(28, 22, 17, 0.12);
    border-top: 3px solid #b4632e;
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.45);
    padding: 12px 14px;
  }
  .dy-title {
    display: block;
    font-family: 'Fraunces', serif;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 4px;
  }
  .dy-text {
    margin: 0 0 8px;
    font-size: 11.5px;
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.72);
  }
  .dy-eg {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    color: rgba(28, 22, 17, 0.5);
  }
  .dy-link {
    background: none;
    border: none;
    padding: 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    color: var(--accent-ink);
    cursor: pointer;
    text-decoration: underline dashed;
  }
  @media (max-width: 860px) {
    .flows {
      grid-template-columns: 1fr;
    }
    .deal {
      grid-template-columns: 1fr;
      gap: 9px;
    }
  }
</style>
