// Synthetic data generator — produces rows that conform to the designed schema,
// so a team can test a standard before any real data exists. Fully deterministic
// (seeded PRNG) so a given seed reproduces the same data; identifier- and
// codelist-aware so values look right (valid-format NHS numbers, codes drawn
// from the actual permissible-value lists). Generating 10,000 rows is pure
// in-browser computation — the LLM is only used (optionally) to enrich realism
// via per-field sample pools, never to emit the bulk rows.

import type { Field } from './types';
import { codelistById } from './codelists';

// ---- deterministic PRNG (mulberry32) ----
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Rng = () => number;
const pick = <T>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const intBetween = (rng: Rng, lo: number, hi: number) => Math.floor(rng() * (hi - lo + 1)) + lo;
const pad = (n: number, len: number) => String(n).padStart(len, '0');

// ---- value pools (small, indicative — the LLM can enrich) ----
const FIRST = ['Olivia', 'Noah', 'Amara', 'Liam', 'Aisha', 'Mohammed', 'Sophie', 'Jacob', 'Mia', 'Kai', 'Freya', 'Leon', 'Zara', 'Oscar', 'Ivy', 'Reuben', 'Nia', 'Theo', 'Esme', 'Idris'];
const LAST = ['Okafor', 'Smith', 'Patel', 'Jones', 'Begum', 'Murphy', 'Khan', 'Williams', 'Nguyen', 'Brown', 'Ali', 'Taylor', 'Owusu', 'Walsh', 'Kaur', 'Evans', 'Adeyemi', 'Clarke'];
const TOWNS = ['Darlington', 'Camden', 'Bolton', 'Hackney', 'Leeds', 'Plymouth', 'Norwich', 'Dudley', 'Salford', 'Reading', 'Hull', 'Bristol'];
const SERVICE_WORDS = ['Family', 'Youth', 'Community', 'Early Help', 'Wellbeing', 'Support', 'Advice', 'Outreach', 'Counselling', 'Mentoring', 'Parenting', 'Inclusion'];
const ORG_WORDS = ['Trust', 'Foundation', 'Partnership', 'Network', 'Council', 'Centre', 'Hub', 'Alliance', 'Project'];

// ---- identifier generators (format-plausible synthetic values) ----
function nhsNumber(rng: Rng): string {
  // 9 random digits + Modulus-11 check digit; regenerate if check === 10.
  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = Array.from({ length: 9 }, () => intBetween(rng, 0, 9));
    const sum = digits.reduce((acc, d, i) => acc + d * (10 - i), 0);
    const rem = sum % 11;
    const check = 11 - rem;
    if (check === 11) return digits.join('') + '0';
    if (check !== 10) return digits.join('') + String(check);
  }
  return '9990000018'; // a known-valid fallback
}
function upn(rng: Rng): string {
  // 13 chars: check letter (A–Z) + 12 digits (LA(3)+estab(4)+year+serial). Format-plausible only.
  const letters = 'ABCDEFGHJKLMNPQRTUVWXYZ';
  return pick(rng, letters.split('')) + pad(intBetween(rng, 100, 999), 3) + pad(intBetween(rng, 1000, 9999), 4) + pad(intBetween(rng, 0, 99999), 5);
}
function uprn(rng: Rng): string { return String(intBetween(rng, 10000000000, 99999999999)); }
function gssCode(rng: Rng): string { return 'E0' + pad(intBetween(rng, 6000000, 9999999), 7); }
function urn(rng: Rng): string { return pad(intBetween(rng, 100000, 149999), 6); }
function ukprn(rng: Rng): string { return '1' + pad(intBetween(rng, 0, 9999999), 7); }
function uln(rng: Rng): string { return String(intBetween(rng, 1000000000, 9999999999)); }
function odsCode(rng: Rng): string { return pick(rng, 'ABCDEFGHJKLMNPRTVWXY'.split('')) + pad(intBetween(rng, 10000, 99999), 5); }
function companyNo(rng: Rng): string { return pad(intBetween(rng, 1000000, 13999999), 8); }
function trn(rng: Rng): string { return pad(intBetween(rng, 1000000, 9999999), 7); }
function laEstab(rng: Rng): string { return pad(intBetween(rng, 200, 938), 3) + '/' + pad(intBetween(rng, 2000, 7999), 4); }

const IDENTIFIER_GEN: Record<string, (rng: Rng) => string> = {
  'nhs-number': nhsNumber,
  upn,
  uprn,
  usrn: (rng) => pad(intBetween(rng, 10000000, 99999999), 8),
  'gss-code': gssCode,
  urn,
  ukprn,
  uln,
  'ods-code': odsCode,
  'companies-house-number': companyNo,
  trn,
  'la-estab': laEstab,
  'ni-number': (rng) => pick(rng, 'ABCEGHJ'.split('')) + pick(rng, 'ABCEGHJ'.split('')) + pad(intBetween(rng, 0, 999999), 6) + pick(rng, 'ABCD'.split('')),
  'consistent-child-identifier': nhsNumber,
};

