<script lang="ts">
  // SiteTour — the site as a set of photographs, in three tiers, wired together.
  //
  // The system map elsewhere on this page is a diagram of components. This is the other
  // half of the same story: the pages a person actually meets, in the order they would
  // meet them, with the study's chapters hanging off each one.
  //
  // The interaction copies SystemMap deliberately, because it already works here: with
  // nothing hovered you read the shape, and hovering one card lights only what it
  // connects to. Drawing nineteen literal arrows across a responsive grid produces a
  // hairball and a geometry bug; lighting the ends of each edge says the same thing and
  // survives a phone.
  //
  // Rendering rules (svelte5-pitfalls §1): no handles in $state, structure always drawn.
  import { TIERS, byTier, shot, surfaceById, SURFACES, CAPTURED, type Surface } from '../lib/tour';
  import SurfaceDetail from './SurfaceDetail.svelte';

  let hover = $state<string | null>(null);
  let open = $state<string | null>(null);

  const openSurface = $derived(open ? surfaceById(open) ?? null : null);
  const hovered = $derived(hover ? surfaceById(hover) ?? null : null);

  // Which cards are connected to the hovered one, in either direction?
  const lit = $derived.by(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    const h = surfaceById(hover);
    for (const id of h?.leads ?? []) s.add(id);
    for (const other of SURFACES) if (other.leads.includes(hover)) s.add(other.id);
    return s;
  });

  const dim = (id: string) => !!lit && !lit.has(id);
  const linked = (id: string) => !!lit && lit.has(id) && id !== hover;

  const countFor = (s: Surface) => s.features.length;
</script>

<div class="tour">
  {#each TIERS as t}
    {@const cards = byTier(t.id)}
    <section class="tier" style="--tone:{t.tone}" aria-label={t.name}>
      <header class="t-head">
        <span class="t-no">Tier {t.no}</span>
        <b class="t-name">{t.name}</b>
        <span class="t-lede">{t.lede}</span>
      </header>

      <div class="t-grid">
        {#each cards as s}
          <button
            type="button"
            class="card"
            class:on={hover === s.id}
            class:dim={dim(s.id)}
            class:linked={linked(s.id)}
            onmouseenter={() => (hover = s.id)}
            onmouseleave={() => (hover = null)}
            onfocus={() => (hover = s.id)}
            onblur={() => (hover = null)}
            onclick={() => (open = s.id)}
            aria-label="{s.label} — {s.line} Opens a larger view and {countFor(s)} features."
          >
            <span class="c-shot">
              <img src={shot(s.id)} alt="" aria-hidden="true" loading="lazy" decoding="async" width="760" height="475" />
              {#if !s.open}<span class="c-lock" title="Needs a login">owner</span>{/if}
            </span>
            <span class="c-foot">
              <b class="c-label">{s.label}</b>
              <span class="c-route">{s.route}</span>
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}

  <!-- Fixed-height readout, so the grid does not jump as the pointer crosses it. -->
  <div class="t-read" class:active={!!hovered}>
    {#if hovered}
      <span class="tr-kick">{hovered.kicker}</span>
      <b class="tr-label">{hovered.label}</b>
      <span class="tr-what">{hovered.line}</span>
      <span class="tr-go">click to open →</span>
    {:else}
      <span class="tr-idle">
        Hover a page to light what it connects to. Click one for a bigger look, what it does,
        and where in this study each part of it is explained. Screenshots taken {CAPTURED}.
      </span>
    {/if}
  </div>
</div>

{#if openSurface}
  <SurfaceDetail surface={openSurface} onClose={() => (open = null)} onOpen={(id) => (open = id)} />
{/if}

<style>
  .tour { margin: 12px 0 6px; }

  .tier { margin-bottom: 18px; }
  .t-head { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; margin-bottom: 9px;
    padding-bottom: 7px; border-bottom: 2px solid var(--tone); }
  .t-no { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--tone); }
  .t-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; line-height: 1.15;
    color: var(--text-primary); }
  .t-lede { font-size: 12.5px; line-height: 1.5; color: rgba(28, 22, 17, 0.62); flex: 1 1 320px; min-width: 0; }

  .t-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(228px, 1fr)); gap: 10px; }

  .card { display: flex; flex-direction: column; gap: 0; padding: 0; cursor: pointer; text-align: left;
    border: 1px solid rgba(28, 22, 17, 0.16); border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.55); overflow: hidden; font-family: inherit;
    transition: opacity 0.15s, border-color 0.15s, transform 0.15s, box-shadow 0.15s; }
  .card:hover, .card.on { border-color: var(--tone); transform: translateY(-2px);
    box-shadow: 0 3px 0 rgba(28, 22, 17, 0.08); }
  .card.linked { border-color: var(--tone); }
  .card.dim { opacity: 0.32; }
  .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .c-shot { position: relative; display: block; background: #f6f2ea;
    border-bottom: 1px solid rgba(28, 22, 17, 0.12); }
  .c-shot img { display: block; width: 100%; height: auto; aspect-ratio: 1440 / 900; object-fit: cover;
    object-position: top center; }
  .c-lock { position: absolute; top: 6px; right: 6px; font-family: 'JetBrains Mono', monospace;
    font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 5px;
    border-radius: 2px; background: rgba(28, 22, 17, 0.72); color: #fdfbf6; }

  .c-foot { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px 9px; }
  .c-label { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; line-height: 1.2;
    color: var(--text-primary); }
  .c-route { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28, 22, 17, 0.48);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .t-read { margin-top: 4px; min-height: 46px; display: flex; align-items: baseline; gap: 9px;
    flex-wrap: wrap; padding: 9px 13px; border-radius: var(--radius-round);
    border: 1px solid rgba(28, 22, 17, 0.12); background: rgba(255, 255, 255, 0.4);
    transition: border-color 0.15s, background 0.15s; }
  .t-read.active { border-color: var(--accent-ink-tint-35, rgba(14, 91, 102, 0.35));
    background: var(--accent-ink-tint-12); }
  .tr-kick { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent-ink); }
  .tr-label { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .tr-what { font-size: 12.5px; line-height: 1.5; color: rgba(28, 22, 17, 0.72); flex: 1 1 300px; min-width: 0; }
  .tr-go { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent); white-space: nowrap; }
  .tr-idle { font-size: 12.5px; line-height: 1.5; color: rgba(28, 22, 17, 0.58); max-width: 96ch; }

  @media (max-width: 560px) {
    .t-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .c-label { font-size: 13px; }
  }
</style>
