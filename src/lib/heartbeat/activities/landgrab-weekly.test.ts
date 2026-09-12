// The Sunday letter's gates and its delivery ladder.
//
// Everything below the handler is mocked: the facts module talks to the
// database four times over the whole ledger, the model call costs money, and
// WhatsApp is a real phone. What is left — and what is worth pinning — is the
// order of the gates, what gets saved when the verifier says no, and the fact
// that a failed WhatsApp send falls to a chat note rather than losing the week.
//
// `isLocalSunday` and `localDayStr` are the two things NOT mocked away: they
// are three lines each and re-implementing them here means `vi.setSystemTime`
// actually drives the Sunday gate, instead of the test handing the handler a
// boolean and proving nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HeartbeatAction } from '$lib/db/schema';

const geo = vi.hoisted(() => ({
  gatherLandgrabWeek: vi.fn(),
  phraseLandgrabWeek: vi.fn(),
  weekFactLines: vi.fn(),
  numericStats: vi.fn(),
  landgrabWeeklyExists: vi.fn(),
  saveLandgrabWeekly: vi.fn(),
}));

vi.mock('$lib/geo/weekly', () => ({
  ...geo,
  localDayStr: (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d),
  isLocalSunday: (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(d) ===
    'Sun',
}));

vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn() }));

vi.mock('$lib/daydream/budget', () => ({
  ZERO_SPEND: { weeklyPct: 0, fiveHourPct: 0 },
  budgetStatus: vi.fn(),
  readQuotaMark: vi.fn(),
  attributeSpend: vi.fn(() => ({ weeklyPct: 0, fiveHourPct: 0 })),
}));

vi.mock('$lib/daydream/compose', () => ({ resolveDaydreamModel: vi.fn() }));
vi.mock('$lib/llm/client', () => ({ getLLMClient: vi.fn() }));
vi.mock('$lib/config/owner', () => ({ ownerPhone: vi.fn(() => '+440000000000') }));
vi.mock('$lib/workflows/site-tools/registry', () => ({ executeTool: vi.fn() }));
vi.mock('$lib/daydream/deliver', () => ({ latestConversationId: vi.fn() }));
vi.mock('$lib/heartbeat/llm', () => ({ postHeartbeatNote: vi.fn() }));
vi.mock('$lib/daydream/geocode', () => ({ suggestPlaceName: vi.fn() }));
vi.mock('$lib/context/activity', () => ({
  withActivity: (_id: string, fn: () => Promise<unknown>) => fn(),
}));

import { getSetting } from '$lib/server/models/settings';
import { budgetStatus } from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { getLLMClient } from '$lib/llm/client';
import { ownerPhone } from '$lib/config/owner';
import { executeTool } from '$lib/workflows/site-tools/registry';
import { latestConversationId } from '$lib/daydream/deliver';
import { postHeartbeatNote } from '$lib/heartbeat/llm';
import { suggestPlaceName } from '$lib/daydream/geocode';
import { landgrabWeekly } from './landgrab-weekly';

// 2026-09-13 is a Sunday; 18:00Z is 19:00 in Europe/London, inside the window.
const SUNDAY = new Date('2026-09-13T18:00:00Z');
const SATURDAY = new Date('2026-09-12T18:00:00Z');

const FACTS = {
  weekEnding: '2026-09-13',
  quiet: false,
  players: [],
  takes: [],
  biggestClaim: null,
  contested: [],
  battleground: null,
  cellAreaM2: 8100,
};

function ctx(config: Record<string, unknown> = {}) {
  return { now: Date.now(), config, action: {} as HeartbeatAction };
}

const create = vi.fn();

function draftThen(verdict: string, draft = 'Katie took the hill.') {
  create.mockReset();
  create
    .mockResolvedValueOnce({
      choices: [{ message: { content: draft } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: verdict } }],
      usage: { prompt_tokens: 40, completion_tokens: 1 },
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(SUNDAY);

  vi.mocked(getSetting).mockResolvedValue(null as never);
  geo.landgrabWeeklyExists.mockResolvedValue(false);
  geo.gatherLandgrabWeek.mockResolvedValue(FACTS);
  geo.phraseLandgrabWeek.mockReturnValue('Week to Sun 13 Sep. Katie +0.22 km².');
  geo.weekFactLines.mockReturnValue(['Week ending 2026-09-13.', 'katie: holds 30 cells']);
  geo.numericStats.mockReturnValue({ players: 1 });
  geo.saveLandgrabWeekly.mockResolvedValue(undefined);

  vi.mocked(resolveDaydreamModel).mockResolvedValue({
    modelId: 'openrouter/some-model',
    provider: 'openrouter',
  } as never);
  vi.mocked(budgetStatus).mockResolvedValue({ blocked: false } as never);
  vi.mocked(getLLMClient).mockResolvedValue({
    client: { chat: { completions: { create } } },
    model: 'openrouter/some-model',
  } as never);
  vi.mocked(ownerPhone).mockReturnValue('+440000000000');
  vi.mocked(executeTool).mockResolvedValue({ success: true } as never);
  vi.mocked(latestConversationId).mockResolvedValue(null as never);
  vi.mocked(postHeartbeatNote).mockResolvedValue({ messageId: 'm1' } as never);
  vi.mocked(suggestPlaceName).mockResolvedValue({
    name: 'Elton Parade',
    kind: null,
    address: null,
    source: 'mapbox',
  } as never);
  draftThen('SUPPORTED');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the gates', () => {
  it('skips every day but Sunday', async () => {
    vi.setSystemTime(SATURDAY);
    const r = await landgrabWeekly.run(ctx());
    expect(r.outcome).toBe('skipped');
    expect(r.summary).toMatch(/not Sunday/);
    expect(geo.gatherLandgrabWeek).not.toHaveBeenCalled();
    expect(geo.saveLandgrabWeekly).not.toHaveBeenCalled();
  });

  it('skips when geo is switched off', async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    const r = await landgrabWeekly.run(ctx());
    expect(r.outcome).toBe('skipped');
    expect(geo.saveLandgrabWeekly).not.toHaveBeenCalled();
  });

  it('treats an unset geo.enabled as enabled', async () => {
    // Unset is the shipped state — the kill switch has never been written.
    vi.mocked(getSetting).mockResolvedValue(undefined as never);
    const r = await landgrabWeekly.run(ctx());
    expect(r.outcome).toBe('ok');
  });

  it('writes one letter a week, deduped on the row', async () => {
    geo.landgrabWeeklyExists.mockResolvedValue(true);
    const r = await landgrabWeekly.run(ctx());
    expect(r.outcome).toBe('skipped');
    expect(r.summary).toMatch(/already written/);
    expect(geo.saveLandgrabWeekly).not.toHaveBeenCalled();
  });
});

