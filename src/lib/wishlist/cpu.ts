// A CPU's place in the value score, written down the way `gpu.ts` writes down
// GPUs: a judgement, in code, where it can be read and argued with.
//
// Scores are APPROXIMATE relative GAMING performance (Ryzen 7 9800X3D = 100),
// rounded from the usual review aggregates as of late 2026. A gaming PC's frame
// rate is mostly its GPU's, so the value score weights this well below the GPU
// (see `value.ts`); it only has to separate a Ryzen 5 5500 box from a 7800X3D
// one at the same price. An "F" (no integrated graphics) scores as its non-F
// twin. Laptop parts ("7840HS", "13650HX") match no pattern and are not ranked.

const SCORES: Record<string, number> = {
  // AMD AM4
  'RYZEN 5500': 45, 'RYZEN 5600': 50, 'RYZEN 5600X': 52, 'RYZEN 5600X3D': 64, 'RYZEN 5700': 52,
  'RYZEN 5700X': 55, 'RYZEN 5800X': 57, 'RYZEN 5700X3D': 66, 'RYZEN 5800X3D': 68, 'RYZEN 5900X': 58,
  'RYZEN 5950X': 59,
  // AMD AM5
  'RYZEN 7500F': 64, 'RYZEN 7600': 65, 'RYZEN 7600X': 67, 'RYZEN 7700': 70, 'RYZEN 7700X': 71,
  'RYZEN 7800X3D': 90, 'RYZEN 7900': 70, 'RYZEN 7900X': 72, 'RYZEN 7950X': 75, 'RYZEN 7950X3D': 90,
  'RYZEN 8400F': 56, 'RYZEN 8500G': 52, 'RYZEN 8600G': 58, 'RYZEN 8700F': 66, 'RYZEN 8700G': 62,
  'RYZEN 9600': 70, 'RYZEN 9600X': 71, 'RYZEN 9700X': 74, 'RYZEN 9800X3D': 100, 'RYZEN 9900X': 75,
  'RYZEN 9900X3D': 92, 'RYZEN 9950X': 77, 'RYZEN 9950X3D': 99,
  // Intel 12th–14th gen
  'I3-12100': 45, 'I3-13100': 47, 'I3-14100': 48, 'I5-12400': 53, 'I5-13400': 58, 'I5-14400': 60,
  'I5-12600K': 62, 'I5-13600K': 72, 'I5-14600K': 74, 'I7-12700': 64, 'I7-12700K': 68, 'I7-13700': 72,
  'I7-13700K': 78, 'I7-14700': 75, 'I7-14700K': 80, 'I9-12900K': 72, 'I9-13900K': 82, 'I9-14900K': 84,
  // Intel Core Ultra 200S
  'ULTRA 5 225': 58, 'ULTRA 5 245K': 68, 'ULTRA 7 265K': 76, 'ULTRA 9 285K': 80,
};

const RYZEN = /\bryzen\s*(?:[3579]\s+)?(\d{4})(x3d|x|g|f)?(?![a-z0-9])/i;
const CORE_I = /\b(?:core\s*)?i([3579])[\s-]*(\d{5})(kf|k|f)?(?![a-z0-9])/i;
const ULTRA = /\b(?:core\s*)?ultra\s*([579])\s*(\d{3})(kf|k|f)?(?![a-z0-9])/i;

/** Canonical name for a CPU mention, e.g. "AMD Ryzen 5 7500F" → "RYZEN 7500F". */
export function canonicalCpu(text: string): string | null {
  const r = RYZEN.exec(text);
  if (r) {
    const name = `RYZEN ${r[1]}${(r[2] ?? '').toUpperCase()}`;
    // "7500F" exists only as an F; "5600F"-style rebadges score as the base part.
    return SCORES[name] !== undefined ? name : name.replace(/F$/, '');
  }
  const i = CORE_I.exec(text);
  if (i) return `I${i[1]}-${i[2]}${(i[3] ?? '').toUpperCase().replace(/F$/, '')}`;
  const u = ULTRA.exec(text);
  if (u) return `ULTRA ${u[1]} ${u[2]}${(u[3] ?? '').toUpperCase().replace(/F$/, '')}`;
  return null;
}

export interface CpuReading {
  name: string;
  score: number | null;
}

/** The CPU a listing names — title first, as with the GPU. */
export function parseCpu(title: string, description = ''): CpuReading | null {
  const name = canonicalCpu(title) ?? canonicalCpu(description);
  return name ? { name, score: SCORES[name] ?? null } : null;
}
