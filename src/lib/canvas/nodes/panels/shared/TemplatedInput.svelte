<script lang="ts">
  // Single-line variant of TemplatedTextarea. Same `{{` -> dropdown UX,
  // wrapped around an <input type="text">. Used for short templated
  // fields like URLs and output paths.

  interface Props {
    value: string;
    onChange: (v: string) => void;
    upstreamFields?: string[];
    placeholder?: string;
    class?: string;
    spellcheck?: boolean;
    disabled?: boolean;
    type?: string;
  }

  let {
    value,
    onChange,
    upstreamFields = [],
    placeholder,
    class: klass = '',
    spellcheck = false,
    disabled = false,
    type = 'text',
  }: Props = $props();

  let inEl = $state<HTMLInputElement | null>(null);

  let partial = $state<string | null>(null);
  let openAtBraceIdx = $state<number>(-1);
  let caret = $state<number>(0);
  let highlight = $state<number>(0);

  function findActivePartial(text: string, caretPos: number): { partial: string; openIdx: number } | null {
    const upto = text.slice(0, caretPos);
    const openIdx = upto.lastIndexOf('{{');
    if (openIdx === -1) return null;
    const between = upto.slice(openIdx + 2);
    if (between.includes('}}')) return null;
    return { partial: between, openIdx };
  }

  const filtered = $derived.by(() => {
    if (partial === null) return [] as string[];
    const fields = upstreamFields ?? [];
    if (fields.length === 0) return [];
    const needle = partial.trim().toLowerCase();
    const stripped = needle.startsWith('input.') ? needle.slice('input.'.length) : needle;
    const matches: string[] = [];
    for (const f of fields) {
      const lower = f.toLowerCase();
      if (!stripped || lower.includes(stripped)) {
        matches.push(f);
        if (matches.length >= 8) break;
      }
    }
    return matches;
  });

  $effect(() => {
    if (highlight >= filtered.length) highlight = 0;
  });

  function close() {
    partial = null;
    openAtBraceIdx = -1;
    highlight = 0;
  }

  function handleInput(e: Event) {
    const inp = e.currentTarget as HTMLInputElement;
    const next = inp.value;
    caret = inp.selectionStart ?? next.length;
    onChange(next);
    if ((upstreamFields ?? []).length === 0) {
      close();
      return;
    }
    const found = findActivePartial(next, caret);
    if (!found) {
      close();
      return;
    }
    partial = found.partial;
    openAtBraceIdx = found.openIdx;
  }

  function insertField(field: string) {
    if (!inEl || openAtBraceIdx < 0) return;
    const text = inEl.value;
    const before = text.slice(0, openAtBraceIdx);
    const after = text.slice(caret);
    const trailingClose = after.startsWith('}}');
    const insertion = `{{${field}}}`;
    const next = before + insertion + (trailingClose ? after.slice(2) : after);
    onChange(next);
    const newCaret = before.length + insertion.length;
    queueMicrotask(() => {
      if (!inEl) return;
      inEl.value = next;
      inEl.setSelectionRange(newCaret, newCaret);
      inEl.focus();
      caret = newCaret;
    });
    close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (partial === null || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight = (highlight + 1) % filtered.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight = (highlight - 1 + filtered.length) % filtered.length;
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const choice = filtered[highlight];
      if (choice) insertField(choice);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function handleSelectionChange(e: Event) {
    const inp = e.currentTarget as HTMLInputElement;
    caret = inp.selectionStart ?? caret;
    if ((upstreamFields ?? []).length === 0) return;
    const found = findActivePartial(inp.value, caret);
    if (!found) {
      close();
      return;
    }
    if (partial !== null) {
      partial = found.partial;
      openAtBraceIdx = found.openIdx;
    }
  }

  function handleBlur() {
    setTimeout(() => close(), 120);
  }
</script>

<div class="ti-wrap">
  <input
    bind:this={inEl}
    class="ti-input {klass}"
    {type}
    {placeholder}
    {disabled}
    spellcheck={spellcheck}
    {value}
    oninput={handleInput}
    onkeydown={handleKeydown}
    onclick={handleSelectionChange}
    onkeyup={handleSelectionChange}
    onblur={handleBlur}
  />

  {#if partial !== null && filtered.length > 0}
    <ul class="ti-popup" role="listbox">
      {#each filtered as field, i (field)}
        <li
          role="option"
          aria-selected={i === highlight}
          class:ti-popup-row-active={i === highlight}
          onmousedown={(e) => { e.preventDefault(); insertField(field); }}
          onmouseenter={() => (highlight = i)}
        >
          <span class="ti-popup-mark">{`{{`}</span>
          <span class="ti-popup-path">{field}</span>
          <span class="ti-popup-mark">{`}}`}</span>
        </li>
      {/each}
      <li class="ti-popup-foot">
        <span>↑↓ navigate · ⏎/⇥ insert · Esc dismiss</span>
      </li>
    </ul>
  {/if}
</div>

<style>
  .ti-wrap { position: relative; width: 100%; }
  .ti-input { width: 100%; box-sizing: border-box; font: inherit; }

  .ti-popup {
    position: absolute;
    z-index: 9999;
    top: 100%;
    left: 0;
    margin: 4px 0 0;
    padding: 2px 0;
    list-style: none;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    min-width: 220px;
    max-width: 360px;
    max-height: 260px;
    overflow-y: auto;
    width: max-content;
  }
  .ti-popup li {
    padding: 4px 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ti-popup-row-active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .ti-popup-mark { color: var(--text-muted); }
  .ti-popup-path { color: var(--text-primary); }
  .ti-popup-foot {
    border-top: 1px dashed var(--card-border);
    color: var(--text-ghost);
    font-size: var(--fs-label-xs);
    padding: 4px 8px;
    cursor: default;
  }
  .ti-popup-foot:hover { background: transparent; }
</style>
