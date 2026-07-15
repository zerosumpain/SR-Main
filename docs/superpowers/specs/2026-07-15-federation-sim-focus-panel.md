# Federation sim — Focus panel (remove nodes by cluster group)

**Route:** `/projects/data-spine/federation/sim` (standalone `<FederationSim standalone />`)
**Kick-off:** "I want a panel (that starts collapsed) that allows me to remove nodes from the diagram … by type — schools, LAs, etc. cluster groups to toggle in a way that makes sense considering the scenarios. Unobtrusive but let a user focus on a very specific demonstration." — autonomous, Full grade.

## Goal
A collapsed-by-default, unobtrusive on-canvas panel that toggles the visibility of the sim's meaningful clusters, so a presenter can strip the scene down to exactly the entities a given scenario/join argues about.

## Cluster groups (chosen to mirror how scenarios use the network)
The sim's node kinds already form conceptual clusters. Groups, all visible by default:

**Estates — where data lives**
- **Schools** — 22k school point-field + MIS supplier gateways + stems (`kind:'supplier'` + `schools` field)
- **Local authorities** — LA case systems (`kind:'la'`, `sector:'la'`) + the 153-LA point field
- **Cross-sector** — health/CAMHS + destinations/earnings (`kind:'la'`, `sector:'cross'`)
- **DfE stores** — NPD/LEO/ILR/LDS (`kind:'store'`)

**The exchange — the middle + who asks**
- **Consumers** — DfE, LAs, CSC, TRE, Ofsted, cross-gov (`kind:'consumer'`)
- **Spine registries** — identity resolver + record-locator/consent/policy registries + hub platform (`kind:'resolver'|'registry'`)
- **Exchange & ledger** — the relay ring + torus + audit-ledger obelisk (`kind:'relay'|'ledger'`)

Rings (**Apps** / **Brokers**) and the **Central store** counterfactual are already toggled by the existing top-bar segments; the panel points at those rather than duplicating them.

**Presets** (one click to a common demonstration): **All** · **Estates only** · **The spine**.

## Files to touch
1. `src/lib/sim/federation/scene.ts` — add `FocusGroup` type + `setGroupVisible(group,on)` to `SceneHandle`. Toggles each group's meshes/labels (traverse-set-visible, per the `setEdtech` precedent), the school/LA point fields, spine-hub + ring decorations, and rebuilds the batched member/ring/satellite edge geometry so no connector dangles to a hidden node.
2. `src/lib/sim/federation/FederationSim.svelte` — `focus` visibility record + `focusOpen` state, `FOCUS_GROUPS` metadata, toggle/preset handlers, a "◱ Focus" top-bar button (lit + count when filtering) and a collapsible popover panel; SR-design tokens, opaque paper bg, offsets from `--hud-top`.

## Verification
- `npm run check` — 0 new errors.
- Dev server (non-default port to avoid clobbering the always-on 5173 service) + SwiftShader Playwright screenshot of `/projects/data-spine/federation/sim`: open panel, toggle Schools off → 22k dots + gateways vanish, edges to them drop; toggle back → return; preset "The spine" → only the central trust core remains.
- Existing 58 vitest green (scene has no unit tests; topology/engine/joins untouched).
- Deploy via `scripts/deploy.sh`; verify-live by grepping the deployed JS bundle for a new string (private page 404s to anon).

## Decision Log
- **Placement — top-bar button + left-anchored popover** vs a permanent corner rail. Chose the button+popover: corners are already occupied (info-tl/counters/lograil/inspector) and the brief wants "unobtrusive, collapsed by default." Popover overlaps the top-left legend only while open. *Reversible.*
- **Grouping granularity — 7 conceptual clusters** vs per-node or per-MIS-vendor toggles. Chose the 7 clusters: they match the scenario/join mental model ("schools, LAs, etc.") without a wall of checkboxes. Per-vendor could come later. *Reversible.*
- **Rings excluded from the panel** (kept on the existing Off/Apps/Brokers segment) to avoid two sources of truth for edtech/aggregator visibility. Panel carries a one-line pointer. *Reversible.*
- **Edges rebuilt on toggle** (member/ring/satellite) rather than left dangling. Batched geometry is ~55 segments; a rebuild on each rare toggle is trivial and avoids lines to nowhere. Central edges (opacity-0 except central mode) left untouched. *Reversible.*
- **Ledger grouped under "Exchange & ledger"** (its physical ring-centre home) not under Spine registries. *Reversible.*
- **Presets kept to 3** (All/Estates/Spine) — unambiguous, low-risk; skipped a "join" preset whose edge-routing visibility is fiddly. *Reversible.*
