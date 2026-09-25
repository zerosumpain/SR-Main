// The nightly sweep's per-space orchestration, with every stage stubbed.
//
// Nothing here touches a database: `$lib/db` is replaced by a stub whose only
// job is to answer `activeSpaces`' one query, and every stage module is a mock
// that records what it was called with. The question these tests answer is not
// "does the resolver merge correctly" (merge.ts has its own tests) but "does the
// engine hand each stage exactly one space, and does one space failing leave the
// others alone" — which is only testable by watching the calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const h = vi.hoisted(() => ({
  spaceRows: [] as Array<{ space_id: string }>,
  accounts: [] as Array<{ id: number; email: string; principalId: string; status: string }>,
  failGmailAccount: null as number | null,
  failResolveSpace: null as string | null,
  executed: [] as unknown[],
}));

vi.mock('$lib/db', () => ({
  db: {
    execute: vi.fn(async (q: unknown) => {
      h.executed.push(q);
      return { rows: h.spaceRows };
    }),
  },
}));

vi.mock('$lib/workflows/engine-runtime', () => ({
  beginBatch: () => ({ beat: () => {}, end: () => {} }),
}));

vi.mock('./run-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./run-log')>()),
  ensureIntelRunCollection: vi.fn(async () => {}),
  recordIntelRun: vi.fn(async () => {}),
  hasScheduledRunFor: vi.fn(async () => false),
}));

vi.mock('./cleanup.server', () => ({
  cleanupIntelligence: vi.fn(async () => ({ counts: { purged: 0 } })),
}));

vi.mock('./gmail-ingest', () => ({
  NO_GMAIL_ACCOUNT_MESSAGE: 'No active Gmail account. Connect one at /admin/connections/gmail.',
  rollingSweepAccounts: vi.fn(async () => h.accounts),
  ingestGmailThreads: vi.fn(async (opts: { accountId?: number }) => {
    if (opts.accountId === h.failGmailAccount) throw new Error('token revoked');
    return {
      threads: 10, held: 4, extracted: 0, entities: 0, edges: 0, deferred: 0,
      failed: 0, unchanged: 6, skipped: 0, budgetLeft: 150,
    };
  }),
}));

vi.mock('./mail-relevance', () => ({
  scoreMailRelevance: vi.fn(async () => ({
    scanned: 1, scored: 1, withHits: 0, remaining: 0, entities: 3, foreground: 0, blocked: 0,
    similarityFailed: false,
  })),
}));

vi.mock('./mail-rules/apply', () => ({
  applyMailRules: vi.fn(async () => ({
    activeRules: 0, scanned: 0, admitted: 0, rejected: 0, deferred: 0, failed: 0,
  })),
}));

vi.mock('./mail-queue', () => ({
  backfillPendingEmbeddings: vi.fn(async () => ({ embedded: 0, remaining: 0, stopped: false })),
}));
vi.mock('$lib/mail-index/store', () => ({
  backfillMailIndex: vi.fn(async () => ({ indexed: 0, stopped: false })),
}));
vi.mock('./embed', () => ({
  backfillEntityEmbeddings: vi.fn(async () => ({ embedded: 0, remaining: 0 })),
}));

vi.mock('./resolve/merge', () => ({
  backfillAliasesFromTombstones: vi.fn(async () => ({ updated: 2, aliasesAdded: 3 })),
  autoMergeDuplicates: vi.fn(async (_t: unknown, opts: { space?: string }) => {
    if (opts.space === h.failResolveSpace) throw new Error('lock timeout');
    return { candidates: 5, merged: 1, skipped: 4, chainsBroken: 0, details: [] };
  }),
  sweepDuplicates: vi.fn(async (_min: number, opts: { space?: string }) => ({
    reports: [{ space: opts.space }],
    semanticPairs: 0,
    ruledOut: 0,
  })),
}));

vi.mock('./resolve/adjudicate', () => ({
  ADJUDICATION_BAND: { min: 0.5, max: 0.85 },
  adjudicateCandidates: vi.fn(async () => ({
    considered: 1, skipped: 0, decided: 1, same: 1, different: 0, unsure: 0, failed: 0,
  })),
}));

vi.mock('./taxonomy-governance.server', () => ({
  runTaxonomyQuality: vi.fn(async () => ({ reviewed: 0 })),
}));

