const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bprocess\b/, why: 'accesses `process` (env vars, exit, argv)' },
  { pattern: /\brequire\s*\(/, why: 'uses require() to load modules' },
  { pattern: /\bimport\s*\(/, why: 'uses dynamic import()' },
  { pattern: /\beval\s*\(/, why: 'uses eval()' },
  { pattern: /\bFunction\s*\(/, why: 'constructs a Function from a string' },
  { pattern: /\.constructor\s*[([]/, why: 'reaches for .constructor (sandbox escape)' },
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
