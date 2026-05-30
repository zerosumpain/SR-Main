# Canvas mobile UX — design

**Status:** approved (autonomous implementation authorised)
**Date:** 2026-05-30
**Author:** John Kelly (with Claude)

## Summary

Make the workflow canvas usable on a phone for three modes — **inspect a
workflow**, **chat with the orchestrator**, **light-edit a single node's
config**. Drop DAG authoring as a mobile goal entirely. Fix the touch
gesture conflict that opens the node-add palette when the user tries to
pinch-zoom or pan, and convert the inspector + canvas chat from
desktop-style side panels to bottom-sheet modals below a single mobile
breakpoint.

No new routes, no parallel components. One CSS class + a tiny `isMobile`
boolean enabled at `max-width: 768px` flip the same component tree into
mobile shape.

## Out of scope

- DAG authoring (add/remove nodes, draw edges) on mobile. The existing
  toolbar add-node UI stays accessible above the breakpoint; below it
  the long-press-to-add gesture is disabled but no replacement UI is
  added. Users wanting to author go to desktop.
- Mobile-specific node panels. Each emitted/handwritten node panel stays
  as it is — only the *container* swaps from side-panel to bottom-sheet.
- Tablet treatment. Tablets (>768px) get the desktop layout. If this is
  wrong for John in practice, the breakpoint is one number to change.
- iOS/Android native apps. Web responsive only.

## Pain points being fixed

1. **Long-press-to-add-node fires during pan/pinch.** The current
   `onViewportTouchStart` handler at
   `src/routes/jkai/canvas/[slug]/+page.svelte:2189` arms a 450ms
   timer on every single-finger touch on empty canvas. It only cancels
   on >10px movement and does not check `e.touches.length`. Result:
   any pinch-zoom or slow pan opens the node palette.

2. **Inspector + chat panels are not mobile-shaped.** Desktop side
   panels overlap the DAG on phone widths, scroll badly, and the
   keyboard covers them. John wants them as bottom-sheet modals.

3. **Pinch-zoom doesn't work.** Same root cause as #1 — the long-press
   handler intercepts the touch before the browser's native pinch can
   take over.

## Architecture

**One breakpoint.** `@media (max-width: 768px)` adds a `.canvas--mobile`
class to the canvas page's root element. A reactive `isMobile` derived
state (from `window.matchMedia('(max-width: 768px)')`) drives the few JS
branches.

**Three change sites.** The boolean only matters in three places:

1. The viewport touch handler (`onViewportTouchStart`) — early-return
   when `isMobile` so the palette never opens on mobile, and add a
   `touches.length > 1` early-return so any multi-touch (pinch)
   cancels the long-press on desktop too (defence in depth — fixes
   the same bug for tablets / desktop touchscreens).

2. The inspector mount — on mobile, render inside a new
   `<MobileBottomSheet>` instead of inline in the right rail. The
   inspector body component is unchanged.

3. The canvas-chat mount — same pattern: on mobile, render inside
   `<MobileBottomSheet>` triggered by a mobile-header "Chat" button,
   instead of the always-visible right-rail chat panel.

**New component:** `src/lib/canvas/MobileBottomSheet.svelte`. Generic
bottom-sheet shell. Used by both the inspector and the chat.

**New component:** `src/lib/canvas/MobileCanvasHeader.svelte`. Slim
top bar visible only when `isMobile`. Workflow name (truncated) on the
left, back link to `/jkai` and "Chat" button on the right.

## Components

### `MobileBottomSheet.svelte`

Generic bottom-sheet wrapper around any child content. Used by both
the inspector and the chat. Props:

```typescript
interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;          // shown next to the drag handle
  maxHeightVh?: number;    // default 90
  children: Snippet;
}
```

Behaviour:

- Slides up from the bottom with a 200ms `ease-out` transform.
- Drag handle bar at the top (32px tall touch target).
- Backdrop dims the canvas (rgba(0,0,0,0.4)). Tap backdrop → `onClose`.
- Swipe-down on the handle (>80px in <300ms) → `onClose`.
- ESC key when open → `onClose` (for completeness; doesn't matter
  on mobile but cheap).
- Body region scrolls (`overflow-y: auto`) so long inspector content
  (e.g. a node panel with many fields) doesn't overflow the screen.
- Keyboard-aware: uses `window.visualViewport.height` to set the sheet
  height when an input is focused so the iOS keyboard doesn't cover the
  active field. Falls back gracefully if `visualViewport` is unsupported.
- Inert + aria-modal: when open, the rest of the page is `inert` and
  the sheet has `role="dialog"` + `aria-modal="true"`.
- Mounted at the document body via a `use:portal` action so it escapes
  any positioning contexts of the canvas viewport (Svelte 5 has no
  built-in portal; trivial 10-line action).

No props for variant (always full-width). The "half height" vs "full
height" distinction is handled by content height + the `maxHeightVh`
cap, not by a separate mode.

### `MobileCanvasHeader.svelte`

