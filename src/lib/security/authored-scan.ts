const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bprocess\b/, why: 'accesses `process` (env vars, exit, argv)' },
  { pattern: /\brequire\s*\(/, why: 'uses require() to load modules' },
  { pattern: /\bimport\s*\(/, why: 'uses dynamic import()' },
  { pattern: /\beval\s*\(/, why: 'uses eval()' },
  { pattern: /\bFunction\s*\(/, why: 'constructs a Function from a string' },
  // Property access to `constructor` in any spelling the scan can see: dotted
  // (`x.constructor`, `x?.constructor`) or a quoted name (`x['constructor']`).
  // A variable or object key that happens to be called `constructor` is fine
  // and common (F1 data has them), so the bare word is not refused.
  { pattern: /\.\s*constructor\b|['"`]constructor['"`]/, why: 'reaches for .constructor (sandbox escape)' },
  // Computed property names assembled from strings — `x['constr' + 'uctor']`,
  // `x[`${a}${b}`]` — are how the word above gets past a scan. Plain variable
  // indexes (`row[key]`, `arr[i + 1]`) stay legal. A name assembled elsewhere
  // and indexed by variable is not caught; that residue is acceptable only
  // because handlers run in the isolated runner (authored.server.ts) with an
  // empty environment and no network, not in the web process.
  // (Member access only — `[` straight after a name, `)` or `]` — so array
  // literals such as `['a' + b]` are not caught.)
  { pattern: /[\w$)\]]\s*\[[^\]\n]*(?:['"`][^\]\n]*\+|\+\s*['"`])[^\]\n]*\]/, why: 'builds a property name from string pieces (obfuscation risk)' },
  { pattern: /[\w$)\]]\s*\[\s*`/, why: 'uses a template literal as a property name (obfuscation risk)' },
  { pattern: /[\w$)\]]\s*\[[^\]\n]*(?:fromCharCode|fromCodePoint|atob|decodeURI|unescape|join\s*\()/, why: 'computes a property name from decoded characters (obfuscation risk)' },
  { pattern: /\.join\s*\(\s*(['"`])\1\s*\)\s*\]/, why: 'computes a property name by joining strings (obfuscation risk)' },
  { pattern: /__proto__|\bgetPrototypeOf\b|\bReflect\s*\./, why: 'walks the prototype chain' },
  { pattern: /\\x[0-9a-fA-F]{2}|\\u\{?[0-9a-fA-F]{2,}/, why: 'uses escaped characters in strings (obfuscation risk)' },
  { pattern: /\bglobalThis\b/, why: 'touches globalThis' },
  { pattern: /\bchild_process\b/, why: 'references child_process' },
  { pattern: /\bfs\s*\./, why: 'references the filesystem' },
  { pattern: /\breadFile|writeFile\b/, why: 'reads or writes files' },
  { pattern: /\b__dirname|__filename\b/, why: 'references module paths' },
  { pattern: /\bBuffer\s*\.\s*from\s*\([^)]*base64/i, why: 'decodes base64 (obfuscation risk)' },
  { pattern: /\bnew\s+Worker\b/, why: 'spawns a worker thread' },
  { pattern: /\bsetInterval\b/, why: 'schedules recurring work that outlives the call' },
];

export interface StaticScanResult {
  ok: boolean;
  /** Human-readable reasons, safe to show in the ledger and to feed back to the model. */
  violations: string[];
}

/**
 * Deny-list scan of a handler body. Returns every violation rather than the
 * first, so one repair round can fix them all instead of playing whack-a-mole.
 */
export function staticScan(code: string): StaticScanResult {
  const violations: string[] = [];
  if (!code || !code.trim()) {
    return { ok: false, violations: ['handler code is empty'] };
  }
  if (code.length > 20_000) {
    violations.push('handler code exceeds 20k characters');
  }
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(code)) violations.push(why);
  }
  return { ok: violations.length === 0, violations };
}
