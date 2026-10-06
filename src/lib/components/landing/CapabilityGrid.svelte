<script lang="ts">
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import type { Spot } from '$lib/landing/ramblers/world';
  import { ago, until } from '$lib/landing/live-vitals.svelte';
  import type { CapabilityFacts } from '$lib/landing/capabilities';

  let {
    v,
    now,
    bpm,
    facts,
    deploysToday,
    deploysYesterday,
    linesWritten,
    days,
  }: {
    v: LandingVitals | null;
    now: number;
    bpm: number | null;
    facts: CapabilityFacts;
    deploysToday: number | null;
    deploysYesterday: number | null;
    linesWritten: number | null;
    days: number | null;
  } = $props();

  type Tone = 'orange' | 'petrol' | 'ink' | 'bright' | 'paper-orange' | 'paper-petrol';
  type Art = 'pulse' | 'think' | 'build' | 'ship' | 'canvas' | 'answer' | 'pocket' | 'family';
  // Where the rambler does things: he works out on the pulse cell, daydreams
  // on the thinking cell and reads at the build cell.
  const SPOTS: Partial<Record<Art, Spot>> = { pulse: 'gym', think: 'think', build: 'desk' };
  interface Cap {
    art: Art;
    tone: Tone;
    name: string;
    body: string;
    status: string;
    live: boolean;
    href: string;
  }

  let caps = $derived.by<Cap[]>(() => {
    const dd = v?.daydream;
    const next = dd && !dd.paused ? until(dd.nextRunAt, now) : '';
    const b = v?.builder;
    const c = v?.canvas;
    const jobs = v?.jkai.activeJobs ?? 0;
    return [
      {
        art: 'pulse',
        tone: 'orange',
        name: 'Feel a pulse',
        body: 'Heart rate, sleep and every step stream in from the watch and Whoop, and the monitor above beats with them.',
        status: bpm != null ? `${bpm} bpm now` : 'Heart rate not reporting',
        live: bpm != null,
        href: '/health',
      },
      {
        art: 'think',
        tone: 'paper-petrol',
        name: 'Think idly',
        body: 'Daydream works through questions while nobody is watching and files what it finds.',
        status: next ? `Next think ${next}` : dd?.paused ? 'Asleep until morning' : `Every ${facts.daydream.cadenceMinutes} min`,
        live: false,
        href: '/projects/engine-room/daydream',
      },
      {
        art: 'build',
        tone: 'petrol',
        name: 'Rewrite itself',
        body: 'An autonomous builder turns an accepted idea into a tested pull request against this very site.',
        status: b ? (b.active ? `${b.stage} now` : `Idle · ${b.shippedCount} shipped`) : 'Builder',
        live: !!b?.active,
        href: '/projects/engine-room/build',
      },
      {
        art: 'ship',
        tone: 'paper-orange',
        name: 'Ship in public',
        body:
          linesWritten != null && days != null
            ? `Every deploy is logged, summarised and published: ${linesWritten.toLocaleString('en-GB')} lines in ${days} days.`
            : 'Every deploy is logged, summarised and published.',
        status:
          deploysToday != null
            ? `${deploysToday} today${deploysYesterday != null ? ` · ${deploysYesterday} yesterday` : ''}`
            : 'On the record',
        live: false,
        href: '/releases',
      },
      {
        art: 'canvas',
        tone: 'paper-petrol',
        name: 'Run on a schedule',
        body: 'A node-based canvas engine wires the house, the mail and the site into automations that fire on their own.',
        status: c ? `${c.count} canvases${c.lastRunAt ? ` · ran ${ago(c.lastRunAt, now)}` : ''}` : 'Canvases',
        live: false,
        href: '/projects/engine-room',
      },
      {
        art: 'answer',
        tone: 'ink',
        name: 'Answer back',
        body: 'JKAI, the assistant behind it all, holds the tools, the memory and the jobs in flight.',
        status: v ? (jobs > 0 ? `${jobs} job${jobs === 1 ? '' : 's'} running` : 'Quiet right now') : 'Assistant',
        live: jobs > 0,
        href: '/projects/engine-room',
      },
      {
        art: 'pocket',
        tone: 'paper-orange',
        name: 'Live in a pocket',
        body: 'A native iPhone and watch app: Live Activities, widgets, Siri and offline route maps.',
        status: `${facts.app.nativeEndpoints} native endpoints`,
        live: false,
        href: '/projects/engine-room/app',
      },
      {
        art: 'family',
        tone: 'bright',
        name: 'Track the family',
        body: 'Where everyone is and what they are up to, minute by minute: movement, steps and arrivals, kept inside the family.',
        status: 'Private to the family',
        live: false,
        href: '/projects/engine-room/app',
      },
    ];
  });
