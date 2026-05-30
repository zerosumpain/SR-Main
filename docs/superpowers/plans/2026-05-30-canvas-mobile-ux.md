# Canvas Mobile UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the workflow canvas usable on a phone for inspect / chat / light-edit. Fix pinch-zoom + pan. Convert inspector + chat from desktop side panels to bottom-sheet modals below 768px.

**Architecture:** One reactive `isMobile` boolean (from `matchMedia('(max-width: 768px)')`) + a `.canvas--mobile` CSS class on the page root. Three JS change sites (viewport touch handler, inspector mount, chat mount). Two new components (`MobileBottomSheet`, `MobileCanvasHeader`) + one helper (`useIsMobile`) + one portal action.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Vitest. All work in `~/strange_rambling_svelte/` on `master`.

**Spec:** `docs/superpowers/specs/2026-05-30-canvas-mobile-ux-design.md`.

---

## File map

**Created:**
- `src/lib/canvas/use-mobile.svelte.ts` — `useIsMobile()` reactive accessor
- `src/lib/canvas/portal.ts` — tiny `use:portal` Svelte action
- `src/lib/canvas/MobileBottomSheet.svelte` — generic bottom-sheet wrapper
- `src/lib/canvas/MobileCanvasHeader.svelte` — slim top bar for mobile
- `tests/lib/canvas/use-mobile.test.ts`
- `tests/lib/canvas/MobileBottomSheet.test.ts`
- `tests/lib/canvas/viewport-touch.test.ts` (for the long-press handler fix)

**Modified:**
- `src/routes/jkai/canvas/[slug]/+page.svelte` — gesture fix at line ~2189, conditional mounts for inspector + chat, `.canvas--mobile` class on root

---

## Task 0: Pre-flight

- [ ] **Step 1: Clean tree on master + test baseline**

```bash
cd ~/strange_rambling_svelte
git status
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --reporter=dot 2>&1 | tail -3
```

Expected: clean, on master. Record baseline pass/fail (was 1035/1037 + 2 pre-existing failures last we checked).

---

## Task 1: `useIsMobile` helper + portal action

**Files:** `src/lib/canvas/use-mobile.svelte.ts`, `src/lib/canvas/portal.ts`, `tests/lib/canvas/use-mobile.test.ts`

- [ ] **Step 1: Write `useIsMobile`**

```typescript
// src/lib/canvas/use-mobile.svelte.ts
const MOBILE_BREAKPOINT = '(max-width: 768px)';

/**
 * Returns a getter for an SSR-safe reactive boolean that's true when
 * the viewport matches the mobile breakpoint. Updates on resize /
 * orientation change.
 */
export function useIsMobile(): () => boolean {
  let isMobile = $state(false);
  if (typeof window === 'undefined') return () => false;

  const mq = window.matchMedia(MOBILE_BREAKPOINT);
  isMobile = mq.matches;
  const onChange = (e: MediaQueryListEvent) => { isMobile = e.matches; };
  mq.addEventListener('change', onChange);
  // No cleanup hook — the canvas page lives for the whole route; the
  // listener is GC'd when the page unmounts. Add a teardown if used
  // from a longer-lived consumer.
  return () => isMobile;
}
```

- [ ] **Step 2: Write the portal action**

```typescript
// src/lib/canvas/portal.ts
/**
 * Move the element to document.body on mount; put it back on destroy.
 * Use to escape positioning contexts (transforms, overflow:hidden) so
 * modals/sheets render above everything.
 */
export function portal(node: HTMLElement) {
  const parent = node.parentNode;
  document.body.appendChild(node);
  return {
    destroy() {
      if (parent) parent.appendChild(node);
      else node.remove();
    },
  };
}
```

- [ ] **Step 3: Write test**

```typescript
// tests/lib/canvas/use-mobile.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIsMobile } from '$lib/canvas/use-mobile.svelte';

describe('useIsMobile', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let mockMq: { matches: boolean; addEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    mockMq = {
      matches: false,
      addEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => mockMq) as never;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns false when viewport is above 768px', () => {
    mockMq.matches = false;
    const get = useIsMobile();
    expect(get()).toBe(false);
  });

  it('returns true when viewport matches mobile breakpoint', () => {
    mockMq.matches = true;
    const get = useIsMobile();
    expect(get()).toBe(true);
  });

  it('registers a change listener on the matchMedia query', () => {
    useIsMobile();
    expect(mockMq.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
```

