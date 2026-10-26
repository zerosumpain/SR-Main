// The background job a capture runs once its audio has arrived (or straight
// away when the phone sent none): transcript, one structured model call, the
// screenshot's vision pass, the graph extract, then "ready" and a push.
//
// In-process and fire-and-forget, like the chat's pre-analysis: the PUT that
// triggers it returns 204 at once. `claimForAnalysis` makes the start atomic,
// and a capture left `received`/`analysing` by a restart is picked up again by
// `healStuckCapture` the next time the phone opens it.
//
// Models by role, never by id (CLAUDE.md): `extraction` for the analysis,
// `vision` for the screenshot, `audio` (inside extractAudio) for the server
// transcript. Spend is recorded per capture; an unpriceable call makes the
// total null — unknown, not free.

import type { Capture } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { withActivity } from '$lib/context/activity';
import { priceFor, computeCost } from '$lib/llm/pricing';
import { resolveExtractionModel, resolveVisionModel } from '$lib/server/models/workload-settings';
import { getModelCapabilities } from '$lib/server/models/capabilities';
import { analysisPrompt, ANALYSIS_SYSTEM, parseJsonReply, SCREEN_SYSTEM, type PromptInput } from './prompt';
import { validateAnalysis, validateScreenReply } from './validate';
import { claimForAnalysis, getCaptureById, replaceProposedActions, updateCapture } from './store.server';
import { readCaptureMedia } from './media.server';
import { queueCaptureExtract } from './graph.server';
import { appOf, screenOf, speakersOf } from './view';
import type { CaptureScreen, CaptureTurn } from './types';

/** The recorder, as the analysis names him. Owner-only today. */
export const OWNER_NAME = 'John';

/**
 * Apps whose screen never goes to a model, matched against the phone's hint
 * and the OCR'd chrome. The phone has its own list (Settings → Captures) and
 * marks `denied`; this is the server's backstop for one it missed.
 */
const DENY_APPS = /\b(bank|banking|monzo|starling|barclays|hsbc|natwest|lloyds|santander|nationwide|revolut|paypal|1password|bitwarden|lastpass|keychain|passwords)\b/i;

export function screenIsDenied(screen: CaptureScreen | null, appHint: string | null): boolean {
  if (screen?.denied) return true;
  return DENY_APPS.test(appHint ?? '') || DENY_APPS.test((screen?.ocrText ?? '').slice(0, 300));
}

const inFlight = new Set<string>();

type Usage = { prompt_tokens?: number; completion_tokens?: number } | undefined;

/** Dollars for one call, or null when the model cannot be priced. */
function costOf(model: string, usage: Usage): number | null {
  const pricing = priceFor('openrouter', model);
  if (!pricing || !usage) return null;
  return computeCost(pricing, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
}

/** Start the job unless one is already running for this capture. Never throws. */
export function startCaptureAnalysis(id: string): void {
  if (inFlight.has(id)) return;
  void (async () => {
    if (!(await claimForAnalysis(id).catch(() => false))) return;
    inFlight.add(id);
    try {
      await runCaptureAnalysis(id);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      console.error(`[captures] analysis of ${id} failed:`, message);
      await updateCapture(id, { status: 'failed', error: 'The analysis did not finish. Open the capture to try again.' }).catch(() => {});
    } finally {
      inFlight.delete(id);
    }
  })();
}

/** A capture whose job a restart interrupted: older than this in `analysing` is retried. */
const STUCK_MS = 10 * 60_000;

/**
 * Called when the phone reads a capture. Restarts a job that died with its
 * process, and a `received` capture whose audio is not coming (the phone said
 * `audio:false`) or has been sitting with its audio already in.
 */
export function healStuckCapture(c: Capture): boolean {
  const intake = (c.intake ?? {}) as { audio?: boolean };
  const age = Date.now() - c.updatedAt.getTime();
  const waitingForAudio = intake.audio !== false && !c.audioUploadId;
  if (c.status === 'received' && !waitingForAudio && age > 60_000) {
    startCaptureAnalysis(c.id);
    return true;
  }
  if (c.status === 'analysing' && age > STUCK_MS && !inFlight.has(c.id)) {
    // Back to received so the claim can take it again.
    void updateCapture(c.id, { status: 'received' }).then(() => startCaptureAnalysis(c.id)).catch(() => {});
    return true;
  }
  return false;
}

async function serverTranscript(c: Capture): Promise<string> {
  if (!c.audioUploadId) return '';
  const media = await readCaptureMedia(c.audioUploadId);
  if (!media) return '';
  const { extractAudio } = await import('$lib/jkai/extract/audio');
  const out = await extractAudio(media.buf, media.mimeType, `${c.id}.m4a`, { language: 'en' });
  return (out.text ?? '').trim();
}

async function overlappingEvents(c: Capture): Promise<PromptInput['calendar']> {
  try {
    const from = new Date(c.startedAt.getTime() - 15 * 60_000).toISOString();
    const to = new Date((c.endedAt ?? c.startedAt).getTime() + 15 * 60_000).toISOString();
    const { readCalendar } = await import('$lib/calendar/read');
    const read = await readCalendar({ dateRangeStart: from, dateRangeEnd: to });
    if (!read.available) return [];
    return read.events.map((e) => ({ title: e.title, start: e.start, end: e.end, location: e.location }));
  } catch {
    // Unreadable calendar: skip it (CONTRACT step 2).
    return [];
  }
}

async function visionPass(c: Capture): Promise<{ app: { name: string; confidence: number } | null; summary: string; cost: number | null } | null> {
  if (!c.screenUploadId) return null;
  const media = await readCaptureMedia(c.screenUploadId);
  if (!media) return null;
  const ctx = await resolveVisionModel();
  // A text-only model would answer about the prompt and ignore the image.
  if (!getModelCapabilities(ctx).image) return null;
  const { client, model } = await getLLMClient(ctx);
  const res = await withActivity('vision', () =>
    client.chat.completions.create({
      model,
      max_tokens: 400,
      temperature: 0,
      messages: [
        { role: 'system', content: SCREEN_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'The screenshot:' },
            { type: 'image_url', image_url: { url: `data:${media.mimeType};base64,${media.buf.toString('base64')}` } },
          ],
        },
      ],
    }),
  );
  const reply = validateScreenReply(parseJsonReply(res.choices[0]?.message?.content ?? ''));
  return { ...reply, cost: costOf(model, res.usage as Usage) };
}