</script>

{#snippet icon(art: Art)}
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if art === 'pulse'}
      <path d="M2 12h4l2-5 3 10 2-7 2 4h7" />
    {:else if art === 'think'}
      <path d="M7 16a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.75 3.75 0 0 1 .5 8.5H7z" /><circle cx="6" cy="20" r="1" /><circle cx="3" cy="22.5" r=".5" />
    {:else if art === 'build'}
      <circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10" /><path d="M18 9a7 7 0 0 1-7 7H8" />
    {:else if art === 'ship'}
      <path d="M12 18V4" /><path d="M6 10l6-6 6 6" /><path d="M4 21h16" />
    {:else if art === 'canvas'}
      <rect x="3" y="3" width="7" height="5" /><rect x="14" y="3" width="7" height="5" /><rect x="8.5" y="16" width="7" height="5" /><path d="M6.5 8v3.5h11V8" /><path d="M12 11.5V16" />
    {:else if art === 'answer'}
      <path d="M4 4h16v12H9l-5 4z" /><path d="M8.5 10h.01M12 10h.01M15.5 10h.01" />
    {:else if art === 'pocket'}
      <rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" />
    {:else}
      <circle cx="12" cy="7" r="2.5" /><circle cx="5.5" cy="15" r="2.5" /><circle cx="18.5" cy="15" r="2.5" /><path d="M12 9.5v3M8 15h8" stroke-dasharray="1.5 2" /><path d="M3 21h18" />
    {/if}
  </svg>
{/snippet}

