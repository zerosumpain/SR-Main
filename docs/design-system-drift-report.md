# Strange Ramblings — Design-System Drift Report

> Generated 2026-06-20 from an 11-surface, adversarially-verified audit of the live site
> against the uploaded design-system handoff (`colors_and_type.css` = source of truth).
> ~201 verified findings across 11 lanes (~42 high-severity); 7 auditor findings removed as false positives.

## Executive summary

The site is broadly faithful to the warm-brutalist contract — palette, surfaces, dividers, accent tints, and the live-dot pulse are correctly tokenised across most chrome — but it carries one strategic divergence and a consistent cluster of spine violations that span every lane. The single biggest item is the **display font**: `src/app.css:53` ships `--font-display: 'Archivo Black'` (with the matching `@import` on line 2), so every hero, `h1/h2/h3`, big numeral and `.display` renders in a heavy condensed sans, whereas the canonical `colors_and_type.css` + brief §4 mandate **Zilla Slab** editorial slab-serif at weight 700 mixed-case. The recurring spine violations are: **box-shadows used as elevation** (sanctioned `--shadow-*` tokens at app.css:79-82 plus ~190 raw inline shadows site-wide), **a literal blue `--info: #2d6cdf`** (app.css:44) that propagates into admin banners/pills and the legal A/B/C hierarchy, **off-scale "SaaS-middle" radii** (5/6/7/8/9/10/12/14px where only 0/2/4/100 are allowed — hundreds of declarations, heaviest in the project Field Studies), **the missing `--accent-ink` counter-accent family** (entirely absent from `:root`, which is partly why the blues persist — there is no token for a non-orange accent), the **stale v2 type scale** (xl 120 vs v3 132, label 11 vs 12), and a banned **`--ease-spring`** curve. The Field Studies (policy-engine, dfe-data-strategy, dfe-data-estate, data-convergence) are the largest single concentration of drift: all four build chrome on a private `--paper/--ink` palette that never references `app.css`, ship the off-contract **Fraunces** serif, and hard-code a literal blue `#2f6f97` ~198 times. **broads-pilot** reads as a consumer app — full-colour emoji throughout primary chrome, rem-based rounded radii, and drop-shadow elevation on every floating surface.

## Top alignment opportunities (ranked by leverage)

