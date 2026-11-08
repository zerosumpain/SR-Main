// Background music for sr. tv: one looping track at a time, chosen by what is
// on screen, faded across when that changes. Every track is CC0 (public
// domain, no credit owed), re-encoded to 80 kbps MP3 in static/tv-music/:
//
//   menu   "Chill lofi inspired" — omfgdude      opengameart.org/content/chill-lofi-inspired
//   lobby  "Bossa Nova" (8bit Bossa) — joth      opengameart.org/content/bossa-nova
//   board  "Town Theme RPG" — cynicmusic         opengameart.org/content/town-theme-rpg
//   quick  "Chiptune Adventures: Stage 2" — Juhani Junkala   opengameart.org/content/4-chiptunes-adventure
//
// The Android shell lets the page play without a tap first. Off is
// remembered per TV in localStorage. Plain DOM, no reactive state
// (svelte5-pitfalls §1).

export type Track = 'menu' | 'lobby' | 'board' | 'quick';

/** Games played against the clock get the quick track; the rest think to the board one. */
const QUICK_GAMES = new Set(['snap-happy', 'biscuit-tower']);

const VOLUME = 0.25;
const FADE_MS = 1_200;
const OFF_KEY = 'sr-tv-music-off';

/** The track for what the TV is showing: a running game, the lobby, or the menu. */
export function trackFor(view: string, game: string | null, playing: boolean): Track {
  if (playing && game) return QUICK_GAMES.has(game) ? 'quick' : 'board';
  return view === 'lobby' ? 'lobby' : 'menu';
}

export function musicOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export class TvMusic {
  private audio: HTMLAudioElement | null = null;
  private track: Track | null = null;
  private fade: ReturnType<typeof setInterval> | null = null;
  private off = musicOff();

  /** Play `track` (fading out whatever was on), unless the music is off. */
  play(track: Track): void {
    if (this.track === track && this.audio) return;
    this.track = track;
    if (this.off) return;
    const old = this.audio;
    const next = new Audio(`/tv-music/${track}.mp3`);
    next.loop = true;
    next.volume = 0;
    this.audio = next;
    // A browser that still wants a tap first just stays quiet.
    void next.play().catch(() => {});
    this.ramp(old, next);
  }

  /** Turn the music on or off; returns whether it is now off. */
  toggle(): boolean {
    this.off = !this.off;
    try {
      localStorage.setItem(OFF_KEY, this.off ? '1' : '0');
    } catch {
      // A TV without storage forgets the choice; the music still stops.
    }
    if (this.off) {
      this.stopAll();
    } else if (this.track) {
      const track = this.track;
      this.track = null;
      this.play(track);
    }
    return this.off;
  }

  stop(): void {
    this.stopAll();
    this.track = null;
  }

  private ramp(from: HTMLAudioElement | null, to: HTMLAudioElement): void {
    if (this.fade) clearInterval(this.fade);
    const started = Date.now();
    const fromVolume = from?.volume ?? 0;
    this.fade = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / FADE_MS);
      to.volume = VOLUME * t;
      if (from) from.volume = fromVolume * (1 - t);
      if (t === 1) {
        if (this.fade) clearInterval(this.fade);
        this.fade = null;
        from?.pause();
      }
    }, 50);
  }

  private stopAll(): void {
    if (this.fade) clearInterval(this.fade);
    this.fade = null;
    this.audio?.pause();
    this.audio = null;
  }
}
