import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Mutable executeTool outcome — the bridge being down is a first-class case. */
  toolResult: { success: true } as { success: boolean; error?: string },
  toolThrows: false,
  persistThrowsOn: 0 as number,
  persistCalls: 0,
}));

vi.mock('$lib/datastore', () => ({
  upsertRecord: vi.fn(async (_slug: string, rec: { key: string; data: unknown }) => {
    h.persistCalls++;
    if (h.persistThrowsOn === h.persistCalls) throw new Error('datastore down');
    return { id: rec.key };
  }),
}));

// A fake number, so no test fixture and no failure output can carry the real one.
vi.mock('$lib/workflows/whatsapp/approval-notify', () => ({ getOwnerPhone: () => '+10000000000' }));

vi.mock('$lib/workflows/site-tools/registry', () => ({
  executeTool: vi.fn(async () => {
    if (h.toolThrows) throw new Error('registry exploded');
    return h.toolResult;
  }),
}));

import { upsertRecord } from '$lib/datastore';
import { executeTool } from '$lib/workflows/site-tools/registry';
import { hasSensitive } from '$lib/security/sensitive';
import { buildReportText, buildWhatsappSummary, finalizeAndNotify } from './report';
import { COLLECTIONS, emptyPhases, type DoctorAction, type DoctorRunData } from './types';

const DOCTOR_LINK = 'https://strangeramblings.com/jkai/doctor';

/** A real-shaped OpenRouter key (sk-or-v1- + 40) and an Ofcom fictional UK number. */
const FAKE_KEY = `sk-or-v1-${'a1b2c3d4e5'.repeat(4)}`;
const FAKE_PHONE = '07700 900123';

function run(over: Partial<DoctorRunData> = {}): DoctorRunData {
  return {
    status: 'complete',
    trigger: 'cron',
    startedAt: '2026-08-02T04:00:00.000Z',
    finishedAt: '2026-08-02T04:03:00.000Z',
    phases: emptyPhases(),
    llmCalls: 6,
    tokensIn: 1200,
    tokensOut: 340,
    costUsd: 0.0412,
    workflowsFailing: 3,
    signaturesSeen: 9,
    autoApplyEnabled: false,
    breakerEnabled: true,
    fixesApplied: 0,
    fixesReverted: 0,
    fixesRefusedSensitive: 0,
    schedulesQuarantined: 0,
    proposalsOpened: 0,
    findingsResolved: 0,
    whatsappDelivered: false,
    actions: [],
    report: '',
    ...over,
  };
}

function action(over: Partial<DoctorAction> = {}): DoctorAction {
  return { kind: 'proposal', detail: 'canvas:morning-briefing — missing-credential', ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.toolResult = { success: true };
  h.toolThrows = false;
  h.persistThrowsOn = 0;
  h.persistCalls = 0;
});

describe('buildWhatsappSummary — leak resistance', () => {
  it('carries neither the API key nor the phone number from the error text it describes', () => {
    const dirty = `Request failed: Authorization Bearer ${FAKE_KEY} rejected; notify ${FAKE_PHONE}`;
    const data = run({
      fixesApplied: 1,
      proposalsOpened: 1,
      fixesRefusedSensitive: 1,
      actions: [
        action({ kind: 'fix_applied', detail: `canvas:inbox-triage enum-violation — ${dirty}` }),
        action({ kind: 'proposal', detail: `canvas:inbox-triage missing-credential — ${dirty}` }),
        action({
          kind: 'fix_refused_sensitive',
          detail: `canvas:inbox-triage secret-in-node-config — ${dirty}`,
          story: {
            subject: 'canvas:inbox-triage / HTTP Request',
            symptom: dirty,
            cause: dirty,
            causeSource: 'linter',
            fix: dirty,
            fixMode: 'refused',
            outcome: dirty,
            outcomeKind: 'unproven',
          },
        }),
      ],
    });

    const msg = buildWhatsappSummary(data);
    expect(msg).not.toContain(FAKE_KEY);
    expect(msg).not.toContain('sk-or-v1');
    expect(msg).not.toContain(FAKE_PHONE);
    expect(msg).not.toContain('07700');
    expect(msg).not.toContain('Bearer');
    // The whole detector, not just the two strings this fixture happens to use.
    expect(hasSensitive(msg)).toBe(false);
    // It still said something useful.
    expect(msg).toContain('inbox-triage');
    expect(msg).toContain('REFUSED');
  });

  it('drops a canvas slug that is itself sensitive rather than naming it', () => {
    const data = run({
      fixesApplied: 1,
      actions: [action({ kind: 'fix_applied', detail: 'canvas:447359228511 enum-violation' })],
    });
    const msg = buildWhatsappSummary(data);
    expect(msg).not.toContain('447359228511');
    expect(msg).toContain('FIXED 1');
  });
});

