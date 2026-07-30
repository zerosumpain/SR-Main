/**
 * Probe against REAL production data, not fixtures.
 *
 * Skipped unless SELFIMPROVE_PROBE points at a JSON dump of the live ledger.
 * The two prompt defects that zeroed the engine's yield were both invisible to
 * unit tests and obvious the moment real data went through — same discipline
 * here: the page is only trustworthy if the derivation survives what production
 * actually contains.
 *
 *   SELFIMPROVE_PROBE=/path/prod-ledger.json npx vitest run narrative.probe
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildStories, summariseStories } from './narrative';
import type { NarrativeInput } from './narrative';

const path = process.env.SELFIMPROVE_PROBE;

describe.skipIf(!path)('narrative over live production data', () => {
  it('produces readable cards from the real ledger', () => {
    const raw = JSON.parse(readFileSync(path as string, 'utf8')) as NarrativeInput;
    const stories = buildStories(raw);

    const lines: string[] = [];
    lines.push(`runs=${raw.runs.length} backlog=${raw.backlog.length} tools=${raw.toolHealth.length}`);
    lines.push(`summary=${JSON.stringify(summariseStories(stories))}`);
    for (const s of stories) {
      lines.push('');
      lines.push(`── [${s.statusLabel.toUpperCase()}] ${s.title}   (${s.kind}:${s.subject})`);
      if (s.subtitle) lines.push(`   ${s.subtitle}`);
      if (s.note) lines.push(`   NOTE     ${s.note}`);
      lines.push(`   DRIVER   (${s.linkConfidence}) ${s.driver}`);
      if (s.driverEvidence) lines.push(`            evidence: ${s.driverEvidence}`);
      if (s.driverQuotes?.length) lines.push(`            quotes: ${s.driverQuotes.join(' | ')}`);
      lines.push(`   SOLUTION ${s.solution}`);
      lines.push(`   OUTCOME  (${s.outcomeKind}) ${s.outcome}`);
      lines.push(`   ARC      ${s.events.map((e) => `${e.at.slice(0, 10)} ${e.label}`).join(' → ')}`);
    }
    // Vitest swallows console output for passing tests off a TTY, and the whole
    // value of this probe is READING what it produced — so write it out.
    const report = lines.join('\n');
    const out = process.env.SELFIMPROVE_PROBE_OUT;
    if (out) writeFileSync(out, report, 'utf8');
    console.log(report);

    expect(stories.length).toBeGreaterThan(0);

    // `driver` and `outcome` quote upstream text verbatim — a real production
    // failure reads "Cannot read properties of undefined (reading 'success')",
    // so the bare word cannot be treated as a template artefact there. Only the
    // wholly template-composed fields get the strict check.
    const ARTEFACT = /\[object |\bNaN\b|Invalid Date/;
    const STRICT = /\bundefined\b|\bnull\b|\[object |\bNaN\b|Invalid Date/;

    for (const s of stories) {
      // No card may render with an empty column — that is the whole point.
      expect(s.driver.length).toBeGreaterThan(10);
      expect(s.solution.length).toBeGreaterThan(10);
      expect(s.outcome.length).toBeGreaterThan(10);
      expect(s.title.trim()).not.toBe('');

      expect(s.title, s.id).not.toMatch(STRICT);
      expect(s.subtitle ?? '', s.id).not.toMatch(STRICT);
      expect(s.solution, s.id).not.toMatch(STRICT);
      expect(s.driver, s.id).not.toMatch(ARTEFACT);
      expect(s.outcome, s.id).not.toMatch(ARTEFACT);
      // An unresolved date interpolation is the artefact that would matter most.
      expect(s.outcome, s.id).not.toMatch(/since undefined|an unknown date/);
    }
  });
});
