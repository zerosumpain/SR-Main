import { describe, it, expect } from 'vitest';
import { GATE_NAMES, normaliseGate, gateNodePath, isGatePath, gateSeedToPath } from './gates';

describe('normalising the gate vocabulary', () => {
  /*
   * The five values production actually held across 108 episodes:
   * vitest 95, typecheck 5, cmd 4, svelte-check 3, and one literal 'gate'.
   * Two of those are junk that a SELECT DISTINCT would have turned into nodes.
   */
  it('maps the spellings production actually contains', () => {
    expect(normaliseGate('vitest')).toBe('vitest');
    expect(normaliseGate('typecheck')).toBe('typecheck');
    expect(normaliseGate('svelte-check')).toBe('svelte-check');
    expect(normaliseGate('cmd')).toBe('cmd');
    expect(normaliseGate('gate')).toBe('gate');
  });

  it('folds aliases onto one node, which is the whole point', () => {
    expect(normaliseGate('tsc')).toBe('typecheck');
    expect(normaliseGate('type-check')).toBe('typecheck');
    expect(normaliseGate('sveltecheck')).toBe('svelte-check');
    expect(normaliseGate('svelte_check')).toBe('svelte-check');
    expect(normaliseGate('jest')).toBe('vitest');
    expect(normaliseGate('eslint')).toBe('lint');
    expect(normaliseGate('vite-build')).toBe('build');
  });

  it('tolerates the shapes a human or an agent actually types', () => {
    expect(normaliseGate('  VITEST ')).toBe('vitest');
    expect(normaliseGate('gate:typecheck')).toBe('typecheck');
    expect(normaliseGate('Svelte Check')).toBe('svelte-check');
  });

  it('falls back to cmd rather than null', () => {
    // An episode with no gate node is one the `gate:` lane can never reach,
    // which is the bug this module exists to fix. Every episode gets a node.
    expect(normaliseGate('something-nobody-named')).toBe('cmd');
    expect(normaliseGate(null)).toBe('cmd');
    expect(normaliseGate('')).toBe('cmd');
    expect(normaliseGate(undefined)).toBe('cmd');
  });

  it('only ever returns a name from the declared set', () => {
    for (const raw of ['vitest', 'tsc', 'nonsense', '', 'gate:lint', 'BUILD']) {
      expect(GATE_NAMES).toContain(normaliseGate(raw));
    }
  });
});

describe('gate node paths', () => {
  it('namespaces so a gate can never collide with a repo file', () => {
    // canonical_path is unique per repo across every kind, so a repo containing
    // a file literally called `vitest` must not merge with the vitest gate.
    expect(gateNodePath('vitest')).toBe('gate:vitest');
    expect(gateNodePath('tsc')).toBe('gate:typecheck');
    expect(isGatePath('gate:vitest')).toBe(true);
    expect(isGatePath('src/lib/vitest.ts')).toBe(false);
  });

  it('sends a CGQL seed through the SAME normaliser as ingest', () => {
    // Otherwise the lane resolves for the spellings we happened to store and
    // silently misses the rest — a quieter version of the bug it replaces.
    expect(gateSeedToPath('tsc')).toBe(gateNodePath('typecheck'));
    expect(gateSeedToPath('svelte_check')).toBe(gateNodePath('svelte-check'));
    expect(gateSeedToPath('gate:vitest')).toBe(gateNodePath('vitest'));
  });
});
