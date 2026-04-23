/**
 * playbook-runner-v2.ts
 *
 * Deterministic replay for Playbook v2 — executes the recorded navigation
 * steps through site-mapper-agent.py, then applies the extract rules on
 * whatever page the sequence landed on. Shared by site-mapper validation
 * and stealth-scrape's playbook dispatch.
 */

import { startAgent } from './agent-harness';
import { interpolateVars, type Playbook, type PlaybookStep, type RunPlaybookOptions, type RunPlaybookResult } from './playbook';
import { db } from '$lib/db';
import { scraperRunLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export async function runPlaybookV2(opts: RunPlaybookOptions): Promise<RunPlaybookResult> {
  const { playbook, vars = {}, profile = 'default', workflowRunId, onProgress } = opts;
  const steps: PlaybookStep[] = playbook.steps ?? [];
  const seedUrl = firstGotoUrl(steps, vars) ?? '';

  const [logRow] = await db.insert(scraperRunLog).values({
    url: seedUrl,
    profile,
    workflowRunId: workflowRunId ?? null,
  }).returning();

  const agent = await startAgent(profile);
  let landedUrl = '';
  let error: string | undefined;
  let fields: Record<string, unknown> = {};
  let success = false;

  try {
    for (const step of steps) {
      onProgress?.({ t: 'playbook.step', step });
      switch (step.type) {
        case 'goto': {
          const url = interpolateVars(step.url, vars);
          const r = await agent.goto(url);
          landedUrl = r.url;
          break;
        }
        case 'wait': {
          await agent.wait({ selector: step.selector, ms: step.ms, timeoutMs: step.timeoutMs });
          break;
        }
        case 'click': {
          const r = await agent.click({ selector: step.selector, text: step.text });
          landedUrl = r.url || landedUrl;
          break;
        }
        case 'fill': {
          const value = interpolateVars(step.value, vars);
          await agent.fill(step.selector, value);
          break;
        }
        case 'select': {
          await agent.select(step.selector, step.value);
          break;
        }
        case 'submit': {
          const r = await agent.submit(step.formSelector);
          landedUrl = r.url || landedUrl;
          break;
        }
        case 'altcha': {
          await agent.altcha();
          break;
        }
        default:
          // Unknown step type — ignore so future additions don't crash old runners.
          break;
      }
    }

    // Apply extract rules on the final page.
    onProgress?.({ t: 'playbook.extract' });
    const extractResult = await agent.extract(playbook.extract as unknown as Array<Record<string, unknown>>);
    fields = extractResult.fields;
    success = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    onProgress?.({ t: 'playbook.error', error });
  } finally {
    await agent.close();
  }

  await db.update(scraperRunLog).set({
    endedAt: new Date(),
    success,
    pagesLoaded: success ? 1 : 0,
    error: error ?? null,
  }).where(eq(scraperRunLog.id, logRow.id));

  // ExtractedPage requires fields typed as Record<string, string|string[]>;
  // the agent's extract rules honour that contract (text/html/attr → string,
  // multi → string[]) so the cast is safe.
  const page = success
    ? { url: landedUrl, fields: fields as Record<string, string | string[]> }
    : null;
  const pages = page ? [page] : [];
  const itemCount = success ? countItems(fields, playbook) : 0;

  return {
    success,
    pages,
    error,
    runLogId: logRow.id,
    acceptanceMet: itemCount >= playbook.acceptance.minItems,
    itemCount,
  };
}

function firstGotoUrl(steps: PlaybookStep[], vars: Record<string, string>): string | null {
  for (const s of steps) if (s.type === 'goto') return interpolateVars(s.url, vars);
  return null;
}

function countItems(fields: Record<string, unknown>, playbook: Playbook): number {
  const val = fields[playbook.acceptance.sampleField];
  if (Array.isArray(val)) return val.length;
  if (val != null && val !== '') return 1;
  return 0;
}
