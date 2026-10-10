<svelte:options css="injected" />

<script lang="ts">
  // The place's showcase: the night walk on down the page from the hero's
  // landscape. Four scenes, each drawn like the hero (a hand-built picture,
  // every reading a real label pinned to its part on a leader line, one plate
  // that explains whichever label is open), then a fingerpost.
  //
  //   1. The observatory (Daydream), heading left, the hill on the right.
  //      Headline: questions it asked itself this week, counting up while the
  //      stars come on one by one, a star a question. Labels: hours in the
  //      dome (its lit slit, its panels the areas of life), look-ups (the
  //      telescope), claims struck out (crossed stars), worth reading (a
  //      constellation of twelve weeks of verdicts), shipped (shooting stars)
  //      and the next think (the hero's cloud). The rules under the plate.
  //      Rambler: the heading, the observatory's terrace ('think'), the ground.
  //   2. The long walk (Health), heading right. Headline: steps since
  //      January, counting up while the path of the year's kilometres draws
  //      itself down the hill. Labels: km on foot (best day on the path),
  //      days over ten thousand (a tree a day for the last thirty, the dashed
  //      line), recovery (thirty lanterns by band, shape as well as colour),
  //      sleep (the moon) and today (an hour to a bar; the cottage window
  //      glows with a fresh pulse, with "hold still"). Rambler: the heading
  //      ('gym', where he checks his pulse), the cottage roof, the ground.
  //   3. The house with a light on (the app), heading left. Headline: the
  //      app's doorways into the site, a lit window each in the block,
  //      lighting one by one. Labels: iPhone tabs, Apple Watch Readiness,
  //      Siri phrases (the mast), the Lock Screen Live Activity and widgets,
  //      family games, the areas. Pairing under the plate. Rambler: the
  //      heading, the block's roof, the ground.
  //   4. The works (shipping), heading right. Headline: releases. A crane
  //      lowers today's deploys as crates; the town's last weeks; the
  //      builder's lit sign; a star on the jib for Daydream's ideas. Rambler:
  //      the heading, the site hut ('desk'), the ground.
  //   5. A fingerpost: run on a schedule, answer back, track the family.
  //
  // Ids are prefixed 'sp-' so nothing collides with the hero's.
  import { cloud, skyAt, sunAltitude, town } from '$lib/landing/place';
  import { daydreamTag } from '$lib/landing/place-copy';
  import { londonHour, readDaydream } from '$lib/landing/sentence';
  import { shipDays } from '$lib/landing/rhythm';
  import { ago } from '$lib/landing/live-vitals.svelte';
  import type { ShowcaseProps } from '$lib/landing/showcase';
  import { beatFor, formatFigure } from '$lib/landing/showcase-motion';
  import {
    appWords,
    constellation,
    contours,
    crates,
    daydreamWords,
    domePanels,
    healthWords,
    hourly,
    labelBox,
    lanterns,
    meteors,
    moon,
    questionSky,
    signposts,
    slitShare,
    stepTrees,
    stringPath,
    walk,
    windows,
    worksWords,
    type Tag,
  } from '$lib/landing/showcase-place';
  import { localToday } from '$lib/constants/health-day';
  import PlaceScene, { type Pin, type PinnedTag } from './PlaceScene.svelte';
  import ObservatoryArt, { OBS } from './ObservatoryArt.svelte';
  import WalkArt, { WALK } from './WalkArt.svelte';
  import HouseArt, { HOUSE } from './HouseArt.svelte';
  import WorksArt, { WORKS } from './WorksArt.svelte';
  import Fingerpost from './Fingerpost.svelte';

  let { data, build, v, now, pulse, steps, cadence, facts }: ShowcaseProps = $props();

  let todayKey = $derived(localToday(new Date(now)));
  // The hero's live sky, so the walk down begins under the same light.
  let heroSky = $derived(skyAt(sunAltitude(now), londonHour(now) < 12));
  const pin = (t: Tag, p: Pin, extra: Partial<PinnedTag> = {}): PinnedTag => ({ ...t, ...p, ...extra });

  /* ------------------------------------------------------- the observatory */

  const STAR_AREA = { x: 352, y: 12, w: 640, h: 372 };
  // Where the struck-out label stands: kept clear, and its crossed star found at its corner.
  const STRUCK_AT = { x: 440, y: 236 };
  let dd = $derived(data.daydream);
  let verdicts = $derived(constellation(dd.impact?.weeks, { x: 600, y: 150, w: 300, h: 110 }));
  let falls = $derived(meteors(dd.impact?.shipped, { x: 372, y: 26, w: 170, h: 50 }));
  let next = $derived(readDaydream(v, facts.daydream, now));
  let weather = $derived(cloud(next, dd.rules.cadenceMinutes));
  // Pins that don't depend on the stars: the stars then keep out from behind their words.
  let ddPins = $derived.by(() => {
    const rated = verdicts.points.filter((p) => p.rate != null);
    const last = rated.at(-1) ?? { x: 900, y: 205 };
    const fall = falls.at(-1);
    return {
      next: { x: OBS.cloud.x, y: OBS.cloud.y + 40, dir: 'side', lead: 20, hang: 'l', tone: 'ink' } as Pin,
      useful: { x: last.x, y: last.y, dir: 'up', lead: 26, hang: 'l', tone: 'ink' } as Pin,
      // On a tablet the next think rides higher and the verdicts' label lower, clear of each other.
      nextN: { y: OBS.cloud.y + 20 },
      usefulN: { lead: 14 },
      dome: { x: OBS.dome.cx - OBS.dome.r * 0.6, y: OBS.dome.cy - OBS.dome.r * 0.8, dir: 'up', lead: 44, hang: 'l', tone: 'accent' } as Pin,
      lookups: { x: OBS.terrace.x - 4, y: OBS.terrace.y + 38, dir: 'side', lead: 24, hang: 'l', tone: 'ink' } as Pin,
      shipped: fall ? ({ x: fall.x2, y: fall.y2, dir: 'down', lead: 14, hang: 'r', tone: 'accent' } as Pin) : null,
    };
  });
  let sky = $derived(
    questionSky(dd.week?.questions ?? null, dd.week?.struckOut ?? null, STAR_AREA, [
      { x: 690, y: 290, w: 200, h: 140 },
      { x: 846, y: 10, w: 154, h: 104 },
      { x: STRUCK_AT.x - 6, y: STRUCK_AT.y + 6, w: 176, h: 70 },
      ...[ddPins.next, ddPins.useful, ddPins.dome, ddPins.lookups, ddPins.shipped].flatMap((p) => (p ? [labelBox(p)] : [])),
    ], [STRUCK_AT.x, STRUCK_AT.y]),
  );
  let ddw = $derived(daydreamWords(dd, sky, next, daydreamTag(next)));
  let ddTags = $derived.by(() => {
    const t = ddw.tags;
    const pn = ddPins;
    const struck = sky.struck[0];
    const out: PinnedTag[] = [
      pin(t.next, pn.next, { narrow: pn.nextN }),
      pin(t.useful, pn.useful, { narrow: pn.usefulN }),
      pin(t.dome, pn.dome),
      pin(t.lookups, pn.lookups),
    ];
    // A real nought struck out is worth saying too: the label stands where the first crossed star would.
    const at = struck ?? STRUCK_AT;
    out.push(pin(t.struck, { x: at.x, y: at.y, dir: 'down', lead: 14, hang: 'r', tone: 'accent' }));
    if (pn.shipped) out.push(pin(t.shipped, pn.shipped));
    return out;
  });

  /* --------------------------------------------------------- the long walk */

  const LINES = contours(15, 18, 548, 11);
  let h = $derived(data.health);
  let path = $derived(walk(h.kmYear));
  let rows = $derived(stepTrees(h.steps30, WALK.trees));
  let lamps = $derived(lanterns(h.recovery30, WALK.string.from, WALK.string.to, WALK.string.sag));
  const STRING = stringPath(WALK.string.from, WALK.string.to, WALK.string.sag);
  let moonLit = $derived(moon(h.sleepAvg7, WALK.moon.cx, WALK.moon.cy, WALK.moon.r - 1.5));
  let bpm = $derived(pulse.state === 'fresh' ? pulse.bpm : null);
  let beat = $derived(beatFor(pulse));
  let spark = $derived(hourly(steps));
  let hw = $derived(
    healthWords(h, { bpm, today: steps?.total ?? null, walkStep: path.step, overInWindow: rows.over, days: 30 }),
  );
  let hTags = $derived.by(() => {
    const by = Object.fromEntries(hw.tags.map((t) => [t.id, t])) as Record<string, Tag>;
    const c = WALK.cottage;
    return [
      pin(by.km, { x: path.start[0], y: path.start[1], dir: 'up', lead: 22, hang: 'r' }),
      pin(by.sleep, { x: WALK.moon.cx - WALK.moon.r, y: WALK.moon.cy, dir: 'side', lead: 18, hang: 'l', tone: 'ink' }),
      pin(by.recovery, { x: lamps[13]?.x ?? 540, y: (lamps[13]?.y ?? WALK.string.from[1]) + 14, dir: 'down', lead: 12, hang: 'r', tone: 'good' }),
      pin(by.over, { x: WALK.trees.x, y: rows.line ?? WALK.trees.y + 40, dir: 'up', lead: 62, hang: 'r', tone: 'ink' }),
      ...(by.today ? [pin(by.today, { x: c.x + c.w / 2, y: c.peak, dir: 'up', lead: 104, hang: 'r' }, { spark })] : []),
    ];
  });

  /* ----------------------------------------------- the house with a light on */

  let a = $derived(data.app);
  let lights = $derived(windows(a.nativeEndpoints, 6, HOUSE.windows));
  let aw = $derived(appWords(a));
  let aTags = $derived.by(() => {
    const by = Object.fromEntries(aw.tags.map((t) => [t.id, t])) as Record<string, Tag>;
    const c = HOUSE.cottage;
    const w = HOUSE.window;
    const ph = HOUSE.phone;
    return [
      // Pinned to the stair housing, off the roof the rambler walks.
      pin(by.areas, { x: HOUSE.block.x + HOUSE.block.w - 23, y: HOUSE.block.y - 16, dir: 'up', lead: 30, hang: 'r' }),
      pin(by.games, { x: c.x + c.w / 2, y: c.wall - 30, dir: 'up', lead: 262, hang: 'l' }, { narrow: { lead: 200 } }),
      pin(by.siri, { x: HOUSE.mast.x - 6, y: HOUSE.mast.top + 6, dir: 'side', lead: 16, hang: 'l', tone: 'ink' }),
      pin(by.phone, { x: ph.x + ph.w / 2, y: ph.y, dir: 'up', lead: 112, hang: 'l' }, { narrow: { wrap: 11 } }),
      pin(by.lock, { x: w.x + w.w, y: w.y, dir: 'up', lead: 104, hang: 'r' }),
      pin(by.watch, { x: HOUSE.watch.x + HOUSE.watch.w, y: HOUSE.watch.y + 6, dir: 'side', lead: 118, hang: 'r', tone: 'good' }),
    ];
  });

  /* ------------------------------------------------------------- the works */

  let recent = $derived(cadence.length ? shipDays(cadence, todayKey, 20) : []);
  let houses = $derived(recent.length ? town(recent) : null);
  let load = $derived(crates(build.deploysToday));
  let builder = $derived(v?.builder ?? null);
  let ww = $derived(worksWords(build, builder));
  let wTags = $derived.by(() => {
    const by = Object.fromEntries(ww.tags.map((t) => [t.id, t])) as Record<string, Tag>;
    const t = WORKS.town;
    const b = houses?.blocks[1];
    const roof = b ? { x: t.x + ((b.x + b.w / 2) / 1000) * t.w, y: t.y + (b.top / 100) * t.h } : { x: t.x + 70, y: WORKS.ground - 4 };
    const s = WORKS.sign;
    const pins: Record<string, Pin> = {
      daydream: { x: WORKS.crane.from + 4, y: WORKS.crane.jib - 16, dir: 'up', lead: 10, hang: 'r', tone: 'ink' },
      today: { x: WORKS.hook.x - 6, y: WORKS.hook.y + 4, dir: 'side', lead: 26, hang: 'l' },
      rate: { x: roof.x, y: roof.y, dir: 'up', lead: 40, hang: 'r' },
      builder: { x: s.x + s.w, y: s.y + s.h / 2, dir: 'side', lead: 14, hang: 'r', tone: 'ink' },
      lines: { x: WORKS.build.x, y: WORKS.build.top - 8, dir: 'up', lead: 14, hang: 'l' },
    };
    // Only the readings that are in: the works leaves the rest out rather than draw dashes.
    return Object.keys(pins).flatMap((k) => (by[k] ? [pin(by[k], pins[k])] : []));
  });

  /* ------------------------------------------------------- the fingerpost */

  let arms = $derived(signposts(v, now, ago));
