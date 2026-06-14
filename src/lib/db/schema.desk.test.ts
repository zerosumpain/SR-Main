import { describe, it, expect } from 'vitest';
import { sources, facts, entities, synthesisRuns } from './schema';
import { getTableConfig } from 'drizzle-orm/pg-core';

// The six additive desk columns appended to sources/facts/entities.
// [drizzle property name, physical column name]
const DESK_COLUMNS: [string, string][] = [
  ['canvasX', 'canvas_x'],
  ['canvasY', 'canvas_y'],
  ['pinned', 'pinned'],
  ['deskState', 'desk_state'],
  ['deskCategory', 'desk_category'],
  ['synthesisRunId', 'synthesis_run_id'],
];

describe('desk columns on research tables', () => {
  for (const [label, table] of [
    ['sources', sources],
    ['facts', facts],
    ['entities', entities],
  ] as const) {
    describe(label, () => {
      const cols = getTableConfig(table).columns;
      const byName = new Map(cols.map((c) => [c.name, c]));

      for (const [prop, colName] of DESK_COLUMNS) {
        it(`has column ${colName} (prop ${prop})`, () => {
          const col = byName.get(colName);
          expect(col, `${label}.${colName} missing`).toBeTruthy();
        });
      }

      it('canvas_x / canvas_y are nullable doublePrecision', () => {
        const x = byName.get('canvas_x')!;
        const y = byName.get('canvas_y')!;
        expect(x.notNull).toBe(false);
        expect(y.notNull).toBe(false);
        expect(x.getSQLType()).toBe('double precision');
        expect(y.getSQLType()).toBe('double precision');
      });

      it('pinned is NOT NULL boolean default false', () => {
        const p = byName.get('pinned')!;
        expect(p.notNull).toBe(true);
        expect(p.getSQLType()).toBe('boolean');
        expect(p.default).toBe(false);
      });

      it("desk_state is NOT NULL text default 'unfiled'", () => {
        const s = byName.get('desk_state')!;
        expect(s.notNull).toBe(true);
        expect(s.getSQLType()).toBe('text');
        expect(s.default).toBe('unfiled');
      });

      it('desk_category / synthesis_run_id are nullable text', () => {
        const dc = byName.get('desk_category')!;
        const sr = byName.get('synthesis_run_id')!;
        expect(dc.notNull).toBe(false);
        expect(dc.getSQLType()).toBe('text');
        expect(sr.notNull).toBe(false);
        expect(sr.getSQLType()).toBe('text');
      });
    });
  }
});

describe('synthesisRuns table', () => {
  const cfg = getTableConfig(synthesisRuns);
  const byName = new Map(cfg.columns.map((c) => [c.name, c]));

  it("maps to the 'synthesis_runs' table", () => {
    expect(cfg.name).toBe('synthesis_runs');
  });

  it('has the expected columns', () => {
    const expected = [
      'id',
      'session_id',
      'scope',
      'status',
      'summary',
      'clusters',
      'tokens_used',
      'error_message',
      'created_at',
      'completed_at',
    ];
    for (const name of expected) {
      expect(byName.get(name), `synthesis_runs.${name} missing`).toBeTruthy();
    }
  });

  it('id is the text primary key', () => {
    const id = byName.get('id')!;
    expect(id.primary).toBe(true);
    expect(id.getSQLType()).toBe('text');
  });

  it('session_id is NOT NULL text', () => {
    const sid = byName.get('session_id')!;
    expect(sid.notNull).toBe(true);
    expect(sid.getSQLType()).toBe('text');
  });

  it("status is NOT NULL text default 'running'", () => {
    const st = byName.get('status')!;
    expect(st.notNull).toBe(true);
    expect(st.default).toBe('running');
  });

  it('scope and clusters are NOT NULL jsonb', () => {
    const scope = byName.get('scope')!;
    const clusters = byName.get('clusters')!;
    expect(scope.notNull).toBe(true);
    expect(scope.getSQLType()).toBe('jsonb');
    expect(clusters.notNull).toBe(true);
    expect(clusters.getSQLType()).toBe('jsonb');
  });

  it('created_at is NOT NULL, completed_at is nullable', () => {
    expect(byName.get('created_at')!.notNull).toBe(true);
    expect(byName.get('completed_at')!.notNull).toBe(false);
  });
});