<!-- The big faint drawing behind each cell: the same idea as its icon, drawn as
     a line illustration. Inline SVG, so it costs no request and stays sharp. -->
{#snippet art(kind: Art)}
  <svg class="art" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if kind === 'pulse'}
      <circle cx="54" cy="54" r="26" /><circle cx="54" cy="54" r="38" stroke-dasharray="2 4" /><circle cx="54" cy="54" r="48" stroke-dasharray="1 6" /><path d="M0 56 H30 L36 44 L44 78 L52 16 L60 68 L66 56 H100" />
    {:else if kind === 'think'}
      <circle cx="60" cy="40" r="10" /><circle cx="60" cy="40" r="20" stroke-dasharray="3 5" /><circle cx="60" cy="40" r="30" /><circle cx="60" cy="40" r="40" stroke-dasharray="1 7" /><circle cx="22" cy="82" r="5" /><circle cx="12" cy="94" r="3" /><circle cx="34" cy="70" r="7" />
    {:else if kind === 'build'}
      <path d="M24 100 V0" /><path d="M24 78 C24 62 62 66 62 50 V34 C62 20 24 24 24 10" /><path d="M62 50 C62 40 88 42 88 30" /><circle cx="24" cy="90" r="4" /><circle cx="24" cy="78" r="4" /><circle cx="62" cy="50" r="4" /><circle cx="62" cy="34" r="4" /><circle cx="88" cy="30" r="4" /><circle cx="24" cy="10" r="6" />
    {:else if kind === 'ship'}
      <path d="M0 60 H100" stroke-width="1" /><path d="M8 60V48 M16 60V40 M24 60V52 M32 60V30 M40 60V44 M48 60V22 M56 60V38 M64 60V16 M72 60V34 M80 60V10 M88 60V26 M96 60V18" stroke-width="2" /><path d="M8 60V68 M16 60V74 M24 60V66 M32 60V80 M40 60V70 M48 60V84 M56 60V72 M64 60V88 M72 60V76 M80 60V92 M88 60V78 M96 60V86" stroke-width="1.2" />
    {:else if kind === 'canvas'}
      <rect x="6" y="10" width="26" height="16" /><rect x="6" y="44" width="26" height="16" /><rect x="48" y="26" width="26" height="16" /><rect x="48" y="64" width="26" height="16" /><rect x="84" y="44" width="26" height="16" /><path d="M32 18 C40 18 40 34 48 34 M32 52 C40 52 40 34 48 34 M32 52 C40 52 40 72 48 72 M74 34 C80 34 78 52 84 52 M74 72 C80 72 78 52 84 52" />
    {:else if kind === 'answer'}
      <path d="M8 14 H66 V52 H30 L16 64 V52 H8 Z" /><path d="M40 60 V84 H74 L88 96 V84 H98 V40 H74" /><path d="M20 28 H54 M20 38 H44" /><circle cx="60" cy="72" r="1.6" /><circle cx="70" cy="72" r="1.6" /><circle cx="80" cy="72" r="1.6" />
    {:else if kind === 'pocket'}
      <rect x="14" y="4" width="44" height="88" rx="2" /><path d="M30 10 H42" /><rect x="20" y="20" width="32" height="14" /><rect x="20" y="40" width="14" height="14" /><rect x="38" y="40" width="14" height="14" /><rect x="70" y="40" width="26" height="30" rx="2" /><path d="M76 40 V30 H90 V40 M76 70 V80 H90 V70" /><path d="M74 56 H78 L80 50 L83 62 L85 56 H92" />
    {:else}
      <path d="M8 60 C30 30 60 90 96 46" opacity=".5" /><path d="M4 86 C30 60 66 100 98 76" opacity=".5" /><path d="M10 14 C24 34 40 30 58 52" stroke-width="2" stroke-dasharray="1 5" /><path d="M92 10 C80 30 70 34 58 52" stroke-width="2" stroke-dasharray="1 5" /><path d="M14 96 C30 76 44 70 58 52" stroke-width="2" stroke-dasharray="1 5" /><circle cx="10" cy="14" r="4" /><circle cx="92" cy="10" r="4" /><circle cx="14" cy="96" r="4" /><path d="M50 56 L58 46 L66 56 V66 H50 Z" /><circle cx="58" cy="56" r="20" stroke-dasharray="2 4" />
    {/if}
  </svg>
{/snippet}

