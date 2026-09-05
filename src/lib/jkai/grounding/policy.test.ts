import { describe, it, expect } from 'vitest';
import { BEHAVIOUR_POLICY } from './policy';
import { compilePromptFiles, promptIdentity } from '$lib/workflows/prompts/loader';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
vi.mock('$lib/db', () => ({ db: {} }));
describe('effective policy', () => {
  it('compiles the authoritative contract after local guidance and fingerprints changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jkai-policy-'));
    try {
      writeFileSync(join(dir, '01.md'), 'local policy');
      const first = compilePromptFiles(dir).compiled;
      expect(first.endsWith(BEHAVIOUR_POLICY)).toBe(true);
      writeFileSync(join(dir, '01.md'), 'changed policy');
      expect(promptIdentity(first)).not.toBe(promptIdentity(compilePromptFiles(dir).compiled));
    } finally { rmSync(dir, { recursive: true }); }
  });
});
