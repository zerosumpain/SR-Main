/**
 * Does the explainer LOOK like the design system says it should?
 *
 * The studio gate answers "does it teach" — reachable, visual, interactive,
 * cited. Every one of those is structural, and a build can pass all four and
 * still be ugly, because until this stage existed nothing in the loop had ever
 * looked at a rendered pixel. The design system's whole footprint on a build
 * was a prompt block, a mount and three regexes (`design-lint.ts`: no raw hex,
 * no Tailwind, no bare font-family). All three check CONFORMANCE. A page that
 * violates none of them can still get the hierarchy, rhythm, palette weighting
 * and template discipline wrong, and nothing would say so.
 *
 * So: screenshot the chapters, hand them to a vision model together with the
 * kit's OWN written rubric, and feed the findings forward the way the gate's
 * findings already are.
 *
 * Two contracts, both inherited from studio-gate.ts and both load-bearing:
 *
 * - **A harness that could not run reports `ran: false`, never `passed: false`.**
 *   A broken harness reporting a failing app blocks good work and teaches the
 *   model to route around the tool.
 * - **Every finding carries a `remedy`.** An unfixable finding repeated three
 *   times kills a finished build — that is the design_lint_loop incident of
 *   2026-08-09, where a build whose app was complete and serving 200 was
 *   aborted over a finding in our own read-only reference file.
 *
 * This stage never aborts a build. The orchestrator appends its findings to the
 * iteration evaluation and moves on, exactly as it does for the gate.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getLLMClient } from '$lib/llm/client';
import { resolveDesignReviewModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import { execInSandbox } from './sandbox';
import type { ContentPart } from './media/multimodal';

export interface DesignFinding {
  /** The chapter the finding was seen on. */
  chapter: number;
  /** Short rule slug, e.g. `palette-weighting`, `bespoke-layout`. */
  rule: string;
  message: string;
  /**
   * What was actually VISIBLE that proves the finding.
   *
   * The one field that is not decoration. A vision model asked to judge a page
   * against a written rubric will happily report rules it cannot see from a
   * screenshot ("every number carries a source") in the same confident register
   * as the ones it can, and the build would then be handed fabricated work.
   * Requiring the model to name the pixels behind each finding is what makes an
   * invented one visibly empty; `parseReviewFindings` drops any finding whose
   * evidence is missing rather than passing it on.
   */
  evidence: string;
  /** What to change, named concretely. A finding with no remedy is a trap. */
  remedy: string;
}

export interface Shot {
  n: number;
  title: string;
  path: string;
  mime: string;
  base64: string;
}

export type ShotsOutcome =
  | { ran: true; shots: Shot[]; skipped: Array<{ n: number; reason: string }> }
  | { ran: false; reason: string };

export type DesignReviewOutcome =
  | { ran: true; passed: boolean; findings: DesignFinding[]; reviewed: number[]; modelId: string }
  | { ran: false; reason: string };

/** Findings above this are dropped. The whole point is a short actionable list
 *  the next iteration can hold in context alongside the gate's own findings;
 *  twenty design notes is a rewrite request, not a nudge. */
const MAX_FINDINGS = 8;

/** How many chapters get shot. Four is roughly where a reviewer stops being
 *  able to hold the whole thing in view, and it keeps the base64 payload well
 *  inside execInSandbox's 5MB exec buffer. */
const MAX_SHOTS = 4;

// --- The capture half -------------------------------------------------------

export function parseShotsOutput(stdout: string, stderr: string): ShotsOutcome {
  const line = (stdout ?? '').trim();
  if (!line) {
    return { ran: false, reason: stderr?.trim().slice(0, 300) || 'the shots harness printed nothing' };
  }
  const start = line.indexOf('{');
  if (start === -1) return { ran: false, reason: line.slice(0, 300) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(start));
  } catch {
    return { ran: false, reason: line.slice(0, 300) };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ran: false, reason: 'shots output was not an object' };
  }
  const r = parsed as Record<string, unknown>;
  if (r.ran !== true) {
    return { ran: false, reason: typeof r.reason === 'string' ? r.reason : 'the shots harness did not run' };
  }
  const shots = (Array.isArray(r.shots) ? r.shots : []).filter(
    (s): s is Shot =>
      Boolean(s) && typeof (s as Shot).base64 === 'string' && (s as Shot).base64.length > 0,
  );
  if (shots.length === 0) return { ran: false, reason: 'the shots harness returned no usable images' };
  const skipped = Array.isArray(r.skipped) ? (r.skipped as Array<{ n: number; reason: string }>) : [];
  return { ran: true, shots, skipped };
}

