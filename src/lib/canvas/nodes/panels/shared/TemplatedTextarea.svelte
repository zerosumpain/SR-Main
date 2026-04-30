<script lang="ts">
  // A drop-in replacement for <textarea> that surfaces a mention-style
  // autocomplete dropdown of upstream field paths whenever the user types
  // `{{`. The user picks a field and we insert it (plus the matching `}}`)
  // at the caret. When `upstreamFields` is empty, the component degrades
  // to a plain textarea — no popup, no extra DOM beyond the wrapper.
  //
  // Why this exists:
  //   Panels like LlmCallPanel/IntelWritePanel intentionally accept free
  //   text (the user is writing a prompt) but the prompt almost always
  //   embeds `{{input.X}}` references to upstream node output. Without
  //   help, the user has to remember every dot-path. This component lets
  //   them browse instead of memorise.
  //
  // Caret-anchoring:
  //   We use the `textarea-caret-position` library if it's available in
  //   node_modules. If not, we degrade to anchoring the popup below the
  //   textarea — usable, less precise. The fallback path also covers
  //   mobile where over-clever positioning fights the on-screen keyboard.

  interface Props {
    value: string;
    onChange: (v: string) => void;
    upstreamFields?: string[];
    placeholder?: string;
    rows?: number;
    class?: string;
    spellcheck?: boolean;
    disabled?: boolean;
    /**
     * Optional keydown handler that runs BEFORE the popup's nav/insert logic
     * when the popup is closed. Lets callers (e.g. TavilySearchPanel) keep
     * single-line behaviour. If it calls preventDefault, popup logic is
     * also skipped for that event.
     */
    onKeydown?: (e: KeyboardEvent) => void;
  }

  let {
    value,
    onChange,
    upstreamFields = [],
    placeholder,
    rows = 4,
    class: klass = '',
    spellcheck = false,
    disabled = false,
    onKeydown,
  }: Props = $props();

  let taEl = $state<HTMLTextAreaElement | null>(null);

  // ---------- Suggestion state -------------------------------------------
  // `partial` is the substring between the active `{{` and the caret. When
  // null, the popup is hidden. `caret` tracks the caret offset within the
  // textarea so we know where to splice the chosen field on Enter/Tab.
  let partial = $state<string | null>(null);
  let openAtBraceIdx = $state<number>(-1); // index of the `{` of the opening `{{` token
  let caret = $state<number>(0);
  let highlight = $state<number>(0);
  let popupTop = $state<number>(0);
  let popupLeft = $state<number>(0);
  let popupBelow = $state<boolean>(true); // fallback positioning flag

  // Lazy-load the optional caret library. Resolved once per component
  // lifetime; if the import fails we just fall back to "below the box".
  let getCaretCoords = $state<((el: HTMLTextAreaElement, pos: number) => { top: number; left: number; height: number }) | null>(null);
  let triedCaretLib = $state(false);

  async function ensureCaretLib() {
    if (triedCaretLib || getCaretCoords) return;
    triedCaretLib = true;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error — optional dep, may not be installed
      const mod = await import('textarea-caret-position');
      const fn = (mod as { default?: unknown; getCaretCoordinates?: unknown }).getCaretCoordinates
        ?? (mod as { default?: unknown }).default;
      if (typeof fn === 'function') {
        getCaretCoords = fn as (el: HTMLTextAreaElement, pos: number) => { top: number; left: number; height: number };
      }
    } catch {
      // not installed — leave getCaretCoords null and use fallback
    }
  }

  // Match the partial path immediately preceding the caret. Returns the
  // partial string and the start index of the opening `{{` token, or null
  // if we're not inside an unterminated `{{...` expression.
  function findActivePartial(text: string, caretPos: number): { partial: string; openIdx: number } | null {
    // Scan backwards from the caret looking for `{{` without seeing a
    // closing `}}` first. We only care about the SAME line — multi-line
    // template references would be unusual and error-prone.
    const upto = text.slice(0, caretPos);
    const openIdx = upto.lastIndexOf('{{');
    if (openIdx === -1) return null;
    const between = upto.slice(openIdx + 2);
    if (between.includes('}}')) return null;
    // Stop suggestions if the user typed a newline inside the brace.
    if (between.includes('\n')) return null;
    return { partial: between, openIdx };
  }

  const filtered = $derived.by(() => {
    if (partial === null) return [] as string[];
    const fields = upstreamFields ?? [];
    if (fields.length === 0) return [];
    const needle = partial.trim().toLowerCase();
    // Strip a leading `input.` so users searching for `query` still match
    // `input.query` (the canonical form). The inserted text always uses
    // the field path as stored in `upstreamFields`.
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

  // Keep `highlight` valid as the filter list shrinks/grows.
  $effect(() => {
    if (highlight >= filtered.length) highlight = 0;
  });

  function close() {
    partial = null;
    openAtBraceIdx = -1;
    highlight = 0;
  }

  function refreshPopupPosition() {
    if (!taEl) return;
    if (getCaretCoords) {
      try {
        const coords = getCaretCoords(taEl, caret);
        // Coordinates are relative to the textarea's content box. Convert
        // to viewport coords for the floating popup.
        const rect = taEl.getBoundingClientRect();
        const top = rect.top + coords.top - taEl.scrollTop + (coords.height || 14) + 4;
        const left = rect.left + coords.left - taEl.scrollLeft;
        popupTop = top;
        popupLeft = left;
        popupBelow = false;
        return;
      } catch {
        // fall through to below-the-box fallback
      }
    }
    const rect = taEl.getBoundingClientRect();
    popupTop = rect.bottom + 4;
    popupLeft = rect.left;
    popupBelow = true;
  }

  function handleInput(e: Event) {
    const ta = e.currentTarget as HTMLTextAreaElement;
    const next = ta.value;
    caret = ta.selectionStart ?? next.length;
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
    void ensureCaretLib().then(() => refreshPopupPosition());
    refreshPopupPosition();
  }

  function insertField(field: string) {
    if (!taEl || openAtBraceIdx < 0) return;
    const text = taEl.value;
    // Splice from the opening `{{` to the current caret, replacing the
    // partial with `{{field}}`. If the text immediately after the caret
    // is already `}}` (the user typed it eagerly), don't double up.
    const before = text.slice(0, openAtBraceIdx);
    const after = text.slice(caret);
    const trailingClose = after.startsWith('}}');
    const insertion = `{{${field}}}`;
    const next = before + insertion + (trailingClose ? after.slice(2) : after);
    onChange(next);
    // Restore caret to the position immediately after the inserted token.
    const newCaret = before.length + insertion.length;
    queueMicrotask(() => {
      if (!taEl) return;
      taEl.value = next;
      taEl.setSelectionRange(newCaret, newCaret);
      taEl.focus();
      caret = newCaret;
    });
    close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (partial === null || filtered.length === 0) {
      // Popup closed — let the caller's handler run (e.g. for Enter
      // suppression in single-line-style fields).
      onKeydown?.(e);
      return;
    }
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
    // Track caret movement when the user clicks/arrows around so the
    // popup either re-anchors or dismisses.
    const ta = e.currentTarget as HTMLTextAreaElement;
    caret = ta.selectionStart ?? caret;
    if ((upstreamFields ?? []).length === 0) return;
    const found = findActivePartial(ta.value, caret);
    if (!found) {
      close();
      return;
    }
    if (partial !== null) {
      partial = found.partial;
      openAtBraceIdx = found.openIdx;
      refreshPopupPosition();
    }
  }

  function handleBlur() {
    // Allow click events on the popup to land before we tear it down.
    setTimeout(() => close(), 120);
  }

  // Reposition popup as the textarea scrolls (long prompts).
  function handleScroll() {
    if (partial !== null) refreshPopupPosition();
  }
</script>

<div class="tt-wrap">
  <textarea
    bind:this={taEl}
    class="tt-textarea {klass}"
    {rows}
    {placeholder}
    {disabled}
    spellcheck={spellcheck}
    {value}
    oninput={handleInput}
    onkeydown={handleKeydown}
    onclick={handleSelectionChange}
    onkeyup={handleSelectionChange}
    onscroll={handleScroll}
    onblur={handleBlur}
  ></textarea>

  {#if partial !== null && filtered.length > 0}
    <ul
      class="tt-popup"
      class:tt-popup-below={popupBelow}
      style:top={popupBelow ? '' : `${popupTop}px`}
      style:left={popupBelow ? '' : `${popupLeft}px`}
      role="listbox"
    >
      {#each filtered as field, i (field)}
        <li
          role="option"
          aria-selected={i === highlight}
          class:tt-popup-row-active={i === highlight}
          onmousedown={(e) => { e.preventDefault(); insertField(field); }}
          onmouseenter={() => (highlight = i)}
        >
          <span class="tt-popup-mark">{`{{`}</span>
          <span class="tt-popup-path">{field}</span>
          <span class="tt-popup-mark">{`}}`}</span>
        </li>
      {/each}
      <li class="tt-popup-foot">
        <span>↑↓ navigate · ⏎/⇥ insert · Esc dismiss</span>
      </li>
    </ul>
  {/if}
</div>

<style>
  .tt-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  /* Inherit caller's class for the textarea — the panels pass their own
     style hooks (e.g. `lc-code`, `iw-content`) so we keep their look. */
  .tt-textarea {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
  }

  .tt-popup {
    position: fixed;
    z-index: 9999;
    margin: 0;
    padding: 2px 0;
    list-style: none;
    background: var(--bg);
    border: 1px solid var(--card-border);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    min-width: 220px;
    max-width: 360px;
    max-height: 260px;
    overflow-y: auto;
  }
  /* Fallback: anchor below the textarea via CSS rather than fixed coords. */
  .tt-popup-below {
    position: absolute;
    top: 100%;
    left: 0;
    right: auto;
    margin-top: 4px;
    width: max-content;
  }
  .tt-popup li {
    padding: 4px 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tt-popup-row-active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .tt-popup-mark {
    color: var(--text-muted);
  }
  .tt-popup-path {
    color: var(--text-primary);
  }
  .tt-popup-foot {
    border-top: 1px dashed var(--card-border);
    color: var(--text-ghost);
    font-size: 10px;
    padding: 4px 8px;
    cursor: default;
  }
  .tt-popup-foot:hover { background: transparent; }
</style>
