// Regression harness: every template-bearing node config in production (redacted
// fixture) must resolve to exactly what it did before the engine-level resolver.
//
// OLD = the pre-change pipeline, preserved verbatim in ./legacy-*.ts: the engine
//       resolved {{state}}/{{today}}/{{now}}, then the executor ran
//       interpolateTemplateStrict over the field against the merged input.
// NEW = resolveNodeConfig (the engine hook, with the REAL node definition's
//       typed/raw keys), then the executor's (now no-op) helper.
//
// Synthetic inputs are generated from each config's own references and cycle
// through the shapes that matter: plain strings, numbers, data that itself
// contains `{{...}}` (must never be re-resolved), objects (embed as JSON), null
// (present-but-empty) and absent (missing → '' plus the strict missing list).
import { describe, it, expect } from 'vitest';
import fixture from '../../../fixtures/workflow-templates/prod-node-configs.json';
import { getDefinition } from '$lib/workflows/registry-client';
import { resolveNodeConfig } from '$lib/workflows/engine-node-runner';
import { interpolateTemplateStrict } from '$lib/workflows/nodes/template';
import { buildGraph } from '$lib/workflows/graph';
import { resolveStateTemplatesString } from './legacy-state-templates';
import { interpolateTemplateStrict as legacyStrict } from './legacy-template';

const NOW = new Date('2026-09-25T06:00:00.000Z');
const SHAPES: Array<(path: string) => unknown> = [
  (p) => `v:${p}`,
  (p) => p.length * 7,
  (p) => `data with {{input.${p}}} and {{today}} inside`,
  (p) => ({ nested: p, list: [1, 2] }),
  () => null,
  () => undefined, // absent
];

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = /^\d+$/.test(parts[parts.indexOf(p) + 1] ?? '') ? [] : {};
    cur = cur[p] as Record<string, unknown>;
  }
  if (value !== undefined) cur[parts[parts.length - 1]] = value;
}

function leaves(v: unknown, path: string[] = []): Array<{ path: string[]; value: string }> {
  if (typeof v === 'string') return [{ path, value: v }];
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, [...path, k]));
  return [];
}

const at = (obj: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);

type FixtureNode = { n: number; type: string; config: Record<string, unknown> };
const nodes = (fixture as { nodes: FixtureNode[] }).nodes;

describe('prod template configs resolve identically under the engine resolver', () => {
  it('has the production sample', () => {
    expect(nodes.length).toBeGreaterThanOrEqual(60);
  });

  for (let variant = 0; variant < SHAPES.length; variant++) {
    it(`all ${nodes.length} configs, value shape #${variant}`, () => {
      const diffs: string[] = [];
      for (const node of nodes) {
        const refs = [...JSON.stringify(node.config).matchAll(/\{\{input\.([A-Za-z0-9_.]+)\}\}/g)].map((m) => m[1]);
        const input: Record<string, unknown> = {};
        refs.forEach((p, i) => setPath(input, p, SHAPES[(variant + i) % SHAPES.length](p)));

        const def = getDefinition(node.type);
        expect(def, node.type).toBeDefined();
        const graph = buildGraph([{ id: 'x', type: node.type, label: 'x', position: { x: 0, y: 0 }, config: node.config }], []);
        const runInput = { ...input };
        const resolved = resolveNodeConfig(node.config, def, runInput, {
          graph, nodeOutputs: new Map(), trigger: {}, store: new Map(),
        }).config;

        const rows = leaves(node.config).map((leaf) => {
          const state = resolveStateTemplatesString(leaf.value, { store: new Map(), now: NOW }).result;
          const value = at(resolved, leaf.path);
          // Executors read a field as text (String(...) or `as string` into the helper).
          const text = typeof value === 'string' ? value : String(value ?? '');
          return { leaf, old: legacyStrict(state, input), now: interpolateTemplateStrict(text, runInput) };
        });
        // {{today}} is the one clock-dependent token: both sides use their own clock.
        const norm = (s: string) => s.replace(/\w+day \d{1,2} \w+ \d{4}/g, 'TODAY');
        for (const { leaf, old, now } of rows) {
          // The strict helpers key missing references by resolved TEXT, so two fields
          // of one node that resolve to the same text share their missing list. Any
          // extra entry must come from such a twin — never from nowhere.
          const twins = rows.filter((r) => r.now.result === now.result).flatMap((r) => r.old.missingPaths);
          const missingOk =
            old.missingPaths.every((m) => now.missingPaths.includes(m)) &&
            now.missingPaths.every((m) => twins.includes(m));
          if (norm(now.result) !== norm(old.result) || !missingOk) {
            diffs.push(`#${node.n} ${node.type}.${leaf.path.join('.')}: old=${JSON.stringify(old)} new=${JSON.stringify(now)}`);
          }
        }
      }
      expect(diffs).toEqual([]);
    });
  }
});