- [ ] **Step 4: Run tests**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/canvas/use-mobile.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: 3 pass. (Note: `$state` outside of a `.svelte` file requires the `.svelte.ts` extension — that's why the filename has it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/use-mobile.svelte.ts src/lib/canvas/portal.ts tests/lib/canvas/use-mobile.test.ts
git commit -m "feat(canvas): useIsMobile reactive helper + portal action"
```

---

## Task 2: `MobileBottomSheet` + tests

**Files:** `src/lib/canvas/MobileBottomSheet.svelte`, `tests/lib/canvas/MobileBottomSheet.test.ts`

Generic bottom-sheet shell. Props per spec: `open`, `onClose`, `title?`, `maxHeightVh?`, `children`. Behaviour: backdrop dim, drag handle at top, swipe-down dismiss (>80px in <300ms), ESC close, body scrolls, keyboard-aware via `visualViewport`, mounted via portal.

- [ ] **Step 1: Write the component**

```svelte
<!-- src/lib/canvas/MobileBottomSheet.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { portal } from './portal';

  interface Props {
    open: boolean;
    onClose: () => void;
    title?: string;
    maxHeightVh?: number;
    children: Snippet;
  }

  let { open, onClose, title, maxHeightVh = 90, children }: Props = $props();

  let dragStartY: number | null = null;
  let dragStartT: number | null = null;
  let dragDeltaY = $state(0);

  function onHandleTouchStart(e: TouchEvent) {
    dragStartY = e.touches[0].clientY;
    dragStartT = performance.now();
    dragDeltaY = 0;
  }
  function onHandleTouchMove(e: TouchEvent) {
    if (dragStartY === null) return;
    const dy = e.touches[0].clientY - dragStartY;
    dragDeltaY = Math.max(0, dy);
  }
  function onHandleTouchEnd() {
    if (dragStartY === null || dragStartT === null) return;
    const elapsed = performance.now() - dragStartT;
    if (dragDeltaY > 80 && elapsed < 300) onClose();
    dragStartY = null;
    dragStartT = null;
    dragDeltaY = 0;
  }

  function onBackdropClick() { onClose(); }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  // Keyboard-aware height. Falls back to maxHeightVh when visualViewport
  // is unavailable (older browsers, SSR).
  let viewportHeight = $state(0);
  $effect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) {
      viewportHeight = window.innerHeight;
      return;
    }
    const update = () => { viewportHeight = vv.height; };
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  });

  // Lock body scroll while open.
  $effect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="sheet-root" use:portal role="presentation">
    <div class="backdrop" onclick={onBackdropClick} role="presentation"></div>
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Bottom sheet'}
      style:max-height="min({maxHeightVh}vh, {viewportHeight || window.innerHeight}px)"
      style:transform="translateY({dragDeltaY}px)"
    >
      <div
        class="handle-zone"
        ontouchstart={onHandleTouchStart}
        ontouchmove={onHandleTouchMove}
        ontouchend={onHandleTouchEnd}
      >
        <div class="handle"></div>
        {#if title}<div class="title">{title}</div>{/if}
      </div>
      <div class="body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .sheet-root {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    animation: fadeIn 200ms ease-out;
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: auto;
    background: var(--nm-surface, #fff);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    animation: slideUp 200ms ease-out;
    overflow: hidden;
  }
  .handle-zone {
    flex: 0 0 auto;
    padding: 8px 16px 12px;
    cursor: grab;
    touch-action: none;
  }
  .handle {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--nm-muted-border, #ccc);
    margin: 0 auto 8px;
  }
  .title {
    text-align: center;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--nm-text, #1a1008);
  }
  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0 16px 16px;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
</style>
```

- [ ] **Step 2: Write tests**

Component tests in this repo are sparse — use a minimal happy-path test via vitest's DOM environment. (Full interaction testing with svelte-testing-library is overkill for this.)

```typescript
// tests/lib/canvas/MobileBottomSheet.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import MobileBottomSheet from '$lib/canvas/MobileBottomSheet.svelte';

describe('MobileBottomSheet', () => {
  it('renders nothing when open is false', () => {
    const target = document.createElement('div');
    const onClose = vi.fn();
    const c = mount(MobileBottomSheet, {
      target,
      props: { open: false, onClose, children: () => 'body' },
    });
    expect(document.querySelector('.sheet-root')).toBeNull();
    unmount(c);
  });

  it('renders the sheet (portalled to body) when open is true', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onClose = vi.fn();
    const c = mount(MobileBottomSheet, {
      target,
      props: { open: true, onClose, title: 'Hello', children: () => 'body' },
    });
    // Sheet portals to body — query the whole document.
    expect(document.querySelector('.sheet')).not.toBeNull();
    expect(document.querySelector('.title')?.textContent).toBe('Hello');
    unmount(c);
    target.remove();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onClose = vi.fn();
    const c = mount(MobileBottomSheet, {
      target,
      props: { open: true, onClose, children: () => 'body' },
    });
    const backdrop = document.querySelector('.backdrop') as HTMLElement;
    backdrop.click();
    expect(onClose).toHaveBeenCalled();
    unmount(c);
    target.remove();
  });
});
```

If component-mount via `mount()` doesn't work in vitest config (no jsdom), the tests can be skipped — the visual smoke test in DevTools is the bar. Don't block on this.

- [ ] **Step 3: Run tests + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/lib/canvas/MobileBottomSheet.test.ts --reporter=verbose 2>&1 | tail -15
git add src/lib/canvas/MobileBottomSheet.svelte tests/lib/canvas/MobileBottomSheet.test.ts
git commit -m "feat(canvas): MobileBottomSheet — bottom-sheet modal wrapper"
```

