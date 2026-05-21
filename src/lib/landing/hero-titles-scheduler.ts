import { generateHeroTitles, heroTitlesCount } from './hero-titles-service';

let interval: ReturnType<typeof setInterval> | undefined;
let running = false;

const DEFAULT_MS = 7 * 24 * 60 * 60 * 1000; // weekly

export function startHeroTitlesScheduler(): void {
  if (running) return;
  running = true;
  const ms = parseInt(process.env.HERO_TITLES_REGEN_MS || String(DEFAULT_MS), 10);
  console.log(`[hero-titles] regeneration every ${Math.round(ms / 3_600_000)}h`);

  // Let the app finish booting, then generate immediately only if the table
  // is empty (cold start). Otherwise wait one full interval.
  setTimeout(async () => {
    try {
      const count = await heroTitlesCount();
      if (count === 0) {
        console.log('[hero-titles] table empty — generating initial set');
        const res = await generateHeroTitles();
        console.log('[hero-titles] initial generation done', res);
      }
    } catch (e) {
      console.error('[hero-titles] startup check failed', e);
    }
    interval = setInterval(() => {
      generateHeroTitles()
        .then((res) => console.log('[hero-titles] scheduled regeneration done', res))
        .catch((e) => console.error('[hero-titles] scheduled regeneration failed', e));
    }, ms);
  }, 30_000);
}

export function stopHeroTitlesScheduler(): void {
  if (interval) clearInterval(interval);
  interval = undefined;
  running = false;
}
