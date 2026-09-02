<script lang="ts">
  // One distilled lesson or value — the thing a future ponder actually reads.
  //
  // The raw memory underneath is the receipt; this is the principle. The card
  // has to keep both halves visible, because "it remembers this" and "it will
  // act on this" are different promises and the page's whole job is not to let
  // them look the same.
  //
  // The `id` is load-bearing: evidence trails elsewhere on the hub link to
  // `/jkai/daydreams/memory#memory-theme-<id>`, and the room scrolls that
  // anchor into view after paint.
  import { ORIGIN_LABEL, type DaydreamMemoryThemeView } from '$lib/daydream/memories';
  import { stamp } from '$lib/daydream/feed-client';

  interface Props {
    theme: DaydreamMemoryThemeView;
    /** Within the pack cap, so a ponder pass can actually read it. */
    inPack: boolean;
  }

  let { theme, inPack }: Props = $props();

  // Cited, not guessed: a thought recorded this theme id, so the influence is
  // a fact off the row rather than an inference from timing.
  const cited = $derived(theme.influenced.length);
</script>

<article class="card anchored t-{cited ? 'good' : 'steady'}" id="memory-theme-{theme.id}">
  <div class="card-hd">
    <div class="hd-text">
      <span class="card-kicker">{theme.kind}</span>
      <p class="card-title as-text">{theme.title}</p>
    </div>
    {#if inPack}
      <span class="pill t-good">in the ponder pack</span>
    {:else}
      <span class="pill t-quiet">outside the pack cap</span>
    {/if}
  </div>

  <p class="theme-statement">{theme.statement}</p>

  <div class="mem-use">
    <p class="field-label">How Daydreaming should apply it</p>
    <p class="detail-line">{theme.guidance}</p>
  </div>

  <div class="card-meta">
    <span class="tag accent">{theme.sourceCount} source{theme.sourceCount === 1 ? '' : 's'}</span>
    <span class="meta-item">{theme.confidence} confidence</span>
    <span class="meta-item stamp">updated {stamp(theme.updatedAt)}</span>
    <span class="meta-item {cited ? 'good' : ''}">
      influenced {cited} thought{cited === 1 ? '' : 's'}
    </span>
  </div>

  <div class="mem-use">
    <p class="field-label">Visible impact</p>
    {#if cited}
      <p class="detail-line">These thoughts cited this theme, so the link is recorded rather than guessed:</p>
      <div class="theme-links">
        {#each theme.influenced.slice(0, 8) as influence (influence.thoughtId)}
          <a class="theme-link" href="/jkai/daydreams/feed?open={influence.thoughtId}">
            {influence.title} · {stamp(influence.createdAt)}
          </a>
        {/each}
      </div>
    {:else}
      <p class="detail-line">
        Not cited by a thought yet. It is available to the ponder pass, but the feed will not claim
        influence until a generated thought actually names it.
      </p>
    {/if}
  </div>

  <details class="theme-sources">
    <summary>Raw memories rolled into this theme ({theme.sources.length})</summary>
    <div class="theme-source-list">
      {#each theme.sources as source (source.id)}
        <div class="theme-source">
          <p class="mem-sentence">{source.content}</p>
          <p class="note">
            {ORIGIN_LABEL[source.origin]} · {source.category} · {source.confidence} confidence · {stamp(source.createdAt)}
          </p>
        </div>
      {/each}
    </div>
  </details>
</article>

<style>
  .card-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .hd-text {
    min-width: 0;
  }
  .theme-statement {
    margin: 12px 0 0;
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1.25;
    color: var(--text-primary);
    text-wrap: balance;
  }
  .mem-use {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--line-hair);
  }
  .theme-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  /* Not `.tag`: a thought's own title is sentence case and must stay that way,
     and the vocabulary's tag uppercases. */
  .theme-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    letter-spacing: 0.04em;
    padding: 5px 9px;
    border: 1px solid var(--line-strong);
    color: var(--text-secondary);
    text-decoration: none;
    max-width: 46ch;
    transition:
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .theme-link:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .theme-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .theme-sources {
    margin-top: 12px;
    border-top: 1px solid var(--line-hair);
    padding-top: 10px;
  }
  .theme-sources summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  .theme-source-list {
    display: grid;
    gap: 10px;
    margin-top: 10px;
  }
  .theme-source + .theme-source {
    padding-top: 10px;
    border-top: 1px solid var(--line-hair);
  }
  .mem-sentence {
    margin: 10px 0 0;
    padding: 10px 12px;
    border-left: 2px solid var(--line-strong);
    background: rgba(26, 16, 8, 0.04);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-primary);
    text-wrap: pretty;
  }
</style>