export async function captureShots(opts: {
  baseUrl: string;
  chapters: Array<{ n: number; title: string; path: string }>;
  maxShots?: number;
}): Promise<ShotsOutcome> {
  if (opts.chapters.length === 0) {
    return { ran: false, reason: 'no chapter plan on the build — nothing to look at' };
  }
  const payload = JSON.stringify({
    chapters: opts.chapters,
    maxShots: opts.maxShots ?? MAX_SHOTS,
  });
  const encoded = Buffer.from(payload, 'utf-8').toString('base64');
  // Base64 straight in, NOT `| base64 -d |` first: scripts/studio-shots.mjs
  // decodes its own stdin, the same convention as studio-gate.mjs. Pre-decoding
  // here feeds it double-decoded garbage and it reports
  // `could not parse the spec on stdin` on every single call.
  const cmd =
    `cd ${JSON.stringify(process.cwd())} && ` +
    `echo ${encoded} | node scripts/studio-shots.mjs ${JSON.stringify(opts.baseUrl)}`;
  try {
    // 240s: up to 4 navigations at a 20s timeout, each followed by a 1.2s
    // settle and a full-page JPEG encode. Runs outside the agent's own budget,
    // so the headroom costs nothing but wall-clock.
    const res = await execInSandbox(cmd, 240_000);
    return parseShotsOutput(res.stdout, res.stderr);
  } catch (err) {
    return {
      ran: false,
      reason: `could not run the shots harness: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// --- The rubric -------------------------------------------------------------

/**
 * The design half of the kit's own ship gate, plus the tokens that define the
 * palette and the type.
 *
 * Read from the kit on disk rather than restated here, for the same reason
 * `buildExplainerAssets` reads it: the kit is the design system for a studio
 * build, and a rubric copied into TypeScript is a second source of truth that
 * drifts silently. `static/` first, `build/client/` second — the deployed tree
 * has the latter and not always the former.
 *
 * Returns null when the kit cannot be read. The caller turns that into
 * `ran: false`, deliberately: a review with no rubric is not a weaker review,
 * it is a different one — generic taste dressed up as the house style, which is
 * exactly the "confident findings that correspond to nothing" failure this
 * stage exists to avoid.
 */
export async function readKitRubric(
  repoRoot: string = process.cwd(),
): Promise<{ designChecklist: string; tokens: string } | null> {
  const read = async (rel: string): Promise<string | null> => {
    for (const base of ['static/explainer-kit', 'build/client/explainer-kit']) {
      const body = await readFile(path.join(repoRoot, base, rel), 'utf-8').catch(() => null);
      if (body != null) return body;
    }
    return null;
  };
  const checklist = await read('field-study/CHECKLIST.md');
  const tokens = await read('tokens.css');
  if (checklist == null || tokens == null) return null;
  // Only the Design section. The rest of the ship gate is about argument
  // structure, sourcing and arithmetic — real rules, none of them decidable
  // from a picture, and handing them to a reviewer that can only see pixels is
  // an invitation to invent.
  return { designChecklist: designSectionOf(checklist), tokens: tokens.trim() };
}

/**
 * The `## Design` section of the kit's ship gate, or the whole thing if it has
 * no such heading.
 *
 * Sliced by hand rather than with a lookahead. The obvious regex ends
 * `(?=^##\s|\Z)` — and `\Z` is not a JavaScript anchor, it matches a literal
 * "Z". That pattern terminates the section only because "## Design" happens
 * today to be followed by "## Instruments"; move Design to the end of the file
 * and the match fails, silently handing the reviewer the whole ship gate
 * including every rule it cannot possibly see from a screenshot. Extracted as
 * its own function purely so a test can prove the last-section case, which the
 * real file cannot exercise.
 */
export function designSectionOf(checklist: string): string {
  const lines = checklist.split('\n');
  const start = lines.findIndex((l) => /^##\s*Design\s*$/.test(l.trim()));
  if (start === -1) return checklist.trim();
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n').trim();
}

export function reviewPrompt(rubric: { designChecklist: string; tokens: string }): string {
  return [
    'You are reviewing screenshots of chapters from an interactive explainer built against the Strange Ramblings explainer kit.',
    'Judge the RENDERED RESULT against the kit rubric below. You are the only stage of this build that sees pixels; a static linter already covers raw hex, Tailwind classes and bare font-family, so do not report those.',
    '',
    '--- Kit design rubric (the ship gate) ---',
    rubric.designChecklist,
    '',
    '--- Kit tokens (the palette and the type) ---',
    rubric.tokens,
    '',
    '--- How to answer ---',
    'Report ONLY what you can SEE in the images. For each finding name the visible evidence — the element, where it is, what it looks like. If a rule cannot be decided from a screenshot, do not report it: a confident finding about something you cannot see costs this build an iteration chasing nothing.',
    'Prefer the few findings that would most improve the page. Structural problems (bespoke layout, broken hierarchy, wrong palette weighting, cramped or arrhythmic spacing, unreadable measure) before small ones.',
    `At most ${MAX_FINDINGS} findings. An excellent page gets zero — say so rather than manufacturing work.`,
    '',
    'Answer with JSON only, no prose and no code fence:',
    '{"findings":[{"chapter":<number>,"rule":"<short-slug>","message":"<what is wrong>","evidence":"<what you can see that proves it>","remedy":"<the concrete change>"}]}',
  ].join('\n');
}

/**
 * Pull the findings out of a model reply.
 *
 * Tolerant of a code fence and of surrounding prose, because "JSON only" is an
 * instruction and not a guarantee. Returns null when nothing parseable came
 * back — which the caller reports as a skip, not as a pass.
 */
export function parseReviewFindings(text: string): DesignFinding[] | null {
  if (!text?.trim()) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(raw)) return null;
  const findings: DesignFinding[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const message = typeof r.message === 'string' ? r.message.trim() : '';
    const evidence = typeof r.evidence === 'string' ? r.evidence.trim() : '';
    const remedy = typeof r.remedy === 'string' ? r.remedy.trim() : '';
    // All three are required. A finding with no remedy is unfixable by
    // construction, and one with no evidence is the fabrication case the
    // `evidence` field exists to expose — dropping both is the whole guard.
    if (!message || !evidence || !remedy) continue;
    findings.push({
      chapter: Number.isFinite(r.chapter) ? Number(r.chapter) : 0,
      rule: typeof r.rule === 'string' && r.rule.trim() ? r.rule.trim().slice(0, 60) : 'design',
      message: message.slice(0, 400),
      evidence: evidence.slice(0, 400),
      remedy: remedy.slice(0, 400),
    });
  }
  return findings.slice(0, MAX_FINDINGS);
}

export function describeDesignReview(outcome: DesignReviewOutcome): string {
  if (!outcome.ran) return `Design review skipped — ${outcome.reason}`;
  const on = `chapter(s) ${outcome.reviewed.join(', ')} on ${outcome.modelId}`;
  if (outcome.passed) {
    return `Design review passed — nothing to change on ${on}.`;
  }
  const lines = outcome.findings.map(
    (f) => `  ✗ ch${f.chapter} [${f.rule}] ${f.message}\n     seen: ${f.evidence}\n     → ${f.remedy}`,
  );
  return `Design review — ${outcome.findings.length} finding(s) on ${on}:\n${lines.join('\n')}`;
}

// --- The stage --------------------------------------------------------------

export async function runDesignReview(opts: {
  buildId: string;
  baseUrl: string;
  /** Chapters that are actually finished. Reviewing a placeholder produces
   *  findings the agent has been explicitly told not to act on yet. */
  chapters: Array<{ n: number; title: string; path: string }>;
  maxShots?: number;
}): Promise<DesignReviewOutcome> {
  const rubric = await readKitRubric();
  if (!rubric) {
    return {
      ran: false,
      reason:
        'the explainer kit could not be read (static/explainer-kit and build/client/explainer-kit both missing) — reviewing without the kit rubric would be generic taste, not this design system',
    };
  }

  const shots = await captureShots({
    baseUrl: opts.baseUrl,
    chapters: opts.chapters,
    maxShots: opts.maxShots ?? MAX_SHOTS,
  });
  if (!shots.ran) return { ran: false, reason: shots.reason };

  const modelCtx = await resolveDesignReviewModel();
  const { client, model } = await getLLMClient(modelCtx);

  const content: ContentPart[] = [{ type: 'text', text: reviewPrompt(rubric) }];
  for (const s of shots.shots) {
    content.push({ type: 'text', text: `--- Chapter ${s.n}${s.title ? `: ${s.title}` : ''} (${s.path}) ---` });
    content.push({ type: 'image_url', image_url: { url: `data:${s.mime};base64,${s.base64}` } });
  }

  let text: string;
  let usageRaw: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  try {
    const response = await withActivity('design-review', () =>
      client.chat.completions.create({
        model,
        max_tokens: 2048,
        // The cast is the same one every multimodal call site in this repo
        // makes: ContentPart is our shape, and the SDK's own part union is
        // narrower than what OpenRouter actually accepts.
        messages: [{ role: 'user', content: content as never }],
      }),
    );
    text = response.choices[0]?.message?.content ?? '';
    usageRaw = response.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  } catch (err) {
    return {
      ran: false,
      reason: `the review model failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Priced on the REVIEW model, not the build's. `jkai_builds.price_snapshot`
  // is the snapshot taken for whatever the build itself runs on, and this stage
  // deliberately runs on a different one — using the build's would file this
  // spend at the wrong rate. Tokens are counted either way; a null snapshot
  // only means cost stays 0, which is already true for any codex/ model.
  await recordBuildUsage(opts.buildId, parseUsage(usageRaw), await snapshotPrice(modelCtx));

  const findings = parseReviewFindings(text);
  if (findings == null) {
    return {
      ran: false,
      reason: `the review model returned nothing parseable: ${text.trim().slice(0, 200) || '(empty)'}`,
    };
  }
  return {
    ran: true,
    passed: findings.length === 0,
    findings,
    reviewed: shots.shots.map((s) => s.n),
    modelId: modelCtx.modelId,
  };
}