vi.mock('./trust-refresh', () => ({
  backfillConfidence: vi.fn(async () => ({ scored: 7 })),
}));

vi.mock('./analytics/load', () => ({
  invalidateGraphAnalysis: vi.fn(),
}));

vi.mock('./watchlist', () => ({
  runWatchlistCheck: vi.fn(async () => ({ changes: [] })),
}));

vi.mock('./resolve/conflation.server', () => ({
  runConflationSweep: vi.fn(async () => ({
    shortlisted: 0, judged: 0, cached: 0, applied: 0, proposed: 0, corroborated: 0,
    queued: 0, skipped: 0, failed: 0,
  })),
}));

vi.mock('./lenses.server', () => ({
  runDueLensChecks: vi.fn(async () => []),
}));

import { activeSpaces, forEachSpace, readerScope, runIntelSweep, PartialStageError } from './engine';
import { OWNER_INTEL_SCOPE } from './scope';
import { autoMergeDuplicates, backfillAliasesFromTombstones, sweepDuplicates } from './resolve/merge';
import { adjudicateCandidates } from './resolve/adjudicate';
import { runConflationSweep } from './resolve/conflation.server';
import { runWatchlistCheck } from './watchlist';
import { runDueLensChecks } from './lenses.server';
import { scoreMailRelevance } from './mail-relevance';
import { applyMailRules } from './mail-rules/apply';
import { backfillConfidence } from './trust-refresh';
import { cleanupIntelligence } from './cleanup.server';
import { runTaxonomyQuality } from './taxonomy-governance.server';
import { invalidateGraphAnalysis } from './analytics/load';
import { ingestGmailThreads, rollingSweepAccounts } from './gmail-ingest';

const argsOf = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls;

beforeEach(() => {
  vi.clearAllMocks();
  h.spaceRows = [{ space_id: 'owner' }];
  h.accounts = [{ id: 1, email: 'a@example.test', principalId: 'owner', status: 'active' }];
  h.failGmailAccount = null;
  h.failResolveSpace = null;
  h.executed = [];
  process.env.INTEL_GMAIL_ROLLING = '1';
  process.env.INTEL_AUTO_RESOLVE = '1';
  process.env.INTEL_ADJUDICATE = '1';
});

describe('activeSpaces', () => {
  const stub = (rows: Array<{ space_id: string }>) => {
    const calls: SQL[] = [];
    return {
      calls,
      executor: { execute: async (q: SQL) => (calls.push(q), { rows }) },
    };
  };

  it('reads the distinct space ids of intel_entities', async () => {
    const { calls, executor } = stub([{ space_id: 'owner' }]);
    await activeSpaces(executor);
    const text = new PgDialect().sqlToQuery(calls[0]).sql;
    expect(text).toMatch(/SELECT DISTINCT space_id\s+FROM intel_entities/);
  });

  it("also reads active mailboxes' principals, so a member with only held mail is scored", async () => {
    const { calls, executor } = stub([{ space_id: 'owner' }]);
    await activeSpaces(executor);
    const text = new PgDialect().sqlToQuery(calls[0]).sql;
    expect(text).toMatch(/UNION\s+SELECT DISTINCT principal_id AS space_id FROM gmail_accounts WHERE status = 'active'/);
  });

  it('always includes the owner, even on an empty graph', async () => {
    expect(await activeSpaces(stub([]).executor)).toEqual(['owner']);
  });

  it('puts the owner first and the rest in order', async () => {
    const { executor } = stub([{ space_id: 'u_b' }, { space_id: 'household' }, { space_id: 'owner' }, { space_id: 'u_a' }]);
    expect(await activeSpaces(executor)).toEqual(['owner', 'household', 'u_a', 'u_b']);
  });
});

describe('readerScope', () => {
  it("is exactly the owner's reader scope for the owner, so its snapshot keys do not move", () => {
    expect(readerScope('owner')).toBe(OWNER_INTEL_SCOPE);
  });

  it("is a member's own space plus household, own first", () => {
    expect(readerScope('u_a')).toEqual(['u_a', 'household']);
  });
});

