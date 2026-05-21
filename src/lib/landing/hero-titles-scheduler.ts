import { generateHeroTitles, heroTitlesCount } from './hero-titles-service';
import { enumerateGrid } from './hero-titles-buckets';

let interval: ReturnType<typeof setInterval> | undefined;
let startTimeout: ReturnType<typeof setTimeout> | undefined;
let running = false;

const DEFAULT_MS = 7 * 24 * 60 * 60 * 1000; // weekly

export function startHeroTitlesScheduler(): void {
  if (running) return;
  running = true;

  // Guard against a bad env value — a NaN interval would make setInterval
  // fire as fast as possible, hammering the LLM with ~150 calls in a loop.
  const raw = parseInt(process.env.HERO_TITLES_REGEN_MS || '', 10);
  const ms = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MS;
  console.log(`[hero-titles] regeneration every ${Math.round(ms / 3_600_000)}h`);

  // Let the app finish booting, then generate if the set is incomplete —
  // a cold-start empty table, or a partial set left behind when a deploy
  // restarted the service mid-generation. A complete set waits for the
  // next interval.
  startTimeout = setTimeout(async () => {
    startTimeout = undefined;
    try {
      const count = await heroTitlesCount();
      const expected = enumerateGrid().length;
      if (count < expected) {
        console.log(`[hero-titles] set incomplete (${count}/${expected}) — generating`);
        const res = await generateHeroTitles();
        console.log('[hero-titles] startup generation done', res);
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
  if (startTimeout) clearTimeout(startTimeout);
  startTimeout = undefined;
  if (interval) clearInterval(interval);
  interval = undefined;
  running = false;
}
