// src/lib/selfimprove/deployment.ts
//
// Acceptance and promotion evidence for capabilities shipped by self-improve.
// A build-time smoke test proves the generated handler once; this module turns
// that into an owner-runnable acceptance path against the handler that is live
// now, plus a natural JKAI prompt that tests whether the assistant can find it.

import type { CustomToolHealth } from './context';
import type { LiveToolTest, ToolAttemptData } from './types';
import type { ToolResult } from '$lib/workflows/site-tools/registry-internal';

export interface AttemptEvidenceRow {
  key: string;
  createdAt: string;
  data: ToolAttemptData;
}

export interface DeployedCapability {
  name: string;
  description: string;
  toolset: string;
  enabled: boolean;
  runCount: number;
  errorCount: number;
  /** Calls not initiated by this room. This is an estimate for legacy rows. */
  jkaiRuns: number;
  attemptKey: string;
  sampleArgs: Record<string, unknown>;
  jkaiTestPrompt: string;
  liveTests: LiveToolTest[];
  lastLiveTest: LiveToolTest | null;
  promoted: boolean;
  promotionTrial: boolean;
  promotionReady: boolean;
  createdAt?: string;
  lastRunAt?: string;
}

export const PROMOTION_MIN_JKAI_RUNS = 2;

function sentence(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
}

/**
 * A natural acceptance prompt, intentionally outcome-led and tool-name-free.
 * Naming the tool would only prove invocation; this is meant to prove JKAI can
 * discover the new capability from an ordinary request.
 */
export function jkaiTestPromptFor(input: {
  authored?: string;
  serves?: string;
  description: string;
}): string {
  const authored = sentence(input.authored ?? '');
  if (authored) return authored.slice(0, 600);

  const rawNeed = sentence(input.serves ?? input.description)
    .replace(/^you could not ask\s+/i, 'tell me ')
    .replace(/^the user (?:could not|cannot)\s+/i, '');
  const need = rawNeed || 'demonstrate the new live capability';
  return (
    `${need.charAt(0).toUpperCase()}${need.slice(1)}. ` +
    'Use current live data where relevant, and briefly say which JKAI capability you used.'
  ).slice(0, 600);
}