</script>

<div class="sp" style:--sky-low={heroSky.low}>
  {#if data.fixture}<p class="sp-fixture">preview figures</p>{/if}

  <div class="sp-band" data-band="observatory">
    <PlaceScene
      id="sp-dd"
      side="l"
      h={OBS.h}
      zone={[340, 1000]}
      ground={OBS.ground}
      tone="ink"
      land="#0c1213"
      head={{ ...ddw.head, figure: sky.asked }}
      tags={ddTags}
      key={ddw.key}
      rules={ddw.rules}
      more={{ href: '/projects/engine-room/daydream', cta: 'How Daydream works' }}
    >
      {#snippet art()}
        <ObservatoryArt
          {sky}
          verdicts={verdicts.points}
          line={verdicts.d}
          panels={domePanels(dd.week?.areasCovered, dd.rules.areas)}
          slit={slitShare(dd.week?.hours, dd.rules.activeHours)}
          {falls}
          {weather}
        />
      {/snippet}
    </PlaceScene>
  </div>

  <div class="sp-band" data-band="walk">
    <PlaceScene
      id="sp-hl"
      side="r"
      h={WALK.h}
      zone={[0, 660]}
      ground={WALK.ground}
      tone="accent"
      land="#0e1412"
      head={hw.head}
      spot="gym"
      tags={hTags}
      key={hw.key}
      more={{ href: '/health', cta: 'The whole record' }}
      {beat}
      beatCaption={bpm == null ? '' : `The cottage window glows once a beat, at ${formatFigure(bpm)} bpm.`}
      beatStill={bpm == null ? '' : `The cottage window is lit for a pulse of ${formatFigure(bpm)} bpm.`}
    >
      {#snippet art()}
        <WalkArt
          lines={LINES}
          {path}
          trees={rows.trees}
          tenK={rows.line}
          pitch={rows.pitch}
          {lamps}
          string={STRING}
          {moonLit}
          glow={bpm != null}
        />
      {/snippet}
    </PlaceScene>
  </div>

  <div class="sp-band" data-band="house">
    <PlaceScene
      id="sp-ap"
      side="l"
      h={HOUSE.h}
      zone={[340, 1000]}
      ground={HOUSE.ground}
      tone="accent"
      land="#120e0c"
      head={{ ...aw.head, figure: a.nativeEndpoints }}
      tags={aTags}
      key={aw.key}
      rules={aw.pairing}
      more={{ href: '/projects/engine-room/app', cta: 'How the app works' }}
    >
      {#snippet art()}
        <HouseArt {lights} />
      {/snippet}
    </PlaceScene>
  </div>

  <div class="sp-band" data-band="works">
    <PlaceScene
      id="sp-wk"
      side="r"
      h={WORKS.h}
      zone={[0, 660]}
      ground={WORKS.ground}
      tone="ink"
      last
      head={{ ...ww.head, figure: build.releases }}
      tags={wTags}
      key={ww.key}
      more={{ href: '/projects/engine-room/build', cta: 'How it builds' }}
    >
      {#snippet art()}
        <WorksArt {houses} {load} busy={!!builder?.active} dreamt={(build.fromDaydream ?? 0) > 0} />
      {/snippet}
    </PlaceScene>
  </div>

  <div class="sp-band" data-band="sign">
    <Fingerpost {arms} />
  </div>
</div>

<style>
  .sp {
    --gut: clamp(16px, 4vw, 64px);
    position: relative;
    background: #0b0806;
    color: #ede4d4;
  }
  .sp-fixture {
    position: absolute;
    z-index: 4;
    top: 18px;
    right: max(var(--gut), calc((100% - 1312px) / 2 + var(--gut)));
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  /* One night, walked down through. The first sky starts from the hero's
     live sky and deepens to night over its first few hundred pixels. Each
     scene's ground (PlaceScene's land) runs on to the end of its chapter, and
     the next chapter's sky starts straight behind it, lighter than the land,
     so every chapter boundary is a horizon rather than a seam of ink: deep
     blue over the observatory, a green-grey hillside for the walk, a warm
     dusk behind the house, slate over the works. Only the works' ground ends
     on a hard rule, and the fingerpost stands on the night's own ink. */
  .sp-band {
    background: #0b0806;
  }
  .sp-band[data-band='observatory'] {
    background: linear-gradient(180deg, var(--sky-low, #161114) 0, #0e1517 480px, #0f181b 100%);
  }
  .sp-band[data-band='walk'] {
    background: linear-gradient(180deg, #111916 0, #121a17 60%, #0f1513 100%);
  }
  .sp-band[data-band='house'] {
    background: linear-gradient(180deg, #15100e 0, #1a1210 70%, #22160f 100%);
  }
  .sp-band[data-band='works'] {
    background: linear-gradient(180deg, #11171a 0, #131b1d 70%, #161f20 100%);
  }
  @media print {
    .sp,
    .sp-band,
    .sp-band[data-band] {
      background: none;
      color: #1a1008;
    }
    .sp-fixture {
      position: static;
      padding: 8px 0 0;
      text-align: right;
      color: #1a1008;
    }
  }
</style>
