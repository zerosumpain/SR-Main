<svelte:options css="injected" />

<script lang="ts">
  // One project, read as a paragraph of the essay. The margin carries its
  // number and its kind in mono, as the home page's chapters carry theirs;
  // the main column has the name as a link in display type, the rest of the
  // title as an italic dek, the whole blurb in the serif (this view is for
  // reading, so nothing is clamped), and the chips set as a footnote under a
  // short rule. The owner's buttons sit at the foot.
  //
  // A finished product is marked in petrol rather than orange, a kind of
  // thing rather than a better one. An entry the public cannot see says so
  // in the margin and opens on a dashed rule instead of a solid one.
  import type { Snippet } from 'svelte';
  import { entryNumber, splitTitle } from './sentence';
  import type { ProjectEntry } from '$lib/projects/views';

  let {
    e,
    tone,
    owner,
    controls,
  }: {
    e: ProjectEntry;
    /** The chapter's colour; a product overrides it with petrol. */
    tone: 'accent' | 'ink';
    owner: boolean;
    controls: Snippet<[ProjectEntry]>;
  } = $props();

  let t = $derived(splitTitle(e.title));
</script>

<article
  class="se"
  id="sp-{e.key}"
  data-tone={e.product ? 'ink' : tone}
  data-private={e.isPublic ? undefined : ''}
  aria-labelledby="sp-{e.key}-t"
>
  <p class="se-m">
    <span class="se-n"><span class="vh">Number </span>{entryNumber(e.n)}</span>
    <span class="se-kind">{e.kind}</span>
    <span class="se-tag">{e.tag}</span>
    {#if !e.isPublic}<span class="se-priv">{e.ownerOnly ? 'never public' : 'only I can see this'}</span>{/if}
  </p>

  <div class="se-b">
    <h3 class="se-t" id="sp-{e.key}-t">
      <a
        href={e.href}
        rel={e.external ? 'noopener' : undefined}
        ><span class="se-name">{t.name}</span>{#if e.external}<span class="vh"> (opens outside this site)</span><span
            class="se-go"
            aria-hidden="true">↗</span
          >{:else}<span class="se-go" aria-hidden="true">→</span>{/if}</a
      >
    </h3>
    {#if t.dek}<p class="se-dek">{t.dek}</p>{/if}
    <p class="se-blurb">{e.blurb}</p>
    {#if e.chips}<p class="se-chips"><span class="vh">Notes: </span>{e.chips}</p>{/if}
    {#if owner}<div class="se-foot">{@render controls(e)}</div>{/if}
  </div>
</article>

<style>
  .se {
    --tone: var(--accent-hover);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 12px;
    padding: clamp(28px, 3vw, 40px) 0 clamp(30px, 3.2vw, 44px);
    border-top: 1px solid var(--line-strong);
    /* Clear of the sticky header when a footnote jumps here. */
    scroll-margin-top: 88px;
  }
  .se[data-tone='ink'] {
    --tone: var(--accent-ink);
  }
  .se[data-private] {
    border-top-style: dashed;
    border-top-color: var(--text-muted);
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* The margin: number, kind, tag, and whether the public can see it. */
  .se-m {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 14px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .se-n {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: clamp(24px, 2vw, 30px);
    line-height: 1;
    letter-spacing: 0;
    font-variant-numeric: lining-nums;
    color: var(--tone);
  }
  .se-kind {
    color: var(--tone);
  }
  .se-priv {
    color: var(--text-primary);
  }
  .se-priv::before {
    content: '';
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 8px;
    border: 1px solid currentColor;
    border-radius: 100px;
    vertical-align: 0.05em;
  }

  .se-b {
    min-width: 0;
  }
  .se-t {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(25px, 2.3vw, 34px);
    line-height: 1.04;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }
  .se-t a {
    color: var(--text-primary);
    text-decoration: none;
  }
  .se-name {
    background-image: linear-gradient(var(--tone), var(--tone));
    background-size: 0 2px;
    background-position: 0 100%;
    background-repeat: no-repeat;
    transition: background-size var(--t-base, 220ms) var(--ease-out, ease-out);
  }
  .se-t a:hover .se-name {
    background-size: 100% 2px;
  }
  .se-go {
    display: inline-block;
    margin-left: 0.3em;
    font-weight: 400;
    color: var(--tone);
    transition: transform var(--t-base, 220ms) var(--ease-out, ease-out);
  }
  .se-t a:hover .se-go {
    transform: translateX(4px);
  }
  .se-t a:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
    border-radius: 2px;
  }
  /* Arrived at from a footnote: the name is marked, as a reader would mark it. */
  .se:target .se-name {
    background-image: linear-gradient(
      color-mix(in srgb, var(--tone) 28%, transparent),
      color-mix(in srgb, var(--tone) 28%, transparent)
    );
    background-size: 100% 0.32em;
  }

  .se-dek {
    margin: 6px 0 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: clamp(18px, 1.45vw, 22px);
    line-height: 1.3;
    color: var(--text-secondary);
  }
  .se-blurb {
    max-width: 36em;
    margin: 14px 0 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-size: clamp(17px, 1.32vw, 20px);
    line-height: 1.56;
    letter-spacing: -0.004em;
    color: var(--text-primary);
    text-wrap: pretty;
  }
  /* The chips as a footnote: a short rule, then the line in small mono. */
  .se-chips {
    max-width: 52em;
    margin: 18px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .se-chips::before {
    content: '';
    display: block;
    width: 40px;
    height: 1px;
    margin-bottom: 8px;
    background: var(--tone);
  }
  .se-foot {
    position: relative;
    z-index: 1;
    margin-top: 16px;
  }

  /* Desktop: the margin column, as the chapters have it. */
  @media (min-width: 900px) {
    .se {
      grid-template-columns: var(--margin) minmax(0, 1fr);
      column-gap: 32px;
    }
    .se-m {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      /* The numeral's top level with the name's cap height. */
      padding-top: 2px;
    }
    .se-n {
      margin-bottom: 6px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .se-name,
    .se-go {
      transition: none;
    }
  }
  @media print {
    .se {
      break-inside: avoid;
      border-top-color: #1a1008;
    }
    .se-m,
    .se-n,
    .se-kind,
    .se-priv,
    .se-t a,
    .se-dek,
    .se-blurb,
    .se-chips,
    .se-go {
      color: #1a1008;
    }
    .se-chips::before {
      background: #1a1008;
    }
    .se-foot {
      display: none;
    }
  }
</style>
