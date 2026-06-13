// ─────────────────────────────────────────────────────────────────────────
//  Terminal Descent — AUTHORITATIVE server-side scoring + plausibility.
//
//  This is the trusted half of the leaderboard's anti-cheat: the client never
//  sends a score, only telemetry, and we recompute the score here from that
//  telemetry plus difficulty constants the client cannot influence.
//
//  KEEP IN LOCKSTEP with the game bundle:
//    ~/space-lander/src/config.js   (DIFFICULTY, LAND, SCORE)
//    ~/space-lander/src/scoring.js  (computeScore)
// ─────────────────────────────────────────────────────────────────────────

export type Difficulty = 'cadet' | 'pilot' | 'ace';

export const DIFFICULTY: Record<Difficulty, { gravity: number; mainThrust: number; fuel: number; padRadius: number; scoreMult: number }> = {
  cadet: { gravity: 2.6, mainThrust: 9.0, fuel: 1400, padRadius: 9, scoreMult: 1.0 },
  pilot: { gravity: 3.3, mainThrust: 9.9, fuel: 1050, padRadius: 6.5, scoreMult: 1.6 },
  ace: { gravity: 4.2, mainThrust: 11.3, fuel: 820, padRadius: 4.6, scoreMult: 2.4 },
};

// Explicit allow-list. NEVER use `key in DIFFICULTY` for validation — that is
// true for inherited Object.prototype members ('toString', etc.), which would
// let a poisoned `difficulty` slip past the gate and read `undefined` limits.
export const DIFFICULTIES = ['cadet', 'pilot', 'ace'] as const;
export function isDifficulty(d: unknown): d is Difficulty {
  return typeof d === 'string' && (DIFFICULTIES as readonly string[]).includes(d);
}
function ownDiff(difficulty: string) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTY, difficulty)
    ? DIFFICULTY[difficulty as Difficulty]
    : undefined;
}

export const LAND = {
  perfectVert: 1.0,
  safeVert: 3.0,
  hardVert: 5.0,
  perfectHoriz: 0.8,
  safeHoriz: 2.6,
  hardHoriz: 4.0,
  perfectTilt: (3 * Math.PI) / 180,
  safeTilt: (12 * Math.PI) / 180,
  hardTilt: (20 * Math.PI) / 180,
  perfectAng: 0.09,
  hardAng: 0.52,
};

export const SCORE = {
  touchdown: 3500,
  centering: 2500,
  fuel: 1500,
  upright: 800,
  efficiency: 700,
  bullseye: 1000,
  fuelFloor: 0.3,
  fuelCeil: 0.85,
  fuelExp: 1.5,
  efficiencyFullUnderSec: 18,
  efficiencyZeroOverSec: 110,
  cap: 24000,
};

// Main-engine burn rate (units/s at full throttle) — used for fuel-consistency.
const MAIN_BURN = 26;