/** Join durable build evidence to the live registry rows the owner can test. */
export function buildDeployedCapabilities(
  attempts: AttemptEvidenceRow[],
  tools: CustomToolHealth[],
  promotedNames: string[] = [],
  activeTrialTarget?: string,
): DeployedCapability[] {
  const promoted = new Set(promotedNames);
  const latest = new Map<string, AttemptEvidenceRow>();
  const harnessRuns = new Map<string, number>();

  for (const row of attempts) {
    const data = row.data;
    const tests = data.liveTests ?? [];
    harnessRuns.set(data.name, (harnessRuns.get(data.name) ?? 0) + tests.length);
    if (data.status !== 'created' || data.shipped === false || latest.has(data.name)) continue;
    latest.set(data.name, row);
  }

  return tools
    .flatMap((tool): DeployedCapability[] => {
      const attempt = latest.get(tool.name);
      // The attempt is the proof this is a self-improvement deployment. This
      // also keeps user-authored and ephemeral custom tools off this surface.
      if (!attempt) return [];
      const tests = [...(attempt.data.liveTests ?? [])].sort((a, b) =>
        b.testedAt.localeCompare(a.testedAt),
      );
      const jkaiRuns = Math.max(0, tool.runCount - (harnessRuns.get(tool.name) ?? 0));
      const lastLiveTest = tests[0] ?? null;
      return [{
        name: tool.name,
        description: tool.description,
        toolset: tool.toolset ?? attempt.data.toolset,
        enabled: tool.enabled,
        runCount: tool.runCount,
        errorCount: tool.errorCount,
        jkaiRuns,
        attemptKey: attempt.key,
        sampleArgs: attempt.data.sampleArgs ?? {},
        jkaiTestPrompt: jkaiTestPromptFor({
          authored: attempt.data.jkaiTestPrompt,
          description: tool.description,
        }),
        liveTests: tests,
        lastLiveTest,
        // A running trial necessarily contains the name in
        // `promoteToEssential`, but it is not a kept promotion yet.
        promoted: promoted.has(tool.name) && activeTrialTarget !== tool.name,
        promotionTrial: activeTrialTarget === tool.name,
        promotionReady:
          tool.enabled &&
          lastLiveTest?.success === true &&
          jkaiRuns >= PROMOTION_MIN_JKAI_RUNS &&
          tool.errorRate <= 0.25 &&
          !promoted.has(tool.name),
        createdAt: tool.createdAt,
        lastRunAt: tool.lastRunAt,
      }];
    })
    .sort((a, b) => {
      // Work needing proof first, then promotion candidates, then newest.
      const proofA = a.lastLiveTest?.success ? 1 : 0;
      const proofB = b.lastLiveTest?.success ? 1 : 0;
      return proofA - proofB || Number(b.promotionReady) - Number(a.promotionReady) ||
        (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
}

export function pickPromotionCandidate(capabilities: DeployedCapability[]): DeployedCapability | null {
  return capabilities
    .filter((c) => c.promotionReady && !c.promotionTrial)
    .sort((a, b) => b.jkaiRuns - a.jkaiRuns || a.errorCount - b.errorCount)[0] ?? null;
}

/** Server-side evidence load used by the autonomous promotion step. */
export async function loadDeployedCapabilitiesForPromotion(
  promotedNames: string[],
  activeTrialTarget?: string,
): Promise<DeployedCapability[]> {
  try {
    const [{ getCollectionBySlug, queryRecords }, { COLLECTIONS, SYSTEM_ACTOR }, { loadCustomToolHealth }] =
      await Promise.all([
        import('$lib/datastore'),
        import('./types'),
        import('./context'),
      ]);
    if (!(await getCollectionBySlug(COLLECTIONS.toolAttempts))) return [];
    const [{ records }, tools] = await Promise.all([
      queryRecords(
        COLLECTIONS.toolAttempts,
        { sort: { field: 'createdAt', dir: 'desc' }, limit: 500 },
        SYSTEM_ACTOR,
      ),
      loadCustomToolHealth(),
    ]);
    const attempts: AttemptEvidenceRow[] = records.map((r) => ({
      key: r.key ?? r.id,
      createdAt: r.createdAt.toISOString(),
      data: r.data as unknown as ToolAttemptData,
    }));
    return buildDeployedCapabilities(attempts, tools, promotedNames, activeTrialTarget);
  } catch (err) {
    console.error('[selfimprove] promotion evidence load failed:', err);
    return [];
  }
}

export interface LiveExecution {
  result: ToolResult;
  test: LiveToolTest;
}

function resultSummary(result: ToolResult): string | undefined {
  if (!result.success && result.error) return result.error.slice(0, 1000);
  try {
    const text = JSON.stringify(result.data);
    return text ? text.slice(0, 2000) : undefined;
  } catch {
    return String(result.data).slice(0, 2000);
  }
}

/** Run one bounded test through the same registry seam JKAI invokes. */
export async function runLiveToolTest(
  args: Record<string, unknown>,
  invoke: (args: Record<string, unknown>) => Promise<ToolResult>,
  timeoutMs = 12_000,
): Promise<LiveExecution> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      invoke(args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const valid = result && typeof result === 'object' && typeof result.success === 'boolean';
    const normalised: ToolResult = valid
      ? result
      : { success: false, error: 'handler did not return { success: boolean }' };
    return {
      result: normalised,
      test: {
        testedAt: new Date().toISOString(),
        args,
        success: normalised.success,
        ms: Date.now() - started,
        error: normalised.success ? undefined : (normalised.error ?? 'tool returned failure'),
        resultSummary: resultSummary(normalised),
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const result = { success: false, error };
    return {
      result,
      test: {
        testedAt: new Date().toISOString(),
        args,
        success: false,
        ms: Date.now() - started,
        error,
        resultSummary: error.slice(0, 1000),
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
