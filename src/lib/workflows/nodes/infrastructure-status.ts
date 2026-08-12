import type { ExecutionContext, JsonSchema, NodeExecutor, NodeResult } from '../types';
import { getHomeAssistantService } from '../homeassistant/service';
import { executeSiteTool } from '../site-tools/executor';
import { appendAtomic } from './data-store';

export { infrastructureStatusDef } from './infrastructure-status.def';

type Finding = { id: string; severity: 'ok' | 'warning' | 'critical' | 'unavailable'; summary: string; source: string; scope: string };
type Collector = { scope: string; source: string; status: 'ok' | 'warning' | 'critical' | 'unavailable'; data?: unknown; error?: string };
const SCOPES = ['all', 'home_assistant', 'production_app', 'homeserv', 'pi_runner', 'hermes'] as const;

function unavailable(scope: string, source: string, error: unknown): Collector {
  return { scope, source, status: 'unavailable', error: error instanceof Error ? error.message : String(error) };
}

async function collectHomeAssistant(): Promise<Collector> {
  try {
    const result = await getHomeAssistantService().queryAllStates();
    if (!result.success) return unavailable('home_assistant', 'Home Assistant API', result.error || 'No response');
    const states = Array.isArray(result.data) ? result.data as Array<{ entity_id?: string; state?: string }> : [];
    const bad = states.filter((state) => state.state === 'unavailable' || state.state === 'unknown');
    return { scope: 'home_assistant', source: 'Home Assistant API', status: bad.length ? 'warning' : 'ok', data: { entityCount: states.length, unavailableEntities: bad.map((s) => s.entity_id) } };
  } catch (error) { return unavailable('home_assistant', 'Home Assistant API', error); }
}

async function collectProduction(): Promise<Collector[]> {
  const jobs = await Promise.allSettled([executeSiteTool('scheduler_status', {}), executeSiteTool('scheduler_run_history', { limit: 10 }), executeSiteTool('system_logs', { lines: 50, filter: 'error' })]);
  return jobs.map((job, index) => {
    const source = ['workflow scheduler', 'scheduled workflow history', 'production system journal'][index];
    if (job.status === 'rejected') return unavailable('production_app', source, job.reason);
    if (!job.value.success) return unavailable('production_app', source, job.value.error || 'Tool unavailable');
    const data = job.value.data;
    const failed = Array.isArray(data) && data.some((row) => row && typeof row === 'object' && (row as { status?: string }).status === 'failed');
    return { scope: 'production_app', source, status: failed ? 'warning' : 'ok', data };
  });
}

export function findingsFromCollectors(collectors: Collector[]): Finding[] {
  return collectors.map((collector) => ({
    id: `${collector.scope}:${collector.source}`,
    severity: collector.status,
    scope: collector.scope,
    source: collector.source,
    summary: collector.status === 'unavailable' ? `Unavailable: ${collector.error || 'no live response'}` : collector.status === 'ok' ? 'Live check completed without a detected fault.' : 'Live check requires review; inspect collector evidence.',
  }));
}

export const infrastructureStatusExecutor: NodeExecutor = {
  type: 'infrastructure-status',
  async execute(_input: Record<string, unknown>, config: Record<string, unknown>, context: ExecutionContext): Promise<NodeResult> {
    const scope = SCOPES.includes(config.scope as typeof SCOPES[number]) ? config.scope as typeof SCOPES[number] : 'all';
    const collectors: Collector[] = [];
    if (scope === 'all' || scope === 'home_assistant') collectors.push(await collectHomeAssistant());
    if (scope === 'all' || scope === 'production_app') collectors.push(...await collectProduction());
    for (const absent of ['homeserv', 'pi_runner', 'hermes'] as const) {
      if (scope === 'all' || scope === absent) collectors.push(unavailable(absent, `${absent} server integration`, 'No bounded server-side collector is configured.'));
    }
    const findings = findingsFromCollectors(collectors);
    const report = { auditedAt: new Date().toISOString(), readOnly: true, scope, collectors, findings, updateCandidates: [] as unknown[] };
    if (!context.dryRun && context.workflowId) {
      const limit = Math.max(1, Math.min(52, Number(config.historyLimit) || 12));
      await appendAtomic(context.workflowId, 'infrastructure-audit-history', [report], limit);
    }
    return { output: report, rowCount: collectors.length, logs: ['Infrastructure audit is read-only; no update actions were attempted.'] };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Optional context; collectors use server-side integrations only.' }; },
  getOutputSchema(): JsonSchema { return { type: 'object', properties: { auditedAt: { type: 'string' }, readOnly: { type: 'boolean' }, collectors: { type: 'array' }, findings: { type: 'array' }, updateCandidates: { type: 'array' } } }; },
};