export interface Telemetry {
  vy: number; // |vertical impact speed| m/s
  vx: number; // horizontal impact speed m/s
  tiltRad: number; // rad
  angVelMag: number; // rad/s
  padOffset: number; // m to pad centre
  fuelStart: number;
  fuelRemaining: number;
  tElapsed: number; // s
  seed?: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const soft01 = (x: number, perfect: number, hard: number) => clamp01((hard - x) / (hard - perfect));

export function computeScore(t: Telemetry, difficulty: Difficulty) {
  const diff = ownDiff(difficulty) ?? DIFFICULTY.pilot;
  const padRadius = diff.padRadius;
  const fuelFrac = diff.fuel > 0 ? clamp01(t.fuelRemaining / diff.fuel) : 0;
  const centerDistFrac = padRadius > 0 ? t.padOffset / padRadius : 1;

  const sVy = soft01(Math.abs(t.vy), LAND.perfectVert, LAND.hardVert);
  const sVx = soft01(t.vx, LAND.perfectHoriz, LAND.hardHoriz);
  const sAng = soft01(t.angVelMag ?? 0, LAND.perfectAng, LAND.hardAng);
  const touchdownN = 0.65 * sVy + 0.2 * sVx + 0.15 * sAng;

  const centeringN = clamp01(1 - centerDistFrac);
  const fuelN = Math.pow(clamp01((fuelFrac - SCORE.fuelFloor) / (SCORE.fuelCeil - SCORE.fuelFloor)), SCORE.fuelExp);
  const uprightN = clamp01(1 - t.tiltRad / LAND.safeTilt);
  const efficiencyN = clamp01(
    (SCORE.efficiencyZeroOverSec - t.tElapsed) / (SCORE.efficiencyZeroOverSec - SCORE.efficiencyFullUnderSec),
  );
  const bullseyeN = sVy * sVx * uprightN * centeringN;

  const subtotal =
    SCORE.touchdown * touchdownN +
    SCORE.centering * centeringN +
    SCORE.fuel * fuelN +
    SCORE.upright * uprightN +
    SCORE.efficiency * efficiencyN +
    SCORE.bullseye * bullseyeN;
  const total = Math.min(SCORE.cap, Math.round(subtotal * diff.scoreMult));

  const isPerfect =
    Math.abs(t.vy) <= LAND.perfectVert &&
    t.vx <= LAND.perfectHoriz &&
    t.tiltRad <= LAND.perfectTilt &&
    (t.angVelMag ?? 0) <= LAND.perfectAng &&
    centeringN > 0.9;

  return { total, tier: isPerfect ? 'bullseye' : 'safe', fuelFrac, centerDistFrac };
}

// Physics-calibrated plausibility gate. Returns null if OK, else a reason.
export function validateTelemetry(t: Telemetry, difficulty: Difficulty): string | null {
  const diff = ownDiff(difficulty);
  if (!diff) return 'unknown difficulty';

  const nums = [t.vy, t.vx, t.tiltRad, t.angVelMag, t.padOffset, t.fuelStart, t.fuelRemaining, t.tElapsed];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return 'non-finite telemetry';
  if (t.vy < 0 || t.vx < 0 || t.tiltRad < 0 || t.padOffset < 0 || t.tElapsed < 0) return 'negative telemetry';

  // A valid SCORED landing must be on the pad, within the survivable ceilings.
  if (t.padOffset > diff.padRadius + 0.01) return 'off-pad';
  if (Math.abs(t.vy) > LAND.hardVert + 0.01) return 'vertical speed beyond survivable';
  if (t.vx > LAND.hardHoriz + 0.01) return 'horizontal speed beyond survivable';
  if (t.tiltRad > LAND.hardTilt + 0.01) return 'tilt beyond survivable';

  // Fuel sanity.
  if (t.fuelStart <= 0 || Math.abs(t.fuelStart - diff.fuel) > 1) return 'fuel capacity mismatch';
  if (t.fuelRemaining < 0 || t.fuelRemaining > t.fuelStart) return 'fuel out of range';
  const fuelFrac = t.fuelRemaining / t.fuelStart;
  // Best achievable fuel fraction is bounded by gravity (more g → more burn).
  const maxFuelFrac = difficulty === 'cadet' ? 0.93 : difficulty === 'pilot' ? 0.89 : 0.84;
  if (fuelFrac > maxFuelFrac) return 'implausible fuel surplus';

  // Time bounds: a free-fall floor (no landing is faster) + an AFK ceiling.
  if (t.tElapsed < 7) return 'flight too short';
  if (t.tElapsed > 600) return 'flight too long';

  // Burn consistency: fuel actually spent must be physically reachable and not
  // exceed full-throttle burn over the whole flight.
  const spent = t.fuelStart - t.fuelRemaining;
  if (spent < 0) return 'negative burn';
  if (spent > MAIN_BURN * t.tElapsed + 5) return 'burned more fuel than physically possible';

  return null;
}
