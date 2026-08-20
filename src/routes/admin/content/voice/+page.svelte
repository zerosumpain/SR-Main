<svelte:head><title>Voice — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();

  // Read-only by design. The card is generated from the corpus and committed to
  // git, so it gets version history and PR review; editing it live would put the
  // one description of John's voice somewhere nobody can diff.
  let openBlock = $state<string | null>(null);
</script>

<PageWrap>
  <PageHeader
    kicker="Content"
    title="Voice"
    sub="What every automated writer is told about how John writes. Measured from his own posts, generated, and read-only here."
  />

  {#if !data.card}
    <section class="nm-sec">
      <div class="nm-empty">
        No card built yet. Run <code>scripts/build-voice-card.ts</code>.
      </div>
    </section>
  {:else}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Corpus</span>
        <span class="nm-sec-meta">v{data.card.version} · {data.card.builtAt}</span>
      </div>
      <p class="note">{data.card.corpus.sourceNote}</p>
    </section>

    {#if data.drift}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">Drift</span>
          <span class="nm-sec-meta">
            checked {data.drift.observedAt?.slice(0, 10) ?? '—'} · advisory only
          </span>
        </div>
        <p class="note">{data.drift.summary}</p>
        {#if data.drift.items.some((i) => i.material)}
          <ul class="tensions">
            {#each data.drift.items.filter((i) => i.material) as i (i.metric)}
              <li><strong>{i.metric}</strong> {i.was} → {i.now} ({i.changePct}%). {i.note}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Where the rules disagree with the evidence</span></div>
      <ul class="tensions">
        {#each data.card.tensions as t (t)}<li>{t}</li>{/each}
      </ul>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Registers</span>
        <span class="nm-sec-meta">as the surfaces receive them</span>
      </div>
      {#each data.blocks as b (b.register)}
        {@const rc = data.card.registers[b.register]}
        <div class="reg">
          <button
            type="button"
            class="reg-hd"
            aria-expanded={openBlock === b.register}
            onclick={() => (openBlock = openBlock === b.register ? null : b.register)}
          >
            <span class="reg-name">{b.register}</span>
            <span class="reg-facts">
              {rc.usesPersona ? 'persona' : 'conventions only'}
              · {rc.rules.length} rules
              · {rc.exemplarIds.length} exemplars
              · {Math.ceil(b.text.length / 4)} tok
            </span>
          </button>
          {#if openBlock === b.register}
            <pre class="reg-body">{b.text}</pre>
          {/if}
        </div>
      {/each}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Exemplars</span>
        <span class="nm-sec-meta">{data.exemplars.length} passages, verbatim</span>
      </div>
      {#each data.exemplars as e (e.id)}
        <figure class="ex">
          <figcaption>{e.shows} <span class="ex-src">— post {e.sourcePostId}, {e.sourceSlug}</span></figcaption>
          <blockquote>{e.text}</blockquote>
        </figure>
      {/each}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Changing it</span></div>
      <p class="note">
        Re-measure with <code>npx tsx scripts/build-voice-card.ts --corpus corpus.json --write</code>
        (see <code>docs/voice-corpus.md</code>), then push it to Hermes, the Claude skill and
        sr-docs with <code>scripts/sync-voice.sh</code>. Commit the result — the card is
        version-controlled on purpose, so a change to how everything writes is reviewable.
      </p>
    </section>
  {/if}
</PageWrap>

<style>
  .note { color: var(--text-secondary); font-size: 0.9rem; margin: 0; }
  .tensions { margin: 0; padding-left: 1.1rem; color: var(--text-secondary); font-size: 0.9rem; }
  .tensions li { padding: 3px 0; }
  .reg { border-bottom: 1px solid var(--divider); }
  .reg-hd {
    width: 100%; display: flex; gap: 0.75rem; align-items: baseline;
    background: none; border: 0; padding: 0.6rem 0.25rem; cursor: pointer;
    text-align: left; color: inherit; font: inherit;
  }
  .reg-hd:hover { background: var(--accent-tint-08); }
  .reg-name {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-primary);
  }
  .reg-facts {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-ghost); margin-left: auto;
  }
  .reg-body {
    margin: 0 0 0.75rem 0; padding: 0.75rem; overflow-x: auto;
    background: var(--bg-section); border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-secondary); white-space: pre-wrap;
  }
  .ex { margin: 0 0 1rem 0; }
  .ex figcaption {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-primary); letter-spacing: 0.04em; padding-bottom: 4px;
  }
  .ex-src { color: var(--text-ghost); }
  .ex blockquote {
    margin: 0; padding: 0.6rem 0.9rem;
    border-left: 2px solid var(--accent); color: var(--text-secondary);
    font-size: 0.9rem;
  }
</style>