describe('preview', () => {
  it('returns the facts without saving or sending', async () => {
    const r = await landgrabWeekly.run(ctx({ preview: true }));
    expect(r.outcome).toBe('ok');
    expect(r.details?.facts).toBeTruthy();
    expect(r.details?.preview).toBe(true);
    expect(geo.saveLandgrabWeekly).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('previews on a Saturday too — the day the letter is verified', async () => {
    // The preview branch sits ABOVE the Sunday gate on purpose: a dry run you
    // can only take on the day it would have sent anyway verifies nothing.
    vi.setSystemTime(SATURDAY);
    const r = await landgrabWeekly.run(ctx({ preview: true }));
    expect(r.outcome).toBe('ok');
    expect(r.details?.preview).toBe(true);
    expect(geo.saveLandgrabWeekly).not.toHaveBeenCalled();
  });
});

describe('the letter', () => {
  it('saves the verified narrative and sends it over WhatsApp', async () => {
    const r = await landgrabWeekly.run(ctx());

    expect(r.outcome).toBe('ok');
    expect(r.summary).toMatch(/→ whatsapp/);
    expect(geo.saveLandgrabWeekly).toHaveBeenCalledWith(
      '2026-09-13',
      'Week to Sun 13 Sep. Katie +0.22 km².',
      'Katie took the hill.',
      true,
      { players: 1 },
    );

    const [tool, args] = vi.mocked(executeTool).mock.calls[0];
    expect(tool).toBe('whatsapp_send');
    expect(String((args as { message: string }).message)).toContain(
      'https://strangeramblings.com/projects/landgrab',
    );
    expect(String((args as { message: string }).message)).toContain('Katie took the hill.');
    expect(r.details?.quota).toEqual({ weeklyPct: 0, fiveHourPct: 0 });
  });

  it('keeps the link when the letter runs past the 1200-character cap', async () => {
    // A 900-character narrative (the verifier's own ceiling) plus a long
    // summary overruns the cap. The prose is what may be cut, never the link.
    draftThen('SUPPORTED', 'K'.repeat(900));
    geo.phraseLandgrabWeek.mockReturnValue('Week to Sun 13 Sep. ' + 'S'.repeat(400));

    await landgrabWeekly.run(ctx());

    const message = String(
      (vi.mocked(executeTool).mock.calls[0][1] as { message: string }).message,
    );
    expect(message.length).toBeLessThanOrEqual(1200);
    expect(message.endsWith('https://strangeramblings.com/projects/landgrab')).toBe(true);
    expect(message.startsWith('\u{1F3C1} *Landgrab')).toBe(true);
  });

  it('drops an UNSUPPORTED draft whole and ships the summary', async () => {
    draftThen('UNSUPPORTED');
    const r = await landgrabWeekly.run(ctx());

    expect(r.outcome).toBe('ok');
    expect(geo.saveLandgrabWeekly).toHaveBeenCalledWith(
      '2026-09-13',
      expect.any(String),
      null,
      false,
      expect.any(Object),
    );
    expect(r.summary).toMatch(/UNSUPPORTED/);
  });

  it('falls to a chat note when WhatsApp will not take it', async () => {
    vi.mocked(executeTool).mockResolvedValue({ success: false } as never);
    vi.mocked(latestConversationId).mockResolvedValue('c1' as never);

    const r = await landgrabWeekly.run(ctx());

    expect(r.outcome).toBe('ok');
    expect(r.summary).toMatch(/→ chat/);
    expect(postHeartbeatNote).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        activityName: 'landgrab-weekly',
        text: expect.stringContaining('Katie took the hill.'),
      }),
    );
  });
});
