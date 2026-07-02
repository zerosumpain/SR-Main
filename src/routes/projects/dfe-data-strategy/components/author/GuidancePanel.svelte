<script lang="ts">
  import { author } from '../../lib/author/authorState.svelte';
  import { app } from '../../lib/appState.svelte';
  import { TEMPLATE_BY_ID } from '../../lib/author/templates';
  import { startersFor } from '../../lib/author/starters';
  import { SECTION_COMPARATORS, COMPARATOR_BY_ID } from '../../lib/comparators';
  import { markdownToHtml } from '../../lib/author/serialize';

  const section = $derived(author.active);
  const template = $derived(section?.templateId ? (TEMPLATE_BY_ID[section.templateId] ?? null) : null);
  const starters = $derived(section ? startersFor(section, template?.prompts ?? []) : []);
  const comparators = $derived(section?.templateId ? (SECTION_COMPARATORS[section.templateId] ?? []) : []);
  const heur = $derived(author.heuristicsBySection[section?.id ?? ''] ?? []);
  let inserted = $state<string | null>(null);

  function insert(id: string, html: string) {
    if (!section || !html) return;
    author.appendHtml(section.id, html);
    inserted = id;
    setTimeout(() => (inserted = null), 1200);
  }
  function insertPolicies() {
    const md = app.policies.map((p) => `- **${p.title}** — ${p.statement}`).join('\n');
    insert('policies', markdownToHtml(`### Draft headline policies\n\n${md}`));
  }
</script>

<aside class="gp" aria-label="Section guidance">
  {#if template}
    <section class="blk">
      <span class="blk-lab">What a strong section does</span>
      <p class="guide">{template.guidance}</p>
    </section>
    <section class="blk">
      <span class="blk-lab">Questions to answer</span>
      <ul class="prompts">
        {#each template.prompts as p}<li>{p}</li>{/each}
      </ul>
    </section>
  {:else}
    <section class="blk">
      <span class="blk-lab">Custom section</span>
      <p class="guide">Your own section — the completeness checks below still apply, and the coverage sweep reads it like any other.</p>
    </section>
  {/if}

  <section class="blk">
    <span class="blk-lab">Insert starter material</span>
    <div class="starts">
      {#each starters as s (s.id)}
        <button class="start" class:ok={inserted === s.id} onclick={() => insert(s.id, s.build())} title={s.hint}>
          {inserted === s.id ? '✓ inserted' : `+ ${s.label}`}
        </button>
      {/each}
      {#if app.policies.length}
        <button class="start" class:ok={inserted === 'policies'} onclick={insertPolicies} title="The headline policies you drafted in the Policy builder.">
          {inserted === 'policies' ? '✓ inserted' : `+ Your ${app.policies.length} drafted ${app.policies.length === 1 ? 'policy' : 'policies'}`}
        </button>
      {/if}
    </div>
    <p class="hint">Starters insert findings and obligations from the ledger — scaffolding to edit, not prose to keep.</p>
  </section>

  {#if comparators.length}
    <section class="blk">
      <span class="blk-lab">How others wrote this</span>
      {#each comparators as c}
        {@const comp = COMPARATOR_BY_ID[c.comparatorId]}
        {#if comp}
          <p class="comp">
            <a href={comp.url} target="_blank" rel="noopener">{comp.title} ↗</a>
            <span>{c.note}</span>
          </p>
        {/if}
      {/each}
    </section>
  {/if}

  {#if heur.length && (author.wordCounts[section?.id ?? ''] ?? 0) > 0}
    <section class="blk">
      <span class="blk-lab">Live checks</span>
      <ul class="checks">
        {#each heur as h}
          <li class:pass={h.pass}><i>{h.pass ? '✓' : '✕'}</i> {h.note}</li>
        {/each}
      </ul>
    </section>
  {/if}
</aside>

<style>
  .gp {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .blk {
    border: 1px solid rgba(28, 22, 17, 0.13);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.45);
    padding: 11px 13px;
  }
  .blk-lab {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-ink);
    margin-bottom: 6px;
  }
  .guide {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.75);
  }
  .prompts {
    margin: 0;
    padding-left: 17px;
  }
  .prompts li {
    font-size: 12px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.72);
    margin-bottom: 4px;
  }
  .starts {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .start {
    text-align: left;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 10px;
    background: var(--accent-ink-tint-06);
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-round);
    color: var(--accent-ink);
    cursor: pointer;
  }
  .start:hover {
    background: var(--accent-ink-tint-12);
  }
  .start.ok {
    border-color: #2f6155;
    color: #2f6155;
    background: rgba(47, 97, 85, 0.08);
  }
  .hint {
    margin: 7px 0 0;
    font-size: 10.5px;
    line-height: 1.45;
    color: rgba(28, 22, 17, 0.5);
  }
  .comp {
    margin: 0 0 8px;
    font-size: 12px;
    line-height: 1.5;
  }
  .comp a {
    display: block;
    color: var(--accent-ink);
    font-weight: 500;
    text-decoration: none;
    border-bottom: none;
  }
  .comp a:hover {
    text-decoration: underline;
  }
  .comp span {
    color: rgba(28, 22, 17, 0.65);
  }
  .checks {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .checks li {
    display: flex;
    gap: 7px;
    font-size: 11.5px;
    line-height: 1.45;
    color: rgba(28, 22, 17, 0.7);
    margin-bottom: 4px;
  }
  .checks li i {
    font-style: normal;
    color: #b04a2f;
    font-weight: 600;
  }
  .checks li.pass i {
    color: #2f6155;
  }
</style>