function isoDate(rng: Rng, fromYear: number, toYear: number): string {
  const y = intBetween(rng, fromYear, toYear);
  const m = intBetween(rng, 1, 12);
  const d = intBetween(rng, 1, 28);
  return `${y}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** Generate a single field value for a row, given the field, an rng, and any
 *  LLM-supplied sample pool keyed by field name. */
function genValue(field: Field, rng: Rng, pools: Record<string, string[]>): unknown {
  const name = (field.name || '').toLowerCase();
  const title = (field.title || '').toLowerCase();

  // LLM-enriched sample pool wins for realism, where provided.
  const pool = pools[field.name];
  if (pool && pool.length && field.type !== 'identifier' && !field.codelistId) return pick(rng, pool);

  // codelist → draw a real permissible value
  const cl = codelistById(field.codelistId);
  if (cl && cl.values.length) {
    if (field.type === 'array') {
      const k = intBetween(rng, 1, Math.min(3, cl.values.length));
      const shuffled = [...cl.values].sort(() => rng() - 0.5).slice(0, k).map((v) => v.code);
      return shuffled;
    }
    return pick(rng, cl.values).code;
  }

  // identifier → format-plausible synthetic id
  if (field.identifier && IDENTIFIER_GEN[field.identifier]) return IDENTIFIER_GEN[field.identifier](rng);
  if (field.type === 'identifier') return `${(field.name || 'rec').toUpperCase().slice(0, 4)}-${pad(intBetween(rng, 0, 999999), 6)}`;

  switch (field.type) {
    case 'boolean':
      return rng() < 0.5;
    case 'integer':
      return intBetween(rng, 0, 1000);
    case 'number':
      return Math.round(rng() * 10000) / 100;
    case 'currency':
      return Math.round(rng() * 500000) / 100;
    case 'date':
      return /birth|dob/.test(name + title) ? isoDate(rng, 2007, 2021) : isoDate(rng, 2023, 2026);
    case 'datetime':
      return `${isoDate(rng, 2024, 2026)}T${pad(intBetween(rng, 0, 23), 2)}:${pad(intBetween(rng, 0, 59), 2)}:00Z`;
    case 'geo':
      return `${(51 + rng() * 2).toFixed(5)},${(-2 + rng() * 2).toFixed(5)}`;
    case 'enum':
      return pick(rng, ['A', 'B', 'C']);
    case 'array':
      return [pick(rng, SERVICE_WORDS)];
    default: {
      // string — infer from the name
      if (/first.?name|forename/.test(name)) return pick(rng, FIRST);
      if (/last.?name|surname|family.?name/.test(name)) return pick(rng, LAST);
      if (/\bname\b/.test(name) && /service/.test(name)) return `${pick(rng, TOWNS)} ${pick(rng, SERVICE_WORDS)} Service`;
      if (/organisation|provider|agency|org/.test(name)) return `${pick(rng, TOWNS)} ${pick(rng, ORG_WORDS)}`;
      if (/town|city|area|locality/.test(name)) return pick(rng, TOWNS);
      if (/postcode/.test(name)) return `${pick(rng, ['DL', 'NW', 'BL', 'LS', 'PL'])}${intBetween(rng, 1, 20)} ${intBetween(rng, 1, 9)}${pick(rng, 'ABDEFGH'.split(''))}${pick(rng, 'ABDEFGH'.split(''))}`;
      if (/email/.test(name)) return `${pick(rng, FIRST).toLowerCase()}.${pick(rng, LAST).toLowerCase()}@example.org`;
      return `${field.title || 'value'} ${intBetween(rng, 1, 999)}`;
    }
  }
}

export interface SynthOptions {
  rows: number;
  seed?: number;
  /** Optional LLM-supplied realistic sample pools, keyed by field machine name. */
  pools?: Record<string, string[]>;
}

const machine = (f: Field) => (f.name || f.title || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function generateRows(fields: Field[], opts: SynthOptions): Record<string, unknown>[] {
  const pools = opts.pools || {};
  const baseSeed = opts.seed ?? 1;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < opts.rows; i++) {
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      // a per-row, per-field rng so values are independent yet reproducible
      const rng = makeRng((baseSeed * 2654435761 + i * 40503 + hashStr(f.id || f.name)) >>> 0);
      row[machine(f)] = genValue(f, rng, pools);
    }
    out.push(row);
  }
  return out;
}

export function rowsToCsv(fields: Field[], rows: Record<string, unknown>[]): string {
  const cols = fields.map(machine);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join(';') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  return lines.join('\n');
}

export function rowsToJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

export const ROW_OPTIONS = [10, 100, 1000, 10000];