<section class="cap-sec" aria-labelledby="caps-h">
  <header class="cap-hd">
    <h2 id="caps-h" class="cap-h">An autonomous brain</h2>
    <span class="cap-rule" use:scenery></span>
    <a class="cap-meta" href="/projects/engine-room">How it works →</a>
  </header>
  <ul class="caps">
    {#each caps as c, i (c.art)}
      <li use:scenery={{ spot: SPOTS[c.art], ladder: i === caps.length - 1 ? 'right' : undefined }}>
        <a class="cap" data-tone={c.tone} href={c.href}>
          {@render art(c.art)}
          <span class="ihead">{@render icon(c.art)}<span class="num">{String(i + 1).padStart(2, '0')}</span></span>
          <span class="name">{c.name}</span>
          <span class="body">{c.body}</span>
          <span class="status"><span class="dot" class:live={c.live}></span>{c.status}</span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .cap-sec {
    max-width: 1312px;
    margin: 0 auto;
    padding: 88px clamp(16px, 4vw, 64px) 0;
  }
  .cap-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 20px;
    margin-bottom: 24px;
  }
  .cap-h {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(var(--fs-display-sm), 4vw, 2.75rem);
    line-height: 0.9;
    letter-spacing: -0.04em;
    text-transform: uppercase;
  }
  .cap-rule {
    flex: 1 1 40px;
    height: 1px;
    background: var(--line-strong);
  }
  .cap-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }

  /* A checkerboard of the brand's three grounds against paper. Each cell sets
     its foreground, icon colour and secondary text once, as custom properties;
     everything inside reads them. Cream on burnt orange uses --accent-hover,
     because --accent itself is under 4.5:1 against cream body text. */
  .caps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line-strong);
    border-left: 1px solid var(--line-strong);
  }
  .caps li {
    display: flex;
  }
  .cap {
    --fg: var(--text-primary);
    --ic: var(--accent);
    --sub: var(--text-secondary);
    --ground: var(--surface-card);
    --ground-hover: var(--surface-elevated);
    position: relative;
    overflow: hidden;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 250px;
    padding: 24px 22px;
    border-right: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
    background: var(--ground);
    color: var(--fg);
    text-decoration: none;
    transition: background var(--t-base, 0.2s) ease;
  }
  .cap:hover {
    background: var(--ground-hover);
    color: var(--fg);
  }
  .cap:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
  }
  .cap[data-tone='paper-petrol'] {
    --ic: var(--accent-ink);
  }
  .cap[data-tone='orange'] {
    --ground: var(--accent-hover);
    --ground-hover: #963f06;
    --fg: var(--bg);
    --ic: var(--bg);
    --sub: rgba(237, 228, 212, 0.88);
  }
  .cap[data-tone='petrol'] {
    --ground: var(--accent-ink);
    --ground-hover: var(--accent-ink-hover);
    --fg: var(--bg);
    --ic: var(--accent-ink-on-dark);
    --sub: rgba(237, 228, 212, 0.88);
  }
  .cap[data-tone='ink'] {
    --ground: var(--text-primary);
    --ground-hover: #2a1c10;
    --fg: var(--bg);
    --ic: var(--accent-on-dark);
    --sub: rgba(237, 228, 212, 0.8);
  }
  .cap[data-tone='bright'] {
    --ground: var(--accent-on-dark);
    --ground-hover: #df7a2c;
    --ic: var(--text-primary);
    --sub: rgba(26, 16, 8, 0.82);
  }
  .cap > :not(.art) {
    position: relative;
    z-index: 1;
  }
  .ihead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .cap :global(.ico) {
    width: 30px;
    height: 30px;
    color: var(--ic);
  }
  .num,
  .status {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--sub);
  }
  .name {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1;
    letter-spacing: -0.02em;
    text-transform: uppercase;
  }
  .body {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--sub);
  }
  .status {
    margin-top: auto;
    color: var(--fg);
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 8px;
    border-radius: 100px;
    background: var(--ic);
    vertical-align: middle;
  }
  .dot.live {
    box-shadow: var(--accent-glow);
    animation: blink 1.6s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
  .cap :global(.art) {
    position: absolute;
    z-index: 0;
    right: -34px;
    bottom: -34px;
    width: 210px;
    height: 210px;
    color: var(--ic);
    opacity: 0.16;
    pointer-events: none;
    transition: transform 0.5s var(--ease-out, ease-out);
  }
  .cap[data-tone^='paper'] :global(.art) {
    opacity: 0.12;
  }
  .cap:hover :global(.art) {
    transform: translate(-8px, -8px) rotate(-4deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .cap :global(.art) {
      transition: none;
    }
    .cap:hover :global(.art) {
      transform: none;
    }
    .dot.live {
      animation: none;
    }
  }
  @media (max-width: 900px) {
    .caps {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .cap {
      min-height: 0;
    }
  }
  @media (max-width: 520px) {
    .caps {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
