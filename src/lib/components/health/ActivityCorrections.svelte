<script module lang="ts">
  /** The fields a correction reads and writes. Both the list row and the
   *  detail record satisfy it. */
  export interface CorrectableActivity {
    id: string;
    name: string;
    /** The owner's correction where there is one — see effectiveType(). */
    activityType: string;
    /** What the source called it, so the correction reads as a change. */
    sourceType: string;
    typeOverride: string | null;
    excludedFromSegments: boolean;
  }
</script>

<script lang="ts">
  // The `···` corrections menu — exclude an outing from segment analysis, or
  // correct the type the phone reported.
  //
  // The activity table has its own copy of this panel inline, because there the
  // menu shares one open-panel slot with the column filter panel and cannot own
  // its own state. This component is the standalone version, for a page where
  // the menu is the only panel there is.
  import { invalidateAll } from '$app/navigation';
  import {
    placePopover,
    POP_WIDTH,
    POP_EST_HEIGHT,
    type PopoverPlacement,
  } from '$lib/health/popover';
  import { ACTIVITY_TYPES } from '$lib/trails/activity-meta';
  import { activityLabel } from '$lib/trails/format';

  let {
    activity,
    label = 'Actions',
  }: { activity: CorrectableActivity; label?: string } = $props();

  let open = $state(false);
  let pos = $state<PopoverPlacement | null>(null);
  let saving = $state(false);
  let note = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Plain `let`, not `$state`: only event handlers read these, and an $effect
  // that measured the panel it also positions would loop until
  // effect_update_depth_exceeded.
  let anchorEl: HTMLElement | null = null;
  let panelEl: HTMLElement | null = null;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

  /**
   * The panel's natural height. `offsetHeight` reads back the `max-height` the
   * last placement set, so a clipped panel would measure as one that fitted.
   */
  function naturalHeight(node: HTMLElement): number {
    return Math.max(node.offsetHeight, node.scrollHeight + 2);
  }

  /** Follow the trigger. Called from scroll and resize, never from an effect. */
  function reposition() {
    if (!open || !anchorEl || !anchorEl.isConnected) return;
    pos = placePopover(
      anchorEl.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { align: 'end', height: panelEl ? naturalHeight(panelEl) : POP_EST_HEIGHT },
    );
  }

  /** Re-place the panel now its real height can be measured, then focus it. */
  function panelMount(node: HTMLElement) {
    panelEl = node;
    reposition();
    node.focus({ preventScroll: true });
    return {
      destroy() {
        if (panelEl === node) panelEl = null;
      },
    };
  }

  function trapTab(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !panelEl) return;
    const items = [...panelEl.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelEl)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Hand focus back to the trigger, but only when the closing panel holds it. */
  function close() {
    if (!open) return;
    const active = document.activeElement;
    if (anchorEl && active !== anchorEl && active instanceof Node && panelEl?.contains(active)) {
      anchorEl.focus();
    }
    open = false;
  }

  function toggle(event: MouseEvent) {
    if (open) {
      close();
      return;
    }
    anchorEl = event.currentTarget as HTMLElement;
    // The old panel is on its way out; measuring it would place the new one.
    panelEl = null;
    note = null;
    pos = placePopover(
      anchorEl.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { align: 'end', height: POP_EST_HEIGHT },
    );
    open = true;
  }

  function onWindowPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // A pointer user does not need focus handed back — the click they are
    // making moves it — so this path closes without restoring.
    if (!target.closest('[data-activity-corrections]')) open = false;
  }

  function onWindowKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') close();
  }

  async function patch(body: { excludedFromSegments?: boolean; typeOverride?: string | null }) {
    if (saving) return;
    saving = true;
    note = null;
    try {
      const res = await fetch(`/api/trails/activities/${encodeURIComponent(activity.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        effortsRemoved?: number;
      } | null;

      if (!res.ok) {
        note = { kind: 'error', text: payload?.error ?? `Update refused (${res.status}).` };
        return;
      }

      const cleared =
        typeof payload?.effortsRemoved === 'number'
          ? `, ${payload.effortsRemoved} effort${payload.effortsRemoved === 1 ? '' : 's'} cleared`
          : '';
      note = { kind: 'ok', text: `Saved${cleared}.` };
      // A correction clears this outing's segment efforts, so the segments
      // section, the physiology and the highlights are all now stale. Re-run
      // the load rather than patching one field and leaving the rest lying.
      await invalidateAll();
    } catch (err) {
      note = { kind: 'error', text: (err as Error)?.message ?? 'Update failed.' };
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeyDown} onscroll={reposition} onresize={reposition} />

<button
  type="button"
  class="menu-btn"
  data-activity-corrections
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label="{label} for {activity.name}"
  onclick={toggle}
>
  ···
</button>

{#if open && pos}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="pop"
    data-activity-corrections
    role="dialog"
    aria-modal="true"
    aria-label="Corrections for {activity.name}"
    tabindex="-1"
    use:panelMount
    onkeydown={trapTab}
    style="left: {pos.left}px; top: {pos.top}px; width: {POP_WIDTH}px; max-height: {pos.maxHeight}px"
  >
    <div class="pop-hd">
      <span class="sr-label-tight">Correct this recording</span>
      <button type="button" class="pop-x" aria-label="Close" onclick={close}>×</button>
    </div>

    <button
      type="button"
      class="pop-btn wide"
      disabled={saving}
      onclick={() => patch({ excludedFromSegments: !activity.excludedFromSegments })}
    >
      {activity.excludedFromSegments
        ? 'Put back into segment analysis'
        : 'Exclude from segment analysis'}
    </button>

    <label class="field">
      <span class="sr-label-tight">Correct type — now {activityLabel(activity.activityType)}</span>
      <select
        value={activity.typeOverride ?? ''}
        disabled={saving}
        onchange={(event) => patch({ typeOverride: event.currentTarget.value || null })}
      >
        <option value="">No correction — source says {activityLabel(activity.sourceType)}</option>
        {#each ACTIVITY_TYPES as type (type)}
          <option value={type}>{activityLabel(type)}</option>
        {/each}
      </select>
    </label>

    {#if saving}
      <p class="pop-note">Saving…</p>
    {:else if note}
      <p class="pop-note" class:err={note.kind === 'error'}>{note.text}</p>
    {:else}
      <p class="pop-hint">
        Both corrections clear this outing's segment efforts and schedule a rebuild. Neither
        touches what the phone sent, so the next sync cannot undo them.
      </p>
    {/if}
  </div>
{/if}

<style>
  .menu-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    padding: 0.25rem 0.4rem;
    color: var(--text-muted);
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .menu-btn:hover,
  .menu-btn[aria-expanded='true'] {
    color: var(--accent);
    border-color: var(--accent);
  }
  .menu-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* Fixed, not absolute: `left`, `top` and `max-height` all come from
     placePopover, which is what keeps the panel on screen; there is no static
     fallback to disagree with. */
  .pop {
    position: fixed;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    background: var(--surface-card);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    overflow-y: auto;
  }
  /* The panel takes focus on open, so it has to show it. */
  .pop:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .pop-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .pop-x {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    padding: 0.15rem 0.35rem;
    color: var(--text-muted);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .pop-x:hover {
    color: var(--accent);
  }
  .pop-hint,
  .pop-note {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .pop-note {
    color: var(--accent-ink);
  }
  .pop-note.err {
    color: var(--error);
  }
  .pop-btn {
    flex: 1 1 auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.4rem 0.5rem;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--line-strong);
    cursor: pointer;
    text-align: center;
  }
  .pop-btn.wide {
    flex: 1 1 100%;
  }
  .pop-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .pop-btn:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .pop-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .field select {
    /* 16px or mobile Safari zooms the viewport on focus. */
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 0.3rem 0.4rem;
    min-width: 0;
    width: 100%;
  }
  .field select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
