<script lang="ts">
  // SurfaceDetail — the zoomed view behind a click on the tour.
  //
  // Three jobs, in this order: show the page big enough to actually read, say what you
  // can do on it, and hand the reader off to the part of the study that explains how it
  // works. The third one is the point — the tour is a table of contents wearing a
  // photograph, and every feature line is a door into the rest of the study.
  //
  // Portal, backdrop and Escape handling follow ResearchSourceModal / FileViewerModal:
  // appended to <body> so the overlay escapes any stacking context, opaque panel
  // background (SR modal-token guidance — a translucent modal over a busy page is
  // unreadable).
  import { SURFACES, shot, surfaceById, type Surface } from '../lib/tour';
  import { PARTS, B } from '../lib/nav';

  let { surface, onClose, onOpen }: {
    surface: Surface;
    onClose: () => void;
    onOpen: (id: string) => void;
  } = $props();

  // Resolve `part/slug` back to the part and the leaf, so a link can name the page it
  // opens rather than just the part it lives in. "Part I · A turn" tells a reader
  // nothing; "Where the money goes" tells them whether to click.
  const target = (section?: string) => {
    if (!section) return null;
    const [partId, slug] = section.split('/');
    const part = PARTS.find((p) => p.id === partId);
    if (!part) return null;
    const leaf = part.leaves.find((l) => l.slug === slug);
    return { part, label: leaf?.label ?? part.name };
  };

  const leads = $derived(surface.leads.map(surfaceById).filter((s): s is Surface => !!s));

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="sd-backdrop" use:portal onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="sd-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
       aria-label="{surface.label} — what this page does">
    <header class="sd-hdr">
      <div class="sd-title">
        <span class="sd-kicker">{surface.kicker} · {surface.route}</span>
        <b class="sd-name">{surface.label}</b>
      </div>
      <button type="button" class="sd-close" onclick={onClose} title="Close (Esc)" aria-label="Close">✕</button>
    </header>

    <div class="sd-body">
      <figure class="sd-figure">
        <img src={shot(surface.id, 'full')} alt="A screenshot of {surface.label}" loading="lazy" />
        <figcaption>
          Captured from a running instance. Every name, place and filename in this image is
          an invention — the real ones are replaced in the browser before the shot is taken.
        </figcaption>
      </figure>

      <p class="sd-line">{surface.line}</p>

      <h3 class="sd-h3">What you can do here</h3>
      <ul class="sd-feats">
        {#each surface.features as f}
          {@const t = target(f.section)}
          <li class="sd-feat">
            <b class="sf-label">{f.label}</b>
            <span class="sf-what">{f.what}</span>
            {#if f.section && t}
              <a class="sf-link" href="{B}/{f.section}" style="--tone:{t.part.tone}">
                {t.label} <span class="sf-part">Part {t.part.no}</span> →
              </a>
            {/if}
          </li>
        {/each}
      </ul>

      {#if leads.length}
        <h3 class="sd-h3">Where you can get to from here</h3>
        <div class="sd-leads">
          {#each leads as l}
            <button type="button" class="sd-lead" onclick={() => onOpen(l.id)}>
              <img src={shot(l.id)} alt="" aria-hidden="true" />
              <span>{l.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .sd-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    display: flex; align-items: center; justify-content: center;
    padding: clamp(8px, 3vw, 40px);
    background: rgba(28, 22, 17, 0.62);
    backdrop-filter: blur(2px);
  }
  .sd-modal {
    display: flex; flex-direction: column;
    width: min(1040px, 100%); height: min(90vh, 100%);
    /* Opaque, not translucent — the tour behind this is a wall of screenshots. */
    background: #fdfbf6;
    border: 1px solid rgba(28, 22, 17, 0.28);
    border-radius: var(--radius-round);
    overflow: hidden;
  }

  .sd-hdr {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 15px; border-bottom: 1px solid rgba(28, 22, 17, 0.16);
    background: rgba(28, 22, 17, 0.035); flex-shrink: 0;
  }
  .sd-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .sd-kicker { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(28, 22, 17, 0.5); }
  .sd-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 21px; line-height: 1.15;
    color: var(--text-primary); }
  .sd-close { background: none; border: 1px solid rgba(28, 22, 17, 0.2); border-radius: var(--radius-round);
    width: 30px; height: 30px; cursor: pointer; font-size: 13px; color: rgba(28, 22, 17, 0.6); flex-shrink: 0; }
  .sd-close:hover { background: rgba(28, 22, 17, 0.06); color: var(--text-primary); }

  .sd-body { overflow-y: auto; padding: 16px 18px 22px; }

  .sd-figure { margin: 0 0 14px; }
  .sd-figure img { display: block; width: 100%; height: auto; border-radius: var(--radius-round);
    border: 1px solid rgba(28, 22, 17, 0.18); background: #fff; }
  .sd-figure figcaption { margin-top: 7px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    line-height: 1.6; color: rgba(28, 22, 17, 0.5); max-width: 88ch; }

  .sd-line { margin: 0 0 18px; font-size: 16px; line-height: 1.58; color: rgba(28, 22, 17, 0.8); max-width: 72ch; }

  .sd-h3 { margin: 0 0 9px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28, 22, 17, 0.5); font-weight: 500; }

  .sd-feats { list-style: none; margin: 0 0 20px; padding: 0; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(272px, 1fr)); gap: 9px; }
  .sd-feat { display: flex; flex-direction: column; gap: 3px; padding: 11px 13px;
    border: 1px solid rgba(28, 22, 17, 0.14); border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.6); }
  .sf-label { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; line-height: 1.28;
    color: var(--text-primary); }
  .sf-what { font-size: 13px; line-height: 1.52; color: rgba(28, 22, 17, 0.72); }
  .sf-link { margin-top: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    letter-spacing: 0.06em; color: var(--tone); text-decoration: none; }
  .sf-link:hover { text-decoration: underline; }
  .sf-part { color: rgba(28, 22, 17, 0.42); }

  .sd-leads { display: flex; flex-wrap: wrap; gap: 8px; }
  .sd-lead { display: flex; align-items: center; gap: 8px; padding: 5px 11px 5px 5px; cursor: pointer;
    border: 1px solid rgba(28, 22, 17, 0.16); border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.6); font-family: inherit; font-size: 12.5px;
    color: var(--text-primary); transition: background 0.13s, border-color 0.13s; }
  .sd-lead:hover { background: #fff; border-color: rgba(28, 22, 17, 0.34); }
  .sd-lead img { width: 40px; height: 25px; object-fit: cover; object-position: top left;
    border-radius: 2px; border: 1px solid rgba(28, 22, 17, 0.14); }

  @media (max-width: 640px) {
    .sd-modal { height: 100%; }
    .sd-name { font-size: 18px; }
  }
</style>
