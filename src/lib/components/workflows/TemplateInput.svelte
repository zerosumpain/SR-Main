<script lang="ts">
  let {
    value = '',
    placeholder = '',
    variables = [],
    onInput,
  }: {
    value: string;
    placeholder?: string;
    variables: { path: string; type: string; description?: string }[];
    onInput: (value: string) => void;
  } = $props();

  let showDropdown = $state(false);
  let filterText = $state('');
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  const MAX_CHIPS = 5;

  const suggestions = $derived(
    filterText
      ? variables.filter((v) => v.path.toLowerCase().includes(filterText.toLowerCase()))
      : variables,
  );

  const visibleChips = $derived(variables.slice(0, MAX_CHIPS));
  const extraCount = $derived(Math.max(0, variables.length - MAX_CHIPS));

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    const val = target.value;
    onInput(val);

    // Detect if user is typing inside a {{ expression
    const cursorPos = target.selectionStart ?? val.length;
    const textUpToCursor = val.slice(0, cursorPos);
    const match = textUpToCursor.match(/\{\{input\.([^}]*)$/);
    if (match) {
      filterText = match[1];
      showDropdown = true;
    } else {
      showDropdown = false;
      filterText = '';
    }
  }

  function insertVariable(path: string) {
    if (!textareaEl) return;

    const cursorPos = textareaEl.selectionStart ?? value.length;
    const textUpToCursor = value.slice(0, cursorPos);
    const textAfterCursor = value.slice(cursorPos);

    // Find the start of the current {{ expression
    const matchIndex = textUpToCursor.search(/\{\{input\.[^}]*$/);
    if (matchIndex !== -1) {
      // Replace the partial expression
      const newValue = textUpToCursor.slice(0, matchIndex) + `{{input.${path}}}` + textAfterCursor;
      onInput(newValue);
    } else {
      // Insert at cursor
      const newValue = textUpToCursor + `{{input.${path}}}` + textAfterCursor;
      onInput(newValue);
    }

    showDropdown = false;
    filterText = '';

    // Restore focus
    setTimeout(() => textareaEl?.focus(), 0);
  }

  function insertChip(path: string) {
    const insertion = `{{input.${path}}}`;
    if (!textareaEl) {
      onInput(value + insertion);
      return;
    }

    const cursorPos = textareaEl.selectionStart ?? value.length;
    const newValue = value.slice(0, cursorPos) + insertion + value.slice(cursorPos);
    onInput(newValue);

    setTimeout(() => {
      if (textareaEl) {
        const newCursor = cursorPos + insertion.length;
        textareaEl.selectionStart = newCursor;
        textareaEl.selectionEnd = newCursor;
        textareaEl.focus();
      }
    }, 0);
  }

  function handleBlur() {
    // Delay to allow click on suggestion to register first
    setTimeout(() => {
      showDropdown = false;
    }, 150);
  }
</script>

<div class="relative">
  <textarea
    bind:this={textareaEl}
    {value}
    {placeholder}
    oninput={handleInput}
    onblur={handleBlur}
    class="w-full px-2 py-1.5 rounded text-xs border resize-none"
    style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 72px;"
    rows="4"
  ></textarea>

  {#if showDropdown && suggestions.length > 0}
    <div
      class="absolute z-50 left-0 right-0 rounded border shadow-lg overflow-hidden"
      style="top: calc(100% + 2px); background: var(--card-bg); border-color: var(--card-border);"
    >
      {#each suggestions.slice(0, 8) as variable}
        <button
          type="button"
          onmousedown={() => insertVariable(variable.path)}
          class="w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-black/5 transition-colors"
        >
          <span class="text-[11px] font-medium" style="color: var(--accent); font-family: var(--font-mono);">
            input.{variable.path}
          </span>
          <span class="text-[10px]" style="color: var(--text-ghost);">({variable.type})</span>
          {#if variable.description}
            <span class="text-[10px] truncate ml-auto" style="color: var(--text-ghost);">
              {variable.description}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if variables.length > 0}
    <div class="flex flex-wrap gap-1 mt-1.5">
      {#each visibleChips as variable}
        <button
          type="button"
          onclick={() => insertChip(variable.path)}
          class="text-[10px] px-1.5 py-0.5 rounded border transition-colors hover:opacity-80"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--accent); font-family: var(--font-mono);"
          title={variable.description ?? variable.path}
        >
          {variable.path}
        </button>
      {/each}
      {#if extraCount > 0}
        <span class="text-[10px] px-1 py-0.5" style="color: var(--text-ghost);">+{extraCount} more</span>
      {/if}
    </div>
  {/if}
</div>