1. **Add the `--accent-ink` counter-accent family to `app.css` and retire the blue `--info`.** *What:* insert `--accent-ink:#0e5b66` (+`-hover #094850`, tints .06/.12/.22/.35) into `:root`, then repoint `--info`/`--info-bg`/`--info-border` at it. *Why:* `--info: #2d6cdf` is a literal blue (non-negotiable #1) and there is currently **no token at all** for a sanctioned non-orange accent, which is the root reason blues keep reappearing. *Effort:* small foundation edit, but it is a **prerequisite** that unblocks ~10 downstream no-blues swaps. *Clears/unblocks:* the `--info` finding + admin.css banner/pill + pulse layer cards + the legal/portal/brief/validate `--info` usages + several canvas/intel blue reroutes (≈ 12 findings depend on it).
2. **Migrate the display font Archivo Black → Zilla Slab.** *What:* swap `--font-display` (app.css:53), change the `@import` (app.css:2) to load the full Zilla Slab axis set, and rework `.display` (app.css:136-142) from weight 900 + forced uppercase to 700 mixed-case, adding the missing `.display--upper` / `.display--italic` modifiers. *Why:* it is the single biggest visual-character drift and the contract is unambiguous (the stale `design-guide.md` prose loses to the canonical CSS). *Effort:* small code change, large visual surface → needs a design sign-off. *Clears:* the foundation findings plus every downstream `font-weight:900 + text-transform:uppercase` heading override (ProseContent, blog post-title/drop-cap, blog hero, MarkdownEditor/RichEditor preview+body, health Hero) — ~10 findings collapse into one coordinated migration.
3. **Remove the `--shadow-*` elevation tokens and sweep their consumers, then the raw-shadow tail.** *What:* delete `--shadow-sm/md/lg` (app.css:79-82); fix the 7 token consumers; then a broader sweep of ~184 raw inline `box-shadow` elevations (modals, dropdowns, FABs, cards). *Why:* non-negotiable #3 — depth is borders + bg tints; only `--accent-glow` is sanctioned. *Effort:* medium (token removal mechanical; raw-shadow sweep is large but pattern-repetitive). *Clears:* every borders·radius·shadow elevation finding across all lanes (~30+).
4. **Normalise all off-scale radii to {0, 2px, 4px, 100px}.** *What:* find-replace 3/5/6/7/8/9/10/11/12/14/20/24px and `rounded-lg`/`rounded-full`/`999px`/`0.5rem` etc. to `var(--radius-sharp)`/`var(--radius-round)`/`var(--radius-pill)`/`0`. *Why:* non-negotiable #4. *Effort:* mostly mechanical, very high volume (≈300 off-scale declarations in policy-engine alone). *Clears:* ~35 findings, the single most numerous drift.
5. **Bump the type scale to v3.** *What:* in `app.css:60-70` set display xl/lg/md/sm/xs to 132/104/72/36/22 and label/label-xs/nav to 12/11/13 (body already correct). *Why:* live ships the old smaller set; the contract bumped it. *Effort:* trivial token swap. *Clears:* the foundation scale finding + the hero clamp cap (LandingHero:51) + the mono eyebrow + the v3-dependent label tracking.
6. **Replace all emoji with hand-drawn 20×20 inline SVG (or unicode-as-type).** *What:* remove pictographic emoji from BlogAssistant FAB, ChatArea hero chips, ConversationSidebar, intel typeIcons/sourceIcon (3 files), canvas heal banner, OpenAsWebpageButton, broads-pilot chrome + its guide data, and the policy-engine flag emoji. *Why:* non-negotiable #5 (absolute). *Effort:* medium (needs real SVG icons), structural. *Clears:* ~12 iconography findings; biggest single driver of broads-pilot's "consumer app" feel.
7. **Refactor the Field Studies onto the global tokens.** *What:* delete the bespoke `--paper/--paper-deep/--ink/--ink-soft` quartet (duplicated in 4 apps), drop Fraunces for `var(--font-display)`/`var(--font-brand)`, and reroute the literal blue `#2f6f97` (~198 occurrences) + teal `#3f7d6e` + rose `#b1455e` to `var(--accent-ink)`/`var(--accent)`/`var(--error)`. *Why:* these apps never inherit global token changes — they parallel the system instead of consuming it. *Effort:* large, partly judgment (how much bespoke divergence is allowed). *Clears:* the entire Field Studies A lane root cause + most of its colour/typography findings.
8. **Swap token-equivalent status literals to `var(--error)`/`var(--success)`/`var(--warn)`.** *What:* replace `#c44`/`#2d7a3a`/`#4a9`/`#2e7d32`/`#c62828`/`#10b981`/`#b54242`/`#ef4444` etc. with the status tokens (many are byte-identical, several are off-value duplicates). *Why:* consolidation so a palette change propagates. *Effort:* mechanical, high volume. *Clears:* ~25 low/medium colour findings across admin, jkai, broads-pilot.

---

## Drift by category

### Color

**Foundation**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| src/app.css:44-46 | `--info: #2d6cdf` (+ bg/border blue) | `--info: var(--accent-ink)` (+ ink tints) | token-swap | high |
| src/app.css:30-35 (missing) | no `--accent-ink` tokens exist | add `--accent-ink:#0e5b66` +hover +tints .06/.12/.22/.35 | token-swap | medium |
| src/routes/admin/admin.css:239 | `.nm-link-btn.danger:hover{ color:#a33 }` | `var(--error)` (or shared error-hover token) | token-swap | low |
| src/lib/styles/nm-tokens.css:25-26 | `rgba(196,68,68,...)` error red literal | `var(--error-bg)` / `var(--error-border)` | token-swap | low |

**Home / hero / landing / biome**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| LiveWalkBanner.svelte:70-71,82-83 | `rgba(196,87,10,.08/.20/.14/.35)` | `var(--accent-tint-08/20/14/35)` | token-swap | medium |
| LiveWalkBanner.svelte:73,108,113 | grey/cool fallbacks `#e8eaf0`/`#555`/`#999` | `var(--text-primary/ghost/secondary)` no fallback | token-swap | medium |
| +page.svelte:264,271 | `rgba(26,16,8,0.05)` / `color-mix accent 15%` | `var(--surface-overlay)` / `var(--accent-tint-14)` | token-swap | low |

**Blog**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| BlogAssistantWidget.svelte:371 | `var(--bg-card, var(--bg-page, #fff))` → renders #fff | `var(--surface-elevated)` | token-swap | high |
| BlogAssistantMarginCallouts.svelte:236,263,290,305 | `var(--bg-card,#fff)` → #fff | `var(--surface-elevated)` | token-swap | high |
| BlogAssistantMarginCallouts.svelte:248,252,300 | `rgba(255,184,0,...)` amber | `var(--accent)` / `var(--accent-tint-35)` | token-swap | high |
| BlogAssistantWidget.svelte:392,465 | `var(--danger,#c33)`, `var(--accent,#888)` | `var(--error)`, `var(--accent)` (drop greys; --danger undefined) | token-swap | med/low |
| BlogAssistantMarginCallouts.svelte:271,273 | `rgba(34,139,34,...)` forest green | `var(--success)` / `var(--success-bg)` | token-swap | medium |
| RichEditor.svelte:731,743,744 | marker-pen `rgba(255,217,64/184,0)` | `var(--accent-tint-25/35)` + `var(--accent)` outline | token-swap | medium |
| MarkdownEditor.svelte:335,527,532,722 · RichEditor.svelte:667,718 | `rgba(255,255,255,.02–.1)` white-on-cream (invisible) | `var(--accent-tint-08/14)` / `var(--bg-section)` / `var(--surface-overlay)` | token-swap | medium |
| MarkdownEditor.svelte:711,715 · RichEditor.svelte:711,712 | `#4a9` teal / `#c44` | `var(--success)` / `var(--error)` | token-swap | medium |
| blog/+page.svelte:268 · blog/tag/[tag]/+page.svelte:33 | hard-coded `rgba(196,87,10,0.04)` hover | `var(--accent-tint-04)` | token-swap | low |

**Health / Heart / Live**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| live/+page.svelte:94 | `fillColor:'#4285f4'` map marker (Material blue) | resolved `--accent` via getComputedStyle | token-swap | high |
| live/+page.svelte:298 | `rgba(255,255,255,0.06)` progress track (invisible) | `var(--card-bg)` / `var(--divider)` | token-swap | high |
| health/v2/Hero.svelte:330,351 · Breakdown.svelte:389-391 | `#8a3a08` "bad/down" + `rgba(138,58,8,.4)` | `var(--accent-hover)` (or new trend-down token) | token-swap | medium |
| heart/{,1/,2/}+page.svelte (128/142/115) · heart/1:123, heart/2:106 | `rgba(26,16,8,0.08)` divider; cycle-bar bg | `var(--divider)` | token-swap | low |
| health/v2/{Narrative:21,Breakdown:359,EvidenceChip→.ev-chip:29} | `rgba(26,16,8,0.04)` bg | `var(--bg-section)` | token-swap | low |
| live/+page.svelte:231 · health/+page.svelte:270 | hard-coded live-dot glow | `var(--accent-glow)` | token-swap | low |
| EpicActivities.svelte:406-407,413 | Leaflet attribution `#444` grey | `var(--text-muted/secondary)` + warm bg | token-swap | low |

**JKAI hub chrome**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| MetricsStrip.svelte:73 | `.run-active{ color:#569cd6 }` (blue) | `var(--accent)` | token-swap | high |
| ChatArea.svelte:2051,2103 | `var(--accent-tint-10, rgba(52,152,219,.12))` → blue (tint-10 undefined) | `var(--accent-tint-08)` | token-swap | high |
| MetricsStrip.svelte:76 · ChatArea.svelte:2014,2112,2124 · ChatModelToggle:130 · ChatMessage:288 · BuildFailureBanner:85/90/168 | one-off reds `#b43232`/`#c0392b`/`#b54242`/`#c44`/`#b94b4b` | `var(--error)` | token-swap | low-med |
| ChatArea.svelte:1945 · ComposerAttachmentTray:52 · BuildPill:151 | blue fallbacks `#3498db`/`#60a5fa` on undefined vars | drop fallback → `var(--accent)` | token-swap | medium |
| BuildPill.svelte:56-61,123-124 | undefined `--color-emerald/cyan` → `#06b6d4` etc.; white veils | `var(--success/error/warn/accent)`, `var(--card-border/surface-elevated)` | token-swap | medium |
| ConversationSidebar:228 · ChatMessage:214,222,266-267 · ThinkingTimeline:53,63,78,67 | `rgba(0,0,0,.05–.15)` black tints + Tailwind amber/red | warm `var(--surface-overlay/bg-section)` + `var(--warn/error)` | token-swap | low |
| QueuedMessageBadge:15 · OfflineBanner:29-31 · DraftsPanel:103 | undefined `--nm-*` → greys `#666`/`#d6cfc4`/`#0a0a0a` | `var(--text-muted)`/`var(--divider)`/`var(--text-primary)` | token-swap | low-med |
| ChatModelToggle/PushOptInCard/PromoteToolBanner/SlashCommandButtonBar/ClarifyCard(+ConfirmBanner+PlanCard) | `#b00`/`#b54242`/`rgba(194,91,91,.08)` | `var(--error)` / `var(--error-bg)` | token-swap | low |
| ConversationSidebar:164,283 | WhatsApp `#25d366` green (3 literals) | tokenise as `--wa-green` or dot→`var(--accent)` | judgment | low |

**JKAI sub-surfaces**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| canvas/[slug]/+page.svelte:7178-7217 | `#1a73e8` blue node-status dot/pill/ring/pulse (+green/red/amber hex) | `var(--accent-ink)` (running ring → `var(--accent)`); status → `--success/error/warn` | token-swap | high |
| intel/alerts/+page.svelte:9-11,51 | `#2563eb`/`#1d4ed8`/`border-blue-500` filter pills | `var(--accent-ink)` family (high/med → `--error`/`--warn`) | token-swap | high |
| builds/BuildsListV2.svelte:715-716,737 | `#5b8def` Hermes-origin rail/flag | `var(--accent-ink)` | token-swap | high |
| canvas/stats/SummaryNode.svelte:158-194 | foreign dark-theme vocab `--bg-card`/`#888`/`#e6e6e6`/`rgba(255,255,255,..)`/`#3a8a56` | `var(--card-bg/border)`, `var(--text-primary/muted)`, `var(--success)` | token-swap | high |
| canvas/[slug]:7097 | `#3a86e0` heal-blocked tint (blue) | `var(--accent-ink)` | token-swap | medium |
| channels/+page.svelte:14-19 · channels/email/[id]:185,190,241 | `#2d7d46`/`#b8860b`/`#b43232` near-token status hex | `var(--success/warn/error)` | token-swap | medium |
| builds/IterationCard:175-190 · BuildSession:432-485 (+7 sibling files) | `#2d7d46` / emerald `#10b981` via undefined `--color-emerald` | `var(--success)`/`var(--status-success)` | token-swap | medium |
| IntelligenceNode.svelte:750-794 | `#5dbea3` mint active pill | `var(--accent)` (cf. FacetPopover:108) | token-swap | medium |
| canvas/+page.svelte:681 (+recurrences) · prompts/+page.svelte:181,204 | `#3a8a56` / `#22c55e` / `rgba(255,255,255,0.7)` | `var(--success)` / `#fff` on accent | token-swap | low |
| canvas/[slug]:1064-1067 | KIND_COLOR `#567` grey-blue + `#7a6cd4` purple | token-derived warm/petrol palette | judgment | low |

**Admin**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| admin/admin.css:39-43,197-201 | `.banner-info`/`.nm-pill[info]` → `var(--info)` blue | reroute to `var(--accent-ink)` (add token first) | token-swap | high |
| admin/pulse/+page.svelte:893,917 | `var(--info)` layer border + label (blue) | `var(--accent-ink)` | token-swap | high |
| OpenRouterConfigPanel:64,114 · ModelDefaultsPanel:192 · OpenRouterModelBrowser:297 | `#ef4444` (brand error is `#c44`) | `var(--error)` | token-swap | high-med |
| admin/integrations:552-553,577-578,643 | `#4a9` mint / `#c44` / `#a33` | `var(--success)`/`var(--error)` | token-swap | medium |
| admin/hermes/+page.svelte:396,398,479,509-510 | `#c44`, bespoke `#2a0a0a`/`#f4cfcf` error console | `var(--error)` + shared `--code-bg/text` | token-swap | medium |
| admin/{keys:223-224,agent:204,agent/tasks:125/140,blog/[id]:369,tools:463,scraper:523,health:641-642/705} | token-equivalent `#2d7a3a`/`#c44` literals | `var(--success)` / `var(--error)` | token-swap | low |
| admin/files/+page.svelte:874-925,1047-1048 | `#c44` + `rgba(196,68,68,.06/.08)` (reference exemplar) | `var(--error)` / `var(--error-bg)` | token-swap | low |
| admin/hermes/{cron,sessions,sessions/[id]} status fallbacks | `var(--status-*, #3ba55d/#b54242)` divergent fallback literals | drop fallback or set `#2d7a3a/#c44` | token-swap | low-med |

**Projects index + shells**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| projects/ShareModal.svelte:194-196 | active/revoked/expired status colours (`#2f7d4f`/`rgba(28,22,17,.1)`/`#b4632e`) | `var(--success)`/`var(--surface-overlay)`/`var(--warn)` (expired = hue-shift caveat) | token-swap | medium |
| projects/ShareModal.svelte:184,198-199 · projects/+page.svelte:80,513-514 | `#b43232` + `rgba(180,50,50,..)` + Tailwind `red-500/10` | `var(--error)`/`var(--error-bg)`/`var(--error-border)` | token-swap | medium |

**Field Studies A**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| policy-engine/+layout.svelte:172 (×4 apps) | bespoke `--paper #f1ead6`/`--ink #1c1611`/`--ink-soft` quartet | consume `var(--bg/surface-elevated/text-primary/text-muted)` | structural | high |
| +layout:223-287 + outcomes:243-259 + ServiceCard:58 + EstateStrip:45,57 (≈198 occ.) | literal blue `#2f6f97` (+ `rgba(47,111,151,*)`) in links/CTAs/tier badges | `var(--accent-ink)` (true CTAs → `var(--accent)`) | token-swap | high |
| +layout:194-305 + dfe-data-strategy parallels | teal `#3f7d6e` + green `#2f7d4f` invented counter-accent/status | `var(--accent-ink)` / `var(--success)`; FAB → `var(--accent)` | token-swap | high |
| +layout:225 · LeverSlider:59-60 | rose/magenta `#b1455e` (4th accent) | `var(--error)` (danger) / `var(--accent)` (flash) | token-swap | medium |
| data-convergence/+page.svelte:468-470 | bespoke alert red `#8a2d22`/`#b13c30` | `var(--error)` family | token-swap | medium |
| dfe-data-strategy/EstateStrip:43,52 | `#2f7d4f` live-dot + own ring | `var(--accent)`+`var(--accent-glow)` or `var(--success)` | token-swap | low |

**Field Studies B**

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| data-standard-designer/legal:250-330 (+brief:339,portal:299-306,validate:142) | `var(--info)` blue on A/B/C hierarchy | `var(--accent-ink)` (add token first) | token-swap | high |
| broads-pilot/PlanPanel:228 · MooringCard:337 · CruiseBanner:93 | `#2e7d32`/`#c62828` status text | `var(--success)`/`var(--error)` | token-swap | medium |
| broads-pilot/+page.svelte:369-401 | `#c62828`/`#2e7d32`/`#e69500` state chrome (token defaults already present) | `var(--error/success/warn)` | token-swap | medium |

*Reviewed and NOT drift (retained for transparency):* `#fff` on `var(--accent)` buttons (broads-pilot:377-445, ShareModal:174/181); `col()` olive `#6a8f2d` score-ramp (schema/+page.svelte:9, data-viz); the `.h-ring-fill.exercise` `#8a3a08` activity-ring stroke (Breakdown:563, data-viz); chart-series `#2f6f97` at outcomes/+page.svelte:123; `var(--accent,#c4570a)` fallbacks (fallback equals token).

### Typography

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| src/app.css:53 | `--font-display:'Archivo Black'` | `'Zilla Slab','Roboto Slab',Georgia,serif` (700) | judgment | high |
| src/app.css:2 | `@import` loads Archivo Black, no Zilla Slab | drop Archivo, add full Zilla Slab axes | structural | high |
| src/app.css:136-142 | `.display{ font-weight:900; text-transform:uppercase; lh:0.9 }` | 700 mixed-case lh:1; add `.display--upper`/`.display--italic` | structural | high |
| src/app.css:60-70 | old scale (xl 120, label 11/10, nav 12) | v3 (132/104/72/36/22; 12/11/13) | token-swap | medium |
| ProseContent:16-26 · blog/[slug]:76-122 · blog/+page:168-177 · MarkdownEditor:598-608 · RichEditor:678-681 · health/v2/Hero:262-271 | `font-weight:900 + text-transform:uppercase` (Archivo artifacts) | 700 (h3 500) mixed-case under Zilla Slab | judgment | high-low |
| canvas/[slug]:7577,7591 | `'Caveat','Comic Sans MS',cursive` post-its | `var(--font-body/mono)` or sanction as tokenised exception | judgment | medium |
| policy-engine/+layout:84,184,264-313 (×4 apps) | Fraunces import + `.brand`/`.pe-h1/h2` | `var(--font-display)` headings, `var(--font-brand)` wordmark | structural | high |
| LandingHero:51,42-43 · VitalTile:150 | clamp cap 120; eyebrow 11px/0.18em; `.num` 30px | 132 cap; 12px/0.14em; snap 22/36 | token-swap/judgment | low |
| SiteNav:186-188,56-59 | burger `0.08em` tracking; wordmark 24/28 vs ref 30 | `0.14em`; align to reference | token-swap/judgment | low |

### Spacing & layout

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| blog/+page.svelte:90 | inline `border-bottom:1px var(--divider)` on post-row | reference uses `border-top` + trailing cap | structural | low |
| policy-engine/+layout:179,181 (×4 apps) | bespoke sticky masthead (paper tint, 9px/8px pad) | align to `--site-nav-height` + `var(--divider)` | structural | low |

Otherwise: no further spacing-only drift verified.

### Components

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| OpenRouterConfigPanel:63-114 · ModelDefaultsPanel:182-192 · OpenRouterModelBrowser:245-302 | parallel Tailwind kit (`rounded`, `#ef4444`, `color:white` on accent) | rebuild on `.nm-*` kit (`.nm-pill`/`.nm-text-input`/`.nm-save-btn`), `var(--error)` | structural | high-med |
| admin/hermes/{cron:156-192,sessions:127-154,sessions/[id]:97-126} | local fork of canonical `.nm-sec`/`.nm-text-input`/`.nm-save-btn` with 5-10px radii | delete local redefinitions, inherit radius-0 kit from nm-tokens.css | structural | high |

### Hover & press

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| landing/VitalTile.svelte:84 | `transform: translateY(-2px)` hover lift | drop the lift; rely on accent-rail + border/bg tint | structural | medium |
| SiteNav.svelte:202 | `rgba(196,87,10,0.06)` burger hover (off-token) | `var(--accent-tint-04)` | token-swap | medium |
| ShareModal.svelte:174,181 | primary buttons have no hover state | add `:hover{ background:var(--accent-hover) }` | judgment | low |

### Borders · radius · shadow

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| src/app.css:79-82 | `--shadow-sm/md/lg` elevation tokens | remove; depth = borders + tints | structural | high |
| nm-tokens.css:128 | `.nm-inline{ box-shadow:var(--shadow-md) }` | remove (1.5px accent border already present) | structural | medium |
| SiteNav.svelte:183 | `box-shadow:0 8px 24px rgba(26,16,8,.18)` (= --shadow-lg) on burger panel | remove; use `--surface-elevated` + 2px border | token-swap | high |
| VitalTile.svelte:79,85 | `--shadow-sm` hover + transitioned | remove (border + accent-tint hover) | structural | high |
| BlogAssistantWidget:366,373 · BlogAssistantMarginCallouts:240/253/295/307 | `rgba(0,0,0,..)` + amber glow elevation | remove; borders + `--surface-elevated` | structural | high |
| PulseGrid:277-280,311 | drop-shadow on peak cell + tooltip | drop the offset blurred layer / shadow | structural | medium |
| ChatArea:2036,2086 · OpenRouterModelPicker:269 | `0 8px 24px`/`0 20px 60px rgba(0,0,0,..)` on floating menus/modal | remove; border + opaque bg | structural | high-med |
| ShareModal.svelte:162 | `0 24px 60px rgba(0,0,0,.5)` modal shadow | remove | structural | high |
| CommandBar:213 | `box-shadow:var(--shadow-lg)` export menu | remove | token-swap | high |
| ArtefactCard:178+ · research/+page:227-256 (+~7 desk files) · NodePalette:305 | hard-offset `3px 4px 0` / `6px 6px 0` brutalist shadow | remove OR sanction one brutalist-edge token | structural/judgment | medium |
| IterationCard:175-190 | `0 0 28px rgba(45,125,70,.35)` running halo | remove (border + accent-tint) | token-swap | medium |
| BuildViewModal:107 · canvas/[slug]:3434 | soft FAB/overlay drop-shadows | remove (opaque bg + border) | token-swap | medium |
| **Radii — off-scale (deduped):** | | | | |
| ShareModal:162-198 (14/10/9/8/7/6px) | SaaS-middle radii on modal/inputs/rows | `var(--radius-sharp)` (badge→`--radius-round`) | token-swap | high-med |
| MarkdownEditor:481 · RichEditor:643 (8px); both `.r-pill` 999px | editor wrappers + pills | `var(--radius-sharp)` / `var(--radius-pill)` | token-swap | medium-low |
| ChatArea:2035-2543 (8/6.4/6/3px) · ConversationSidebar:262/269 (rounded-lg) · jkai/+page:326 (3px) | command palette/menus/cards/links | `var(--radius-sharp)` / `var(--radius-round)` | token-swap | medium-low |
| IntelligenceNode:721-949 (6/10/12px) · FacetPopover:75/101 (8/12px) · ResearchResultNode:317/374 (10/5px) | intel/popover chrome | `var(--radius-sharp/pill/round)` | token-swap | medium-low |
| admin/hermes/{cron,sessions,sessions/[id]} (5/6/7/8/10px) · pulse:866 (999px) | admin cards/pills/inputs | radius-0 / `var(--radius-pill)` | structural/token-swap | high-low |
| +page.svelte:236/263 (999px) · BackgroundToggle:28 / BiomeToggle:21 (rounded-full) · heart/* (4/3px) | pills + heart controls | `var(--radius-pill)` / 0 / `var(--radius-sharp)` | token-swap | low |
| policy-engine lane (~300 decl: 5-24px) | endemic off-scale radii | collapse to 0/2/4/100 | token-swap | high |
| broads-pilot lane (0.3-0.9rem family) · GuideChat:81/Logbook:128/BoatSheet:25 (0.7rem + 0 12px 40px) · floating-surface shadows 363-434 | rem radii + drop-shadow elevation | 0/2px + remove shadows | token-swap/structural | high |
| data-standard-designer (3px stragglers; `--shadow-md/lg` ×5: layout:158, brief:310, Onboarding:68, StandardDetail:105) | minor radii + 5 elevations | `var(--radius-sharp/round)` + remove shadows | token-swap/structural | medium-low |
| LiveWalkBanner:92 · live:231 · health:270 | hand-coded live-dot glows | `var(--accent-glow)` | token-swap | low |

### Motion

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| src/app.css:91 | `--ease-spring: cubic-bezier(0.33,1,0.68,1)` | remove (only `--ease-out` sanctioned) | structural | medium |
| src/app.css:353 | back-link arrow uses inline spring | `transition: transform 0.2s var(--ease-out)` | token-swap | low |
| VitalTile:98 · FeatureIndex:137,149,193 | `var(--ease-spring)` on chrome gestures | `var(--ease-out)` | token-swap | high-med |
| ScrollReveal.svelte:42,47 | `0.8s` (800ms) reveals | `var(--t-slow)` (360ms) | token-swap | high |
| data-convergence/+page.svelte:516 | `cubic-bezier(0.2,0.9,0.2,1)` panel slide | `0.2s ease-out` | token-swap | low |
| broads-pilot/+page:381 · PilotSheet:70 | Material `cubic-bezier(0.4,0,0.2,1)` | `0.2s ease-out` (mild drift, not hard #6) | token-swap | low |

### Iconography & emoji

| file:line | current | should be | fix | sev |
|---|---|---|---|---|
| BlogAssistantWidget.svelte:275 | 🪶 FAB label | hand-drawn 20×20 inline SVG | structural | high |
| ChatArea.svelte:1106-1109/1569 | 🏠💓⚡✨ hero chips | inline SVG icons | structural | high |
| ConversationSidebar.svelte:265 | 🔷 Intel Dashboard link | inline SVG / unicode glyph | structural | high |
| MessageAttachments:54 · ComposerAttachmentTray:33-39 | 📄📎📝 / 🎙️🎬📄📎 | inline SVG file-type icons | structural | medium |
| intel/alerts:14-19,66 · intel/{,search,notes} sourceIcon (3 files) | 🔗⚠️❌🔄🔔 / 🌐💬📱📧📝 | inline SVG icons | structural | high |
| canvas/[slug]:4930 · OpenAsWebpageButton:31 | 🔧 heal banner · 🌐 button | inline SVG | structural | medium |
| broads-pilot/+page.svelte:198-344 | 🔒🔓📖✨📍🗺️ primary chrome | inline SVG icons | structural | high |
| broads-pilot/lib/guide.svelte.ts:16-17 | 🐾🍺🎣🏊🛒🦢📷 interest chips (data) | strip emoji / pair SVG | copy/structural | high |
| policy-engine/lib/comparators.ts:96-159 (+neet.ts, monitoring.ts) | 🇬🇧🇸🇬🇯🇵🇪🇪 flag emoji (10) | ISO code text as mono label / SVG | structural | medium |

### Voice & content

**Clean** — no verified copy/voice findings (emoji-in-data is reported under Iconography).

---

## Suggested change-sets (small, separately-reviewable diffs)

1. **`feat(tokens): add --accent-ink counter-accent family`** — insert `--accent-ink:#0e5b66` +hover +tints into `app.css :root`. *Mechanical.* Prerequisite for all no-blues reroutes. Clears 1 finding, unblocks ~11.
2. **`fix(tokens): retire blue --info → --accent-ink`** — repoint `--info`/`--info-bg`/`--info-border` (app.css:44-46); verify admin.css banner/pill + pulse + legal/portal/brief/validate. *Mechanical after #1.* Clears ~7.
3. **`refactor(tokens): bump type scale to v3`** — app.css:60-70 → 132/104/72/36/22 + 12/11/13. *Mechanical.* Clears 4 (incl. hero clamp, eyebrow).
4. **`refactor(motion): remove --ease-spring`** — delete app.css:91; swap consumers (app.css:353, VitalTile:98, FeatureIndex:137/149/193) to `var(--ease-out)`; ScrollReveal:42/47 → `var(--t-slow)`. *Mechanical.* Clears 5.
5. **`refactor(shadow): remove --shadow-* elevation tokens + fix 7 consumers`** — delete app.css:79-82; sweep nm-tokens.css:128, CommandBar:213, and the other token consumers. *Mostly mechanical, needs depth-cue review on floating panels.* Clears ~7 + sets up the raw-shadow sweep.
6. **`refactor(shadow): drop raw elevation box-shadows on chrome`** — SiteNav:183, VitalTile:79/85, BlogAssistant* , ChatArea:2036/2086, OpenRouterModelPicker:269, ShareModal:162, modals/FABs/overlays. *Pattern-repetitive, review per surface.* Clears ~15.
7. **`refactor(radius): normalize off-scale radii to 0/2/4/100`** — global sweep of 3/5/6/7/8/9/10/11/12/14px + `rounded-lg`/`rounded-full`/`999px`/`0.5rem`. Best split per lane (admin / jkai / projects / field-studies). *Mechanical, very high volume.* Clears ~35.
8. **`refactor(icons): replace emoji with inline SVG`** — blog FAB, ChatArea chips, ConversationSidebar, intel icon maps (3 files), canvas heal, OpenAsWebpageButton, broads-pilot chrome + guide data, policy-engine flags. *Needs SVG asset work, structural.* Clears ~12.
9. **`refactor(status): consolidate status literals onto --error/--success/--warn`** — admin lane + jkai reds/greens + broads-pilot + channels. *Mechanical (a few off-value corrections).* Clears ~25.
10. **`feat(type): migrate display font to Zilla Slab`** — app.css:2/53/136-142 + downstream `font-weight:900 + uppercase` heading overrides. *Needs design sign-off; coordinated.* Clears ~10.
11. **`refactor(admin): unfork the .nm-* kit`** — delete local `.nm-sec/.nm-text-input/.nm-save-btn` redefinitions in hermes/cron+sessions+sessions/[id]; rebuild OpenRouter/ModelDefaults Tailwind panels on `.nm-*`. *Structural, needs review.* Clears ~6.
12. **`refactor(field-studies): adopt global tokens`** — remove `--paper/--ink` quartet (4 apps), drop Fraunces, reroute `#2f6f97`/`#3f7d6e`/`#b1455e`. *Large, partly judgment.* Clears the Field Studies A root cause + most colour/type findings.

---

## Judgment calls for John

1. **Archivo Black → Zilla Slab (the strategic one).** The canonical `colors_and_type.css` + brief §4 say Zilla Slab; the live `app.css` and the stale `design-guide.md` prose say Archivo Black. The contract wins, but flipping it re-characterises every hero, heading, drop-cap and big numeral sitewide, and inertly-coupled `font-weight:900 + text-transform:uppercase` overrides (Prose, blog, both editors, health) must change with it. **Decision needed:** go/no-go + a visual pass, and update `CLAUDE.md`/memory which still reference Archivo Black.
2. **The status-colour system (success/warn/error) is newer than the contract.** Green/amber/red are useful legibility affordances and are NOT flagged as drift — but they are not in the canonical token set, which sanctions only orange `--accent` + petrol `--accent-ink`. Only `--info` (`#2d6cdf`, a literal blue) is unambiguous drift. **Decision:** keep the status palette as a sanctioned extension (recommended), and route `--info` to `--accent-ink`.
3. **Are the project Field Studies allowed bespoke divergence?** policy-engine/dfe-*/data-convergence intentionally feel like standalone editorial pieces (their own `--paper/--ink` palette, Fraunces serif, app-specific mastheads). They never inherit global token changes, so they will drift forever unless folded in. **Decision:** either (a) bring them onto global tokens (loses some editorial identity), or (b) formally sanction a "Field Study" sub-theme — but even then the literal blue `#2f6f97`, Fraunces wordmark, and off-scale radii should be corrected.
4. **Shadow tokens vs the brutalist hard-offset edge.** Non-negotiable #3 bans elevation shadows, yet a deliberate-looking `3px 4px 0`/`6px 6px 0` hard-offset appears across the research desk (ArtefactCard `--brutal`, NodePalette, ~7 desk files). **Decision:** sanction ONE brutalist-edge token sitewide, or remove all offset shadows. (Soft `rgba(0,0,0,..)` drop-shadows are clear drift regardless.)
5. **A dedicated "negative trend" token.** `#8a3a08` (Hero/Breakdown "bad/down") has no semantic home — `var(--accent-hover)` is a stopgap. **Decision:** introduce `--trend-down` or accept the accent-hover mapping.
6. **WhatsApp green `#25d366` and other brand/channel colours.** Arguably legitimate (like a logo colour) but outside the warm palette and in chrome. **Decision:** hoist to a single `--wa-green` token, or switch the live-dot to `var(--accent)` for system consistency.
7. **`#a33` danger-hover with no token** (admin.css:239, integrations:578, files:1048) — an established house pattern lacking a token. **Decision:** add `--error-hover` and route all three, or accept the literal.
8. **Intentionally-newer / dark-surface contexts NOT flagged:** IterationCard's `.think-frame` "thinking terminal" (`#000` console motif), the post-it `Caveat` font (decorative — though Comic Sans is an anti-pattern), data-viz colour series (activity rings, chart series, score ramps). Confirm these intentional choices stand.