export async function runCaptureAnalysis(id: string): Promise<void> {
  let c = await getCaptureById(id);
  if (!c) return;
  let cost: number | null = 0;
  const addCost = (n: number | null) => {
    cost = cost === null || n === null ? null : cost + n;
  };

  // 1. Transcript: the phone's, else the server's.
  if (!c.transcript.trim()) {
    const text = await serverTranscript(c);
    c = (await updateCapture(c.id, { transcript: text, transcriptSource: 'server' })) ?? c;
  }

  // 3 (first, so step 2 can read it). The screenshot.
  const intake = (c.intake ?? {}) as { appHint?: string | null };
  let screen = screenOf(c);
  if (screen || c.screenUploadId) {
    const denied = screenIsDenied(screen, intake.appHint ?? null);
    const base: CaptureScreen = screen ?? { app: null, summary: '', ocrText: '' };
    if (denied) {
      // No image call: the app comes from the hint alone.
      screen = { ...base, denied: true, app: intake.appHint ? { name: intake.appHint, confidence: 0.5 } : base.app };
    } else {
      const seen = await visionPass(c).catch((err) => {
        console.warn(`[captures] vision pass for ${c!.id} failed:`, err instanceof Error ? err.message : err);
        return null;
      });
      if (seen) {
        addCost(seen.cost);
        screen = { ...base, app: seen.app ?? base.app, summary: seen.summary || base.summary };
      } else if (intake.appHint && !base.app) {
        screen = { ...base, app: { name: intake.appHint, confidence: 0.5 } };
      }
    }
    c = (await updateCapture(c.id, { screen: screen as unknown as Record<string, unknown> })) ?? c;
  }

  // 2. One structured call on the extraction role.
  const speakers = speakersOf(c);
  if (c.transcript.trim()) {
    const prompt = analysisPrompt({
      ownerName: OWNER_NAME,
      startedAt: c.startedAt.toISOString(),
      endedAt: c.endedAt?.toISOString() ?? null,
      transcript: c.transcript,
      turns: (c.turns ?? []) as CaptureTurn[],
      speakers,
      calendar: await overlappingEvents(c),
      screen: screen ? { app: appOf(c) ?? null, ocrText: screen.ocrText, summary: screen.summary } : null,
      place: (c.place as PromptInput['place']) ?? null,
    });
    const { client, model } = await getLLMClient(await resolveExtractionModel());
    const res = await withActivity('extraction', () =>
      client.chat.completions.create({
        model,
        temperature: 0.1,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    );
    addCost(costOf(model, res.usage as Usage));
    const parsed = parseJsonReply(res.choices[0]?.message?.content ?? '');
    if (!parsed) throw new Error('the analysis model returned no JSON');
    const { analysis, dropped } = validateAnalysis(parsed, speakers, OWNER_NAME);
    if (dropped.length) console.warn(`[captures] ${c.id}: dropped ${dropped.length} item(s) from the analysis`);
    c =
      (await updateCapture(c.id, {
        // An owner's title is theirs: the analysis does not overwrite it.
        title: c.title || analysis.title,
        summary: analysis.summary,
        flow: analysis.flow,
        entities: analysis.entities,
        speakers: analysis.speakers,
      })) ?? c;
    await replaceProposedActions(c, analysis.actions);
  } else {
    c = (await updateCapture(c.id, { title: c.title || 'Capture (no speech)', summary: '' })) ?? c;
  }

  // 4. The graph. A failure to queue is logged, not fatal: the capture is
  // still readable, and the next PATCH re-queues it.
  await queueCaptureExtract(c).catch((err) => console.warn(`[captures] extract for ${c!.id} not queued:`, err instanceof Error ? err.message : err));

  // 5. Ready.
  const prior = c.analysisCostUsd == null ? null : Number(c.analysisCostUsd);
  const total: number | null = cost === null ? null : (prior ?? 0) + cost;
  await updateCapture(c.id, { status: 'ready', error: null, analysisCostUsd: total === null ? null : total.toFixed(6) });
  await notifyReady(c).catch(() => {});
}

async function notifyReady(c: Capture): Promise<void> {
  const { notifyOwner } = await import('$lib/server/notify');
  await notifyOwner({
    category: 'captures',
    title: 'Capture ready',
    body: c.title || 'Your recording has been analysed.',
    url: `sr://captures/${c.id}`,
    severity: 'info',
    dedupeKey: `capture-ready:${c.id}`,
    data: { captureId: c.id },
  });
}
