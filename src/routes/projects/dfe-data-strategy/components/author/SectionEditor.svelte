<script lang="ts">
  import { untrack } from 'svelte';
  import { author } from '../../lib/author/authorState.svelte';
  import { sanitizeHtml } from '../../lib/author/sanitize';

  // The contenteditable surface. The store is the source of truth; we only push
  // DOM→store (debounced) while the user types, and store→DOM when the active
  // section changes or content is replaced from outside (starter inserts, restore).
  let surface: HTMLElement | undefined = $state();
  let editingId: string | null = null; // which section the DOM currently shows (not reactive on purpose)
  let saveTimer: ReturnType<typeof setTimeout> | null = null; // plain handle — never $state (effect-loop gotcha)
  let savedFlash = $state(false);

  const TOOLBAR: { cmd: string; arg?: string; label: string; title: string }[] = [
    { cmd: 'bold', label: 'B', title: 'Bold' },
    { cmd: 'italic', label: 'I', title: 'Italic' },
    { cmd: 'underline', label: 'U', title: 'Underline' },
    { cmd: 'formatBlock', arg: 'h3', label: 'H3', title: 'Heading' },
    { cmd: 'formatBlock', arg: 'h4', label: 'H4', title: 'Sub-heading' },
    { cmd: 'insertUnorderedList', label: '•', title: 'Bullet list' },
    { cmd: 'insertOrderedList', label: '1.', title: 'Numbered list' },
    { cmd: 'formatBlock', arg: 'blockquote', label: '❝', title: 'Quote' },
    { cmd: 'formatBlock', arg: 'p', label: '¶', title: 'Paragraph' },
  ];

  function exec(cmd: string, arg?: string) {
    surface?.focus();
    document.execCommand(cmd, false, arg);
    scheduleSave();
  }
  function addLink() {
    const url = prompt('Link URL (https://…):');
    if (url && /^https?:\/\//.test(url)) exec('createLink', url);
  }
  function clearFormat() {
    exec('removeFormat');
    exec('formatBlock', 'p');
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (surface && editingId) {
        author.setHtml(editingId, surface.innerHTML);
        savedFlash = true;
        setTimeout(() => (savedFlash = false), 900);
      }
    }, 500);
  }

  function flushNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (surface && editingId) author.setHtml(editingId, surface.innerHTML);
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const clean = html ? sanitizeHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, html ? clean : `<p>${clean}</p>`);
    scheduleSave();
  }

  // store → DOM: when the active section changes, or its html is changed by
  // something other than this editor (starter insert, snapshot restore).
  $effect(() => {
    const section = author.active;
    const html = section?.html ?? '';
    const el = untrack(() => surface);
    if (!el || !section) return;
    if (editingId !== section.id) {
      flushOld(el);
      editingId = section.id;
      el.innerHTML = html;
    } else if (el.innerHTML !== html && document.activeElement !== el) {
      // external change while not typing (insert/restore) — adopt it
      el.innerHTML = html;
    }
  });
  function flushOld(el: HTMLElement) {
    if (editingId && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      author.setHtml(editingId, el.innerHTML);
    }
  }
</script>

<div class="ed">
  <div class="bar" role="toolbar" aria-label="Formatting">
    {#each TOOLBAR as t}
      <button class="tb" class:serif={t.label === 'B' || t.label === 'I'} title={t.title} onmousedown={(e) => e.preventDefault()} onclick={() => exec(t.cmd, t.arg)}>{t.label}</button>
    {/each}
    <button class="tb" title="Insert link" onmousedown={(e) => e.preventDefault()} onclick={addLink}>⧉</button>
    <button class="tb" title="Clear formatting" onmousedown={(e) => e.preventDefault()} onclick={clearFormat}>⌫</button>
    <span class="save" class:on={savedFlash}>saved</span>
  </div>
  <div
    class="surface"
    bind:this={surface}
    contenteditable="true"
    role="textbox"
    aria-multiline="true"
    aria-label="Section text"
    data-placeholder="Write “{author.active?.title}” here — or insert a starter from the panel on the right."
    oninput={scheduleSave}
    onblur={flushNow}
    onpaste={onPaste}
  ></div>
</div>

<style>
  .ed {
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.62);
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 6px 9px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.12);
    background: rgba(241, 234, 214, 0.55);
    flex-wrap: wrap;
  }
  .tb {
    min-width: 28px;
    padding: 4px 7px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-sharp, 3px);
    color: var(--ink);
    cursor: pointer;
  }
  .tb.serif {
    font-family: 'Fraunces', serif;
    font-weight: 600;
  }
  .tb:hover {
    background: rgba(28, 22, 17, 0.08);
  }
  .save {
    margin-left: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #2f6155;
    opacity: 0;
    transition: opacity 0.25s;
  }
  .save.on {
    opacity: 1;
  }
  .surface {
    min-height: 380px;
    padding: 18px 22px 26px;
    outline: none;
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    line-height: 1.62;
    color: var(--ink);
  }
  .surface:empty::before {
    content: attr(data-placeholder);
    color: rgba(28, 22, 17, 0.35);
    font-style: italic;
    pointer-events: none;
  }
  .surface :global(h3) {
    font-family: 'Fraunces', serif;
    font-size: 19px;
    font-weight: 600;
    margin: 18px 0 6px;
  }
  .surface :global(h4) {
    font-family: 'Fraunces', serif;
    font-size: 15.5px;
    font-weight: 600;
    margin: 14px 0 4px;
  }
  .surface :global(p) {
    margin: 0 0 10px;
  }
  .surface :global(ul),
  .surface :global(ol) {
    margin: 0 0 10px;
    padding-left: 22px;
  }
  .surface :global(li) {
    margin-bottom: 4px;
  }
  .surface :global(blockquote) {
    margin: 10px 0;
    padding: 6px 14px;
    border-left: 3px solid var(--accent-ink);
    background: var(--accent-ink-tint-06);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
  }
  .surface :global(a) {
    color: var(--accent-ink);
  }
</style>
