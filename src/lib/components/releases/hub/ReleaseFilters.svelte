<script lang="ts">
  // The console strip. A plain GET form, so it works with JavaScript off and
  // every view it produces is a shareable URL — the same contract the rest of
  // the page keeps.
  //
  // It carries no `page` input, which is deliberate: changing a filter should
  // land you on the first page of the new result, not on page 7 of it.
  //
  // The owner gets two extra controls. Impact and source are only meaningful
  // against the unfiltered corpus — an anonymous reader is served the
  // user-facing subset already, so an "impact" select would offer one real
  // choice and one empty one.
  import { KIND_LABEL, RELEASE_ITEM_KINDS } from '$lib/releases/types';

  interface Props {
    kind: string;
    q: string;
    /** Owner only. */
    impact?: string;
    via?: string;
    vias?: { via: string; count: number }[];
    owner?: boolean;
    /** `357 capabilities` — what the current filter actually matched. */
    result: string;
  }

  let { kind, q, impact = 'all', via = 'all', vias = [], owner = false, result }: Props = $props();

  const dirty = $derived(kind !== 'all' || q !== '' || impact !== 'all' || via !== 'all');
</script>

<form class="cf" method="get">
  <label class="cf-field grow">
    <span class="cf-label">Search</span>
    <input
      id="rel-q"
      type="search"
      name="q"
      value={q}
      placeholder={owner ? 'version, sha, feature or summary text' : 'a feature, a page, a version'}
    />
  </label>

  <label class="cf-field">
    <span class="cf-label">Kind</span>
    <select id="rel-kind" name="kind" value={kind}>
      <option value="all">All kinds</option>
      {#each RELEASE_ITEM_KINDS as k (k)}
        <option value={k}>{KIND_LABEL[k]}</option>
      {/each}
    </select>
  </label>

  {#if owner}
    <label class="cf-field">
      <span class="cf-label">Impact</span>
      <select id="rel-impact" name="impact" value={impact}>
        <option value="all">All</option>
        <option value="user-facing">User-facing</option>
        <option value="internal">Internal</option>
      </select>
    </label>

    <label class="cf-field">
      <span class="cf-label">Source</span>
      <select id="rel-via" name="via" value={via}>
        <option value="all">All sources</option>
        {#each vias as v (v.via)}
          <option value={v.via}>{v.via} ({v.count})</option>
        {/each}
      </select>
    </label>
  {/if}

  <button class="cf-go" type="submit">Apply</button>
  {#if dirty}
    <a class="cf-clear" href="/releases">Clear</a>
  {/if}
  <span class="cf-result">{result}</span>
</form>

<style>
  .cf {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
    padding: 18px 0 22px;
    border-bottom: 1px solid var(--line-strong);
    margin-bottom: 26px;
  }
  .cf-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .cf-field.grow {
    flex: 1;
    min-width: 220px;
  }
  .cf-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .cf input,
  .cf select {
    font-family: var(--font-body);
    /* 16px, not a label size: under it mobile Safari force-zooms the viewport
       and strands the rest of the row off-screen. */
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 8px 10px;
    min-width: 0;
  }
  .cf input:focus-visible,
  .cf select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .cf-go {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 11px 18px;
    border: 1px solid var(--accent);
    border-radius: 0;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
    transition:
      background 0.2s ease-out,
      color 0.2s ease-out;
  }
  .cf-go:hover {
    background: transparent;
    color: var(--accent);
  }

  .cf-clear,
  .cf-result {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding-bottom: 10px;
  }
  .cf-clear {
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .cf-clear:hover {
    border-bottom-color: var(--accent-ink);
  }
  .cf-result {
    color: var(--text-ghost);
    margin-left: auto;
  }
</style>