Visible only when `isMobile`. Renders:

- Left: `←` back button (linked to `/jkai` — the chat hub).
- Middle: workflow name, truncated with ellipsis on overflow.
- Right: "Chat" button (opens chat sheet). Optional unread-count badge
  if there are pending tool-step events the user hasn't seen — can
  defer to a follow-up if too much work.

Slim (48px tall), warm-brutalist styling per the SR design tokens
(`.nm-sec`, `.nm-btn-ghost`).

### Viewport gesture handler changes

Edit `src/routes/jkai/canvas/[slug]/+page.svelte:onViewportTouchStart`
to add at the top of the function:

```typescript
if (e.touches.length > 1) return;  // pinch — don't arm
if (isMobile) return;              // no add-on-mobile (out of scope)
```

This is the only JS change to the gesture system. Pinch-zoom + pan
work natively because the long-press timer never arms on mobile.

### Mount-point conditionals

The inspector and chat are currently rendered inline in the canvas
page's main layout grid. Change to:

```svelte
{#if isMobile}
  <MobileBottomSheet open={selectedNodeId !== null} onClose={() => selectedNodeId = null} title={selectedNode?.label}>
    <InspectorBody … />
  </MobileBottomSheet>
  <MobileBottomSheet open={chatOpen} onClose={() => chatOpen = false} title="Chat">
    <CanvasChat … />
  </MobileBottomSheet>
{:else}
  <!-- existing desktop right-rail markup unchanged -->
{/if}
```

`chatOpen` is a new local `$state` flag, false by default on mobile.
The header's Chat button toggles it.

## Activation + the isMobile signal

A small helper module: `src/lib/canvas/use-mobile.svelte.ts` exporting
a `useIsMobile()` reactive accessor that wraps
`window.matchMedia('(max-width: 768px)')`. Updates reactively on
viewport resize (orientation change). Safe in SSR (returns `false`).

```typescript
export function useIsMobile() {
  let isMobile = $state(false);
  if (typeof window === 'undefined') return () => false;

  const mq = window.matchMedia('(max-width: 768px)');
  isMobile = mq.matches;
  mq.addEventListener('change', (e) => { isMobile = e.matches; });
  return () => isMobile;
}
```

Used from the canvas page like:

```typescript
const getIsMobile = useIsMobile();
let isMobile = $derived(getIsMobile());
```

## CSS

Add a `.canvas--mobile` class to the root `<div>` of the canvas page
bound to `isMobile`. Use it for layout reflow — chiefly hiding the
desktop right-rail, hiding the desktop top toolbar (if any), showing
the `MobileCanvasHeader`, and ensuring the canvas viewport fills the
remaining space.

Avoid `@media` queries duplicating the JS breakpoint where possible.
Where we DO need media queries (e.g. a CSS-only element that has no
matching JS condition), use the same `768px` boundary verbatim.

## Testing

- **Manual via Chrome DevTools mobile emulation.** Acceptance scenarios:
  1. Toggle device mode → iPhone 14 Pro (390×844). Canvas renders
     with mobile header at top, no right rail.
  2. Two-finger pinch in the viewport → zooms, palette does not open.
  3. Single-finger pan → pans, palette does not open.
  4. Tap a node → bottom sheet slides up with that node's config.
     Swipe down on the handle → sheet dismisses.
  5. Tap the "Chat" button in the header → chat sheet opens. Focus
     an input → keyboard appears, sheet content stays visible.
  6. Resize back to desktop → mobile header disappears, right rail
     re-mounts, no orphan sheets, selection state preserved.
- **Unit tests** for `MobileBottomSheet`: open/close transitions,
  backdrop-click closes, drag-down dismisses, ESC closes, body
  scrolls when content overflows.
- **Unit test** for the viewport handler: assert long-press timer
  is NOT armed when `e.touches.length > 1` or when `isMobile`.
- No Playwright / mobile-device end-to-end. DevTools emulation is
  the bar.

## Phased delivery

This is small enough for a single phase, but split into four atomic
commits so each is independently revertible:

1. **`useIsMobile` helper + tests.** Pure module, no consumers yet.
2. **`MobileBottomSheet` + tests.** Standalone component, not wired in.
3. **Viewport gesture fix.** The two early-returns; tests for the
   handler.
4. **Wire mobile mode into the canvas page.** `MobileCanvasHeader`,
   conditional mounts of the bottom sheets, the `.canvas--mobile`
   CSS. End-to-end mobile mode now active.

After step 4, deploy and verify in Chrome DevTools emulation.

## Open questions (deferred, not blockers)

- **Unread-message badge on the Chat button.** Nice but not strictly
  needed. Can ship without it and add later.
- **Sheet stacking** if the user has both inspector and chat open
  simultaneously. Resolution: closing one auto-closes the other.
  At any moment, at most one sheet is open. Simpler than stacking.
- **Tablet breakpoint review.** If 768px catches iPads in mobile mode
  and that's wrong, revisit with a second breakpoint at 1024px. Defer
  until John reports.