describe('buildWhatsappSummary — composition', () => {
  it('leads with the count of canvases failing', () => {
    expect(buildWhatsappSummary(run({ workflowsFailing: 3 }))).toContain('3 canvases failing.');
    expect(buildWhatsappSummary(run({ workflowsFailing: 1 }))).toContain('1 canvas failing.');
  });

  it('names fixed canvases with their fix-kind label, three then "+N more"', () => {
    const slugs = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const data = run({
      fixesApplied: 5,
      actions: slugs.map((s) =>
        action({ kind: 'fix_applied', detail: `canvas:${s} enum-violation applied` }),
      ),
    });
    const msg = buildWhatsappSummary(data);
    expect(msg).toContain('FIXED 5: alpha (invalid dropdown value)');
    expect(msg).toContain('charlie (invalid dropdown value) +2 more');
    expect(msg).not.toContain('echo');
  });

  it('shows QUARANTINED when schedulesQuarantined > 0', () => {
    const data = run({
      schedulesQuarantined: 2,
      actions: [
        action({ kind: 'schedule_quarantined', detail: 'canvas:icloud-new-event disabled' }),
        action({ kind: 'schedule_quarantined', detail: 'canvas:icloud-event-monitor disabled' }),
      ],
    });
    const msg = buildWhatsappSummary(data);
    expect(msg).toContain('QUARANTINED 2 schedules: icloud-new-event, icloud-event-monitor.');
  });

  it('groups proposals by fix kind, biggest bucket first', () => {
    const data = run({
      proposalsOpened: 4,
      actions: [
        action({ detail: 'canvas:a missing-credential' }),
        action({ detail: 'canvas:b missing-credential' }),
        action({ detail: 'canvas:c provider-limit' }),
        action({ detail: 'canvas:d expired-oauth' }),
      ],
    });
    const msg = buildWhatsappSummary(data);
    expect(msg).toContain('PROPOSED 4: 2 missing credential, 1 expired connection, 1 provider limit');
  });

  it('always shows REFUSED — it is the only line that demands a human', () => {
    const msg = buildWhatsappSummary(run({ fixesRefusedSensitive: 1 }));
    expect(msg).toContain('1 REFUSED: secret in node config — needs you.');
  });

  it('falls back to "Nothing to fix." when there are failures but no actions', () => {
    const msg = buildWhatsappSummary(run({ workflowsFailing: 2 }));
    expect(msg).toContain('2 canvases failing.');
    expect(msg).toContain('Nothing to fix.');
  });

  it('falls back to "No failures in 7 days." on a clean night', () => {
    const msg = buildWhatsappSummary(run({ workflowsFailing: 0 }));
    expect(msg).toContain('No failures in 7 days.');
    expect(msg).not.toContain('Nothing to fix.');
  });

  it('tails with cost, call count and the link on its own line', () => {
    const msg = buildWhatsappSummary(run({ costUsd: 0.0412, llmCalls: 6 }));
    expect(msg).toContain('~$0.04, 6 calls.');
    expect(msg.split('\n').pop()).toBe(DOCTOR_LINK);
  });
});