describe('forEachSpace', () => {
  it('runs every space and sums the counts', async () => {
    const seen: string[] = [];
    const totals = await forEachSpace(['owner', 'household'], async (space) => {
      seen.push(space);
      return { merged: space === 'owner' ? 2 : 1 };
    });
    expect(seen).toEqual(['owner', 'household']);
    expect(totals).toEqual({ merged: 3 });
  });

  it('keeps going past a failing space and reports it by name, with what did succeed', async () => {
    const seen: string[] = [];
    const run = forEachSpace(['owner', 'household', 'u_a'], async (space) => {
      seen.push(space);
      if (space === 'household') throw new Error('boom');
      return { merged: 1 };
    });
    await expect(run).rejects.toBeInstanceOf(PartialStageError);
    const err = (await run.catch((e) => e)) as PartialStageError;
    expect(seen).toEqual(['owner', 'household', 'u_a']);
    expect(err.counts).toEqual({ merged: 2 });
    expect(err.message).toContain('household: ');
    expect(err.message).toContain('boom');
    expect(err.message).not.toContain('owner:');
  });

  it('starts from the counts it is given', async () => {
    expect(await forEachSpace(['owner'], async () => ({ merged: 1 }), { aliasesLearned: 3 })).toEqual({
      aliasesLearned: 3,
      merged: 1,
    });
  });
});

describe('runIntelSweep — owner only (tonight)', () => {
  it('runs every resolution stage once, in the owner space, and the global stages once', async () => {
    const out = await runIntelSweep({ trigger: 'manual' });

    expect(argsOf(autoMergeDuplicates)).toEqual([[undefined, { limit: 25, space: 'owner' }]]);
    expect(argsOf(sweepDuplicates)).toEqual([[0.5, { space: 'owner' }]]);
    expect(argsOf(adjudicateCandidates)).toHaveLength(1);
    expect(argsOf(adjudicateCandidates)[0][1]).toMatchObject({ space: 'owner' });
    expect(argsOf(runConflationSweep)).toEqual([[{ space: 'owner' }]]);
    // The owner's reader scope — the SAME frozen array the defaults use, so
    // the watchlist snapshot key and the lens filter are exactly tonight's.
    expect(argsOf(runWatchlistCheck)).toEqual([[OWNER_INTEL_SCOPE]]);
    expect(argsOf(runWatchlistCheck)[0][0]).toBe(OWNER_INTEL_SCOPE);
    expect(argsOf(runDueLensChecks)[0][0]).toBe(OWNER_INTEL_SCOPE);
    expect(argsOf(scoreMailRelevance)).toEqual([[{ scope: OWNER_INTEL_SCOPE }]]);

    for (const once of [cleanupIntelligence, backfillAliasesFromTombstones, runTaxonomyQuality, backfillConfidence, applyMailRules, invalidateGraphAnalysis]) {
      expect(argsOf(once)).toHaveLength(1);
    }

    expect(out.errors).toEqual([]);
    expect(out.duplicatesMerged).toBe(1);
    expect(out.stages.map((s) => s.stage)).toEqual([
      'cleanup', 'gmail', 'mail-relevance', 'mail-rules', 'embeddings', 'resolve', 'taxonomy',
      'adjudicate', 'confidence', 'watchlist', 'conflation', 'lenses',
    ]);
    expect(out.stages.find((s) => s.stage === 'resolve')?.counts).toEqual({
      candidates: 5, merged: 1, skipped: 4, chainsBroken: 0, aliasesLearned: 3, entitiesRelabelled: 2,
    });
  });
});

