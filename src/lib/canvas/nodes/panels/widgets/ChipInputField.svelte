<script lang="ts">
  let {
    value,
    placeholder,
    onChange,
  }: {
    value: string[];
    placeholder?: string;
    onChange: (v: string[]) => void;
  } = $props();

  let draft = $state('');

  function commit() {
    const t = draft.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...(value ?? []), t]);
    draft = '';
  }

  function remove(i: number) {
    const next = (value ?? []).slice();
    next.splice(i, 1);
    onChange(next);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && (value?.length ?? 0) > 0) {
      remove((value?.length ?? 0) - 1);
    }
  }
</script>

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
    onblur={commit}
  />
</div>

<style>
  .chip-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--bg); border: 1px solid var(--card-border); }
  .chip-input input { flex: 1; min-width: 80px; padding: 2px 4px; background: transparent; border: none; color: var(--text-primary); font: inherit; outline: none; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; }
  .chip-rm { background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 0 0 0 2px; }
  .chip-rm:hover { color: var(--status-error, #c0392b); }
</style>
