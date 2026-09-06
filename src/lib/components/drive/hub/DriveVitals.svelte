<script lang="ts">
  // A — STATE OF PLAY. What is in the drive, on the ink band.
  //
  // Six outlined cells on the same ink ground the site nav sits on, so the two
  // read as one band the page hangs from rather than a panel floating on cream.
  // That docking is why this section is thin: on this palette ink is for chrome
  // and thin bands, and a tall solid ink area reads as intensity rather than as
  // editorial — the lesson the landing pulse band cost (PR #611).
  //
  // The figures cover the WHOLE store, not the folder you are stood in. The
  // shelf below follows `currentPath`; this deliberately does not.
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import { fmtAgo } from '$lib/components/health/v2/utils';
  import { computeVitals, splitSize, type DriveStatFile } from '$lib/drive/stats';

  interface Props {
    files: DriveStatFile[];
    /** Share links that still work. Loaded client-side, so it starts at 0. */
    liveLinks: number;
    knowledgeBases: number;
  }

  let { files, liveLinks, knowledgeBases }: Props = $props();

  const v = $derived(computeVitals(files));
  const size = $derived(splitSize(v.bytes));

  /**
   * Searchable share, for the meter. An empty drive reads 0 rather than NaN,
   * and a drive of nothing but images reads full — there is nothing left to
   * index, so that corpus IS complete.
   */
  const meterOn = $derived(Math.round((v.indexable === 0 ? 1 : v.indexed / v.indexable) * 8));

  const tiles = $derived([
    { label: 'Files', value: String(v.files), unit: '', sub: `${v.folders} folder${v.folders === 1 ? '' : 's'}` },
    { label: 'Stored', value: size.value, unit: size.unit, sub: "on the server's disk" },
    { label: 'Searchable', value: String(v.indexed), unit: `of ${v.indexable}`, sub: 'readable by @files', meter: true },
    { label: 'Knowledge', value: String(knowledgeBases), unit: '', sub: knowledgeBases === 1 ? 'base you can chat to' : 'bases you can chat to' },
    { label: 'Live links', value: String(liveLinks), unit: '', sub: liveLinks === 0 ? 'nothing is shared out' : 'downloadable without a login', lit: liveLinks > 0 },
    { label: 'Last added', value: v.newestAgoSeconds === null ? '—' : fmtAgo(v.newestAgoSeconds), unit: '', sub: v.newestAgoSeconds === null ? 'no uploads yet' : 'since the newest upload', small: true },
  ]);
</script>

<section class="a" aria-label="Drive vitals">
  <div class="a-inner">
    <SectionHead
      dark
      kicker="A / State of play · whole drive"
      title={['What is', 'on the shelf']}
      strap={v.files === 0
        ? 'Nothing here yet. Drop a file on the shelf below and it lands in whichever folder you are stood in.'
        : 'Everything on the server, counted across every folder. The shelf below shows one folder at a time; this row does not move when you open one.'}
    />

    <div class="a-tiles">
      {#each tiles as t (t.label)}
        <div class="a-tile" class:lit={t.lit}>
          <p class="a-label">{t.label}</p>
          <p class="a-value" class:sm={t.small}>{t.value}{#if t.unit}<span class="a-unit">{t.unit}</span>{/if}</p>
          {#if t.meter}
            <div class="a-meter" role="img" aria-label="{v.indexed} of {v.indexable} indexable files are searchable">
              {#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}
                <div class="a-bar" class:on={i < meterOn}></div>
              {/each}
            </div>
          {/if}
          <p class="a-sub">{t.sub}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .a {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(28px, 3.4vw, 46px) clamp(20px, 3vw, 44px);
  }
  .a-inner { max-width: 1400px; margin: 0 auto; }

  /* Outlined cells, not a 1px-gap grid over the ground: `auto-fit` paints its
     unfilled tracks, so a six-tile row would show hairline blocks where nothing
     sits. */
  .a-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(178px, 1fr));
    gap: 12px;
  }
  .a-tile {
    background: var(--text-primary);
    border: 1px solid rgba(237, 228, 212, 0.16);
    padding: 15px 16px 14px;
    min-width: 0;
  }
  .a-tile.lit { border-color: rgba(232, 134, 58, 0.45); }
  .a-label, .a-sub, .a-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(237, 228, 212, 0.55);
    margin: 0;
  }
  .a-label { letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 9px; }
  .a-sub { letter-spacing: 0.06em; color: rgba(237, 228, 212, 0.45); margin-top: 9px; }
  .a-value {
    font-family: var(--font-display);
    font-size: 30px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
  }
  /* "3 days" is a phrase, not a numeral — at 30px it wraps and breaks the row. */
  .a-value.sm { font-size: 21px; line-height: 1.05; }
  .a-tile.lit .a-value { color: var(--accent-on-dark); }
  .a-unit {
    font-size: var(--fs-label);
    letter-spacing: 0.04em;
    color: rgba(237, 228, 212, 0.45);
    margin-left: 5px;
  }

  .a-meter { display: flex; gap: 2px; margin-top: 10px; }
  .a-bar { height: 6px; flex: 1; background: rgba(237, 228, 212, 0.16); }
  .a-bar.on { background: var(--good-on-dark); }
</style>