describe('runIntelSweep — more than one space', () => {
  beforeEach(() => {
    h.spaceRows = [{ space_id: 'owner' }, { space_id: 'household' }, { space_id: 'u_a' }];
  });

  it('hands each resolution stage exactly ONE space, every space', async () => {
    await runIntelSweep({ trigger: 'manual' });

    expect(argsOf(autoMergeDuplicates).map((c) => c[1].space)).toEqual(['owner', 'household', 'u_a']);
    expect(argsOf(sweepDuplicates).map((c) => c[1].space)).toEqual(['owner', 'household', 'u_a']);
    // Adjudication reads the reports of the space it was swept for.
    for (const [reports, opts] of argsOf(adjudicateCandidates)) {
      expect(reports).toEqual([{ space: opts.space }]);
    }
    expect(argsOf(adjudicateCandidates).map((c) => c[1].space)).toEqual(['owner', 'household', 'u_a']);
    expect(argsOf(runConflationSweep).map((c) => c[0].space)).toEqual(['owner', 'household', 'u_a']);
  });

  it('runs the reader stages once per reader, never as household on its own', async () => {
    await runIntelSweep({ trigger: 'manual' });

    const readers = [OWNER_INTEL_SCOPE, ['u_a', 'household']];
    expect(argsOf(runWatchlistCheck).map((c) => c[0])).toEqual(readers);
    expect(argsOf(runDueLensChecks).map((c) => c[0])).toEqual(readers);
    expect(argsOf(scoreMailRelevance).map((c) => c[0].scope)).toEqual(readers);
    // The rules are the owner's and run over the owner's queue only.
    expect(argsOf(applyMailRules)).toHaveLength(1);
    // Global, per-row stages do not multiply.
    for (const once of [cleanupIntelligence, backfillAliasesFromTombstones, runTaxonomyQuality, backfillConfidence, invalidateGraphAnalysis]) {
      expect(argsOf(once)).toHaveLength(1);
    }
  });

  it('isolates a failing space: the others still resolve, and the stage says which failed', async () => {
    h.failResolveSpace = 'household';
    const out = await runIntelSweep({ trigger: 'manual' });

    expect(argsOf(autoMergeDuplicates).map((c) => c[1].space)).toEqual(['owner', 'household', 'u_a']);
    const resolve = out.stages.find((s) => s.stage === 'resolve')!;
    expect(resolve.ok).toBe(false);
    expect(resolve.error).toContain('household: ');
    expect(resolve.error).toContain('lock timeout');
    // What the other two spaces did is kept, not thrown away with the failure.
    expect(resolve.counts).toMatchObject({ merged: 2, aliasesLearned: 3 });
    expect(out.duplicatesMerged).toBe(2);
    // And the stages after it still ran.
    expect(out.stages.filter((s) => s.stage !== 'resolve').every((s) => s.ok)).toBe(true);
  });
});

describe('runIntelSweep — Gmail', () => {
  it('sweeps every active owner account, each by id', async () => {
    h.accounts = [
      { id: 7, email: 'a@example.test', principalId: 'owner', status: 'active' },
      { id: 9, email: 'b@example.test', principalId: 'owner', status: 'active' },
    ];
    const out = await runIntelSweep({ trigger: 'manual' });

    expect(argsOf(rollingSweepAccounts)).toHaveLength(1);
    expect(argsOf(ingestGmailThreads)).toEqual([
      [{ mode: 'rolling', accountId: 7, anyPrincipal: true }],
      [{ mode: 'rolling', accountId: 9, anyPrincipal: true }],
    ]);
    const gmail = out.stages.find((s) => s.stage === 'gmail')!;
    expect(gmail.ok).toBe(true);
    expect(gmail.counts).toMatchObject({ accounts: 2, threads: 20, held: 8 });
  });

  it('one failing account does not stop the next', async () => {
    h.accounts = [
      { id: 7, email: 'a@example.test', principalId: 'owner', status: 'active' },
      { id: 9, email: 'b@example.test', principalId: 'owner', status: 'active' },
    ];
    h.failGmailAccount = 7;
    const out = await runIntelSweep({ trigger: 'manual' });

    expect(argsOf(ingestGmailThreads).map((c) => c[0].accountId)).toEqual([7, 9]);
    const gmail = out.stages.find((s) => s.stage === 'gmail')!;
    expect(gmail.ok).toBe(false);
    expect(gmail.error).toContain('account 7: ');
    expect(gmail.error).toContain('token revoked');
    // No address in the run log: it names the account by id.
    expect(gmail.error).not.toContain('a@example.test');
    expect(gmail.counts).toMatchObject({ accounts: 1, threads: 10 });
  });

  it('with no account connected, fails with the fix rather than succeeding at nothing', async () => {
    h.accounts = [];
    const out = await runIntelSweep({ trigger: 'manual' });
    const gmail = out.stages.find((s) => s.stage === 'gmail')!;
    expect(gmail.ok).toBe(false);
    expect(gmail.error).toContain('/admin/connections/gmail');
    expect(argsOf(ingestGmailThreads)).toHaveLength(0);
  });
});
