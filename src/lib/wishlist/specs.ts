// Reading a listing's specs from its own words. PURE and deterministic: the
// same title always yields the same specs, so a verdict can be re-derived and
// shown its working. No model is involved — deal titles are written to be
// scanned ("32GB DDR5 | RTX 5060 Ti | 1TB NVMe"), and a regex reads that more
// reliably than a model asked to summarise it.

import { parseGpu, type GpuReading } from './gpu';

export interface Specs {
  gpu: GpuReading | null;
  ramGb: number | null;
  ramType: string | null;
  storageGb: number | null;
}

// RAM is the GB figure next to "RAM"/"memory"/"DDRn", never the GPU's VRAM
// ("RTX 5060 Ti 8GB") or storage ("1TB SSD"). Both orders are written in the
// wild: "32GB DDR5 RAM" and "RAM: 16GB".
const RAM_AFTER = /(\d{1,3})\s*gb\s*(?:of\s*)?(?:(ddr\d)[^\s,|]*\s*)?(?:ram|memory)\b/i;
const RAM_DDR = /(\d{1,3})\s*gb\s*(ddr\d)/i;
const RAM_BEFORE = /\b(?:ram|memory)\s*[:\-]?\s*(\d{1,3})\s*gb/i;
const DDR = /\b(ddr\d)\b/i;
const STORAGE = /(\d+(?:\.\d+)?)\s*(tb|gb)\s*(?:nvme|ssd|m\.2|hdd|storage)/i;

export function parseRam(text: string): { gb: number | null; type: string | null } {
  let gb: number | null = null;
  let type: string | null = null;
  const ddrForm = RAM_DDR.exec(text);
  const after = RAM_AFTER.exec(text);
  const before = RAM_BEFORE.exec(text);
  if (ddrForm) {
    gb = Number(ddrForm[1]);
    type = ddrForm[2].toUpperCase();
  } else if (after) {
    gb = Number(after[1]);
    if (after[2]) type = after[2].toUpperCase();
  } else if (before) {
    gb = Number(before[1]);
  }
  if (!type) {
    // A bare "DDR5" elsewhere in the listing is still the system RAM's type —
    // GPU memory is GDDR, which the word boundary in DDR excludes.
    const d = DDR.exec(text);
    if (d) type = d[1].toUpperCase();
  }
  // Plausibility: system RAM in a desktop is 4–256GB in powers-of-two-ish steps.
  if (gb !== null && (gb < 4 || gb > 256)) gb = null;
  return { gb, type };
}

export function parseStorageGb(text: string): number | null {
  const m = STORAGE.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'tb' ? Math.round(n * 1000) : Math.round(n);
}

export function readSpecs(title: string, description = ''): Specs {
  const text = `${title}\n${description}`;
  const ram = parseRam(text);
  return {
    gpu: parseGpu(title, description),
    ramGb: ram.gb,
    ramType: ram.type,
    storageGb: parseStorageGb(text),
  };
}

/**
 * "£1,099.99" / "1099" / "£999" → pence. Null for anything that is not a
 * plain sterling figure — "FREE", "€", a range. Used on deal text only; the
 * structured sources hand over numbers.
 */
export function parsePounds(text: string): number | null {
  const m = /£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/.exec(text);
  if (!m) return null;
  const pounds = Number(m[1].replace(/,/g, ''));
  const pence = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return pounds * 100 + pence;
}

/** A structured amount ("1099.00", 1099) → pence, or null. */
export function amountToPence(amount: unknown): number | null {
  const n = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