If the test fails on `mount()` because the vitest environment isn't jsdom for this file, mark the failing assertions as `.todo()` and proceed — visual verification in Task 5 catches issues.

---

## Task 3: Viewport gesture fix

**Files:** `src/routes/jkai/canvas/[slug]/+page.svelte:2189-2228`

Two early returns at the top of `onViewportTouchStart`:
1. Multi-touch (pinch) → don't arm.
2. `isMobile` → don't arm (no add-on-mobile per spec).

- [ ] **Step 1: Read the current handler + locate the right insertion point**

```bash
sed -n '2185,2230p' src/routes/jkai/canvas/[slug]/+page.svelte
```

- [ ] **Step 2: Edit `onViewportTouchStart`**

Use the Edit tool. Insert these two lines after `if (paletteOpen) return;`:

```typescript
    if (e.touches.length > 1) return;  // pinch — let the browser handle it
    if (isMobile) return;              // no add-node UI on mobile (spec)
```

(`isMobile` will be defined in Task 4 when we wire the helper into the page. Leave a tiny TODO if the variable isn't yet in scope — Task 4 connects them, and the immediate `e.touches.length > 1` check still fixes the pinch issue independently.)

For safety on this step alone, you can just add the pinch guard now and add the `isMobile` guard alongside it in Task 4 when the variable exists. Both routes are fine — pick the one that keeps the build green.

- [ ] **Step 3: Quick handler unit test (optional but cheap)**

This is hard to unit test because the handler is inside a `.svelte` component that uses runes. Skip it — the gesture is verified manually in Task 5 via DevTools emulation.

- [ ] **Step 4: Run the build (sanity that the edit didn't break syntax)**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 5: Commit (pinch-only fix as its own commit)**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "fix(canvas): pinch (touches > 1) cancels long-press add-node timer"
```

---

## Task 4: Wire mobile mode into the canvas page

**Files:**
- Create: `src/lib/canvas/MobileCanvasHeader.svelte`
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` — add `isMobile` derived state, conditional mounts of bottom sheets for inspector + chat, mount `MobileCanvasHeader` when mobile, add `.canvas--mobile` class to root, add the `if (isMobile) return;` guard to the touch handler

- [ ] **Step 1: Write `MobileCanvasHeader`**

```svelte
<!-- src/lib/canvas/MobileCanvasHeader.svelte -->
<script lang="ts">
  interface Props {
    workflowName: string;
    onOpenChat: () => void;
    backHref?: string;
  }
  let { workflowName, onOpenChat, backHref = '/jkai' }: Props = $props();
</script>

<header class="mobile-canvas-header">
  <a class="back" href={backHref} aria-label="Back to jkai">←</a>
  <h1 class="name" title={workflowName}>{workflowName}</h1>
  <button class="chat-btn nm-btn-ghost" onclick={onOpenChat}>Chat</button>
</header>

<style>
  .mobile-canvas-header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 48px;
    padding: 0 12px;
    background: var(--nm-surface, #fff);
    border-bottom: 1px solid var(--nm-muted-border, #e0d8d0);
    flex: 0 0 auto;
  }
  .back {
    font-size: 1.4rem;
    line-height: 1;
    padding: 6px 10px;
    text-decoration: none;
    color: var(--nm-text, #1a1008);
  }
  .name {
    flex: 1 1 auto;
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chat-btn {
    flex: 0 0 auto;
    padding: 6px 12px;
    font-size: 0.9rem;
  }
</style>
```

- [ ] **Step 2: Wire `isMobile` into the canvas page**

Find the `<script>` block top of `src/routes/jkai/canvas/[slug]/+page.svelte`. Add:

```typescript
import { useIsMobile } from '$lib/canvas/use-mobile.svelte';
import MobileBottomSheet from '$lib/canvas/MobileBottomSheet.svelte';
import MobileCanvasHeader from '$lib/canvas/MobileCanvasHeader.svelte';

const getIsMobile = useIsMobile();
let isMobile = $derived(getIsMobile());
let mobileChatOpen = $state(false);
```

- [ ] **Step 3: Add the `isMobile` guard to the touch handler**

In `onViewportTouchStart`, add the second guard now that `isMobile` is in scope:

```typescript
function onViewportTouchStart(e: TouchEvent) {
  if (!NEW_PALETTE) return;
  if (paletteOpen) return;
  if (e.touches.length > 1) return;  // (added Task 3 — pinch)
  if (isMobile) return;              // (added now — no add-node on mobile)
  // ... rest unchanged
}
```

- [ ] **Step 4: Add `.canvas--mobile` class to the page root**

Find the page's outermost wrapping `<div>` and bind the class:

```svelte
<div class="canvas-page" class:canvas--mobile={isMobile}>
```

- [ ] **Step 5: Conditionally render the mobile header**

Right inside `.canvas-page`, before the canvas viewport, add:

```svelte
{#if isMobile}
  <MobileCanvasHeader
    workflowName={canvas.workflow.name}
    onOpenChat={() => (mobileChatOpen = true)}
  />
{/if}
```

(Adapt `canvas.workflow.name` to whatever the actual workflow-name binding is — might be `workflow.title` or similar. Read the existing `<h1>` or page-title to see.)

- [ ] **Step 6: Convert inspector mount on mobile**

Find where the inspector body (or right-rail) is currently rendered. Wrap the existing markup in a desktop/mobile conditional:

```svelte
{#if isMobile}
  <MobileBottomSheet
    open={selectedNodeId !== null}
    onClose={() => (selectedNodeId = null)}
    title={selectedNode?.label}
  >
    <!-- existing InspectorBody usage here -->
  </MobileBottomSheet>
{:else}
  <!-- existing desktop right-rail markup unchanged -->
{/if}
```

(`selectedNodeId` / `selectedNode` are likely already in scope — read the existing inspector code to find the exact variable names.)

- [ ] **Step 7: Convert canvas-chat mount on mobile**

Same pattern for the chat panel. Driven by `mobileChatOpen`:

```svelte
{#if isMobile}
  <MobileBottomSheet
    open={mobileChatOpen}
    onClose={() => (mobileChatOpen = false)}
    title="Chat"
  >
    <!-- existing CanvasChat usage here -->
  </MobileBottomSheet>
{:else}
  <!-- existing desktop chat panel unchanged -->
{/if}
```

- [ ] **Step 8: Add mobile CSS for the page root**

In the page's `<style>` block, add:

```css
.canvas-page.canvas--mobile {
  /* Hide the desktop right rail completely */
}
.canvas-page.canvas--mobile :global(.right-rail),
.canvas-page.canvas--mobile :global(.desktop-toolbar) {
  display: none;
}
```

(Class names need to match the actual existing markup. If the right rail has a different class, adapt. The point is: hide whatever desktop-only chrome competes with the canvas viewport on phone.)

- [ ] **Step 9: Typecheck + build**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -3
npm run build 2>&1 | tail -3
```

Expected: 0 typecheck errors, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/lib/canvas/MobileCanvasHeader.svelte src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): mobile mode — header, bottom-sheet inspector + chat, isMobile guard"
```

---

## Task 5: Manual verification + deploy

- [ ] **Step 1: Verify on local dev server (already running on homeserv 5173)**

Restart the homeserv service to pick up the new build:

```bash
systemctl --user restart strange-rambling-svelte.service
sleep 5
systemctl --user is-active strange-rambling-svelte.service
```

Open `http://homeserv:5173/jkai/canvas/<any-workflow-slug>` in Chrome DevTools mobile emulation (iPhone 14 Pro, 390×844). Run through:

1. Two-finger pinch zooms the canvas (palette does NOT open).
2. Single-finger pan moves the viewport (palette does NOT open).
3. Tap a node → bottom sheet slides up with inspector content. Swipe-down on the handle → sheet dismisses.
4. Tap "Chat" button in the mobile header → chat sheet opens. Focus a chat input → keyboard appears, sheet stays usable.
5. Resize to desktop width → mobile header disappears, right rail returns.

If any step fails, fix inline and re-build.

- [ ] **Step 2: Deploy to VPS**

```bash
cd ~/strange_rambling_svelte
./scripts/deploy.sh 2>&1 | tail -3
```

Expected: "Deployed successfully to https://strangeramblings.com".

- [ ] **Step 3: Verify on real phone**

Open `https://strangeramblings.com/jkai/canvas/<slug>` on John's phone. Same checklist as Step 1. Report any issues for follow-up.

- [ ] **Step 4: Push**

```bash
git push origin master
```

(Push may already have happened earlier — confirm with `git status`.)

Phase 1 of canvas mobile UX is complete.