describe('buildWhatsappSummary — 600-char cap', () => {
  it('holds on a large run, and the link survives the trim', () => {
    const long = (p: string, i: number) => `${p}-a-deliberately-long-canvas-slug-number-${i}`;
    const actions: DoctorAction[] = [];
    for (let i = 0; i < 40; i++) {
      actions.push(action({ kind: 'fix_applied', detail: `canvas:${long('fixed', i)} enum-violation` }));
      actions.push(action({ kind: 'schedule_quarantined', detail: `canvas:${long('sched', i)}` }));
      actions.push(action({ kind: 'proposal', detail: `canvas:${long('prop', i)} missing-credential` }));
      actions.push(action({ kind: 'proposal', detail: `canvas:${long('prop', i)} unsupported-template-syntax` }));
    }
    const msg = buildWhatsappSummary(
      run({
        workflowsFailing: 37,
        fixesApplied: 40,
        schedulesQuarantined: 40,
        proposalsOpened: 80,
        fixesRefusedSensitive: 4,
        costUsd: 0.2431,
        llmCalls: 19,
        actions,
      }),
    );
    expect(msg.length).toBeLessThanOrEqual(600);
    expect(msg).toContain(DOCTOR_LINK);
    expect(msg.split('\n').pop()).toBe(DOCTOR_LINK);
    expect(hasSensitive(msg)).toBe(false);
  });
});

describe('buildReportText', () => {
  it('leads with status and the failing-canvas headline, then phases and actions', () => {
    const phases = emptyPhases();
    phases.gather = { status: 'ok', detail: '9 signatures', ms: 812 };
    phases.fix = { status: 'skipped', detail: 'auto-apply off' };
    const text = buildReportText(
      run({
        phases,
        workflowsFailing: 3,
        signaturesSeen: 9,
        actions: [action({ kind: 'triaged', detail: 'canvas:morning-briefing triaged' })],
      }),
    );
    expect(text).toContain('# Workflow doctor run (cron)');
    expect(text).toContain('Status: complete');
    expect(text).toContain('Canvases failing (last 7d): 3 across 9 signature(s)');
    expect(text).toContain('- gather: ok — 9 signatures (812ms)');
    expect(text).toContain('- fix: skipped — auto-apply off');
    expect(text).toContain('- [triaged] canvas:morning-briefing triaged');
  });

  it('marks a shadow night so it does not read as a night that chose not to fix', () => {
    expect(buildReportText(run({ autoApplyEnabled: false, breakerEnabled: true }))).toContain(
      'Switches: auto-apply OFF (shadow) · circuit breaker ON',
    );
    expect(buildReportText(run({ autoApplyEnabled: true, breakerEnabled: false }))).toContain(
      'Switches: auto-apply ON · circuit breaker OFF',
    );
  });

  it('says "(none)" when the run took no actions', () => {
    expect(buildReportText(run())).toContain('- (none)');
  });
});

describe('finalizeAndNotify', () => {
  it('stamps the report, persists, and sends to the owner', async () => {
    const data = run();
    await finalizeAndNotify('run-1', data);

    expect(data.report).toContain('# Workflow doctor run');
    expect(upsertRecord).toHaveBeenCalledTimes(2);
    expect(vi.mocked(upsertRecord).mock.calls[0][0]).toBe(COLLECTIONS.doctorRuns);
    expect(vi.mocked(upsertRecord).mock.calls[0][1].key).toBe('run-1');
    expect(executeTool).toHaveBeenCalledWith('whatsapp_send', {
      to: '+10000000000',
      message: expect.stringContaining(DOCTOR_LINK),
    });
    expect(data.whatsappDelivered).toBe(true);
    // The re-stamp: the first report text was written before the send.
    expect(data.report).toContain('summary delivered');
  });

  it('records a swallowed send failure instead of reporting a delivery that never happened', async () => {
    h.toolResult = { success: false, error: 'bridge offline' };
    const data = run();
    await finalizeAndNotify('run-2', data);

    expect(data.whatsappDelivered).toBe(false);
    expect(data.report).toContain('summary did NOT reach WhatsApp');
    expect(upsertRecord).toHaveBeenCalledTimes(2);
  });

  it('never throws when the send path throws', async () => {
    h.toolThrows = true;
    const data = run();
    await expect(finalizeAndNotify('run-3', data)).resolves.toBeUndefined();
    expect(data.whatsappDelivered).toBe(false);
  });

  it('propagates the first persist failure so the caller can fail the report phase', async () => {
    h.persistThrowsOn = 1;
    await expect(finalizeAndNotify('run-4', run())).rejects.toThrow('datastore down');
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('swallows the delivery-flag persist failure — the run and the message are already out', async () => {
    h.persistThrowsOn = 2;
    const data = run();
    await expect(finalizeAndNotify('run-5', data)).resolves.toBeUndefined();
    expect(data.whatsappDelivered).toBe(true);
  });
});
