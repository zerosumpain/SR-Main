<script lang="ts">
  let {
    value,
    placeholder,
    onChange,
    suggestions,
    fetcher,
    maxSuggestions = 8,
  }: {
    value: string[];
    placeholder?: string;
    onChange: (v: string[]) => void;
    /**
     * Optional list of suggestions to autocomplete from. When provided
     * (or when `fetcher` populates it), typing in the input shows a
     * filtered dropdown of matching values that can be clicked to add.
     */
    suggestions?: string[];
    /**
     * Optional async loader for suggestions. Called once on mount; the
     * resolved list is merged with any static `suggestions` prop.
     */
    fetcher?: () => Promise<string[]>;
    /** Cap on how many suggestions to show in the dropdown (default 8). */
    maxSuggestions?: number;
  } = $props();

  let draft = $state('');
  let fetched = $state<string[]>([]);
  let showDropdown = $state(false);
  let highlightIdx = $state(-1);

  // Pull suggestions from fetcher on mount (best-effort; failures are silent).
  $effect(() => {
    if (!fetcher) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetcher();
        if (!cancelled && Array.isArray(list)) fetched = list;
      } catch {
        /* ignore — autocomplete is purely additive */
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const allSuggestions = $derived.by(() => {
    const combined = [...(suggestions ?? []), ...fetched];
    // De-dupe preserving order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of combined) {
      if (typeof s !== 'string') continue;
      const t = s.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  });

  const hasAutocomplete = $derived(
    allSuggestions.length > 0 || Boolean(fetcher) || Boolean(suggestions),
  );

  const filteredSuggestions = $derived.by(() => {
    if (!hasAutocomplete) return [];
    const q = draft.trim().toLowerCase();
    const taken = new Set((value ?? []).map((v) => v.toLowerCase()));
    const matches = allSuggestions.filter((s) => {
      const lower = s.toLowerCase();
      if (taken.has(lower)) return false;
      if (!q) return true;
      return lower.includes(q);
    });
    return matches.slice(0, maxSuggestions);
  });

  function commit(raw?: string) {
    const t = (raw ?? draft).trim();
    if (!t) return;
    if (!(value ?? []).includes(t)) onChange([...(value ?? []), t]);
    draft = '';
    highlightIdx = -1;
  }

  function remove(i: number) {
    const next = (value ?? []).slice();
    next.splice(i, 1);
    onChange(next);
  }

  function onKeyDown(e: KeyboardEvent) {
    const list = filteredSuggestions;
    if (showDropdown && list.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIdx = (highlightIdx + 1) % list.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIdx = highlightIdx <= 0 ? list.length - 1 : highlightIdx - 1;
        return;
      }
      if (e.key === 'Escape') {
        showDropdown = false;
        highlightIdx = -1;
        return;
      }
      if (e.key === 'Enter' && highlightIdx >= 0) {
        e.preventDefault();
        commit(list[highlightIdx]);
        return;
      }
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && (value?.length ?? 0) > 0) {
      remove((value?.length ?? 0) - 1);
    }
  }

  function onFocus() {
    if (hasAutocomplete) showDropdown = true;
  }

  function onBlur() {
    // Defer so a click on a suggestion can register before we hide.
    setTimeout(() => {
      showDropdown = false;
      highlightIdx = -1;
      commit();
    }, 120);
  }

  function pick(s: string) {
    commit(s);
    showDropdown = false;
  }
</script>

<div class="chip-input-wrap">
  <div class="chip-input">
    {#each value ?? [] as v, i (v + i)}
      <span class="chip">
        {v}
        <button type="button" class="chip-rm" onclick={() => remove(i)} aria-label="remove">×</button>
      </span>
    {/each}
    <input
      type="text"
      bind:value={draft}
      placeholder={placeholder ?? 'Type and press Enter'}
      onkeydown={onKeyDown}
      onfocus={onFocus}
      onblur={onBlur}
    />
  </div>
  {#if showDropdown && filteredSuggestions.length > 0}
    <ul class="chip-suggest" role="listbox">
      {#each filteredSuggestions as s, i (s)}
        <li>
          <button
            type="button"
            class="chip-suggest-item"
            class:active={i === highlightIdx}
            onmousedown={(e) => {
              e.preventDefault();
              pick(s);
            }}
          >
            {s}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .chip-input-wrap { position: relative; }
  .chip-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--bg); border: 1px solid var(--card-border); }
  .chip-input input { flex: 1; min-width: 80px; padding: 2px 4px; background: transparent; border: none; color: var(--text-primary); font: inherit; outline: none; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-label); }
  .chip-rm { background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 0 0 0 2px; }
  .chip-rm:hover { color: var(--status-error, #c0392b); }

  .chip-suggest {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 20;
    margin: 0;
    padding: 2px;
    list-style: none;
    background: var(--bg);
    border: 1px solid var(--card-border);
    max-height: 200px;
    overflow-y: auto;
  }
  .chip-suggest-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 6px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    cursor: pointer;
  }
  .chip-suggest-item:hover,
  .chip-suggest-item.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
</style>
