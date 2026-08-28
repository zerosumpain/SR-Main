import type { ExecutionContext, JsonSchema, NodeExecutor, NodeResult } from '../types';
import { getHomeAssistantService } from '../homeassistant/service';
import { executeSiteTool } from '../site-tools/executor';
import { appendAtomic } from './data-store';

export { infrastructureStatusDef } from './infrastructure-status.def';

type Finding = { id: string; severity: 'ok' | 'warning' | 'critical' | 'unavailable'; summary: string; source: string; scope: string };
type Collector = { scope: string; source: string; status: 'ok' | 'warning' | 'critical' | 'unavailable'; data?: unknown; error?: string };
type HAState = { entity_id?: string; state?: string; last_updated?: string; attributes?: Record<string, unknown> };
type Release = { version: string; url: string; publishedAt: string; notes: string[] };
type VersionReview = {
  capability: string; collector: string; currentVersion: string | null; currentEvidence: { timestamp: string | null; source: string } | null;
  latestVersion: string | null; releaseUrl: string | null; releaseDate: string | null; benefits: string[];
  implications: { restart: string; migration: string; breakingChanges: string }; recommendation: 'upgrade now' | 'review first' | 'defer' | 'unavailable'; reason: string; confidence: 'high' | 'medium' | 'low'; unavailable?: string;
};
const SCOPES = ['all', 'home_assistant', 'production_app', 'homeserv', 'pi_runner'] as const;
const RELEASES: Record<string, { capability: string; url: string }> = {
  home_assistant_core: { capability: 'Home Assistant Core', url: 'https://api.github.com/repos/home-assistant/core/releases/latest' },
  home_assistant_os: { capability: 'Home Assistant OS', url: 'https://api.github.com/repos/home-assistant/operating-system/releases/latest' },
  life360: { capability: 'Life360', url: 'https://api.github.com/repos/pnbruckner/ha-life360/releases/latest' },
  alexa_media_player: { capability: 'Alexa Media Player', url: 'https://api.github.com/repos/alexa-media-player/alexa_media_player/releases/latest' },
};

function unavailable(scope: string, source: string, error: unknown): Collector { return { scope, source, status: 'unavailable', error: error instanceof Error ? error.message : String(error) }; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function releaseNotes(body: unknown): string[] {
  if (typeof body !== 'string') return [];
  return body.split('\n').map((line) => line.replace(/^\s*(?:[-*+]\s+|#{1,6}\s+)/, '').trim()).filter((line) => line.length > 20 && !/^(release notes|full changelog|thanks|see also)/i.test(line)).slice(0, 3);
}
async function latestRelease(key: keyof typeof RELEASES): Promise<Release | null> {
  const response = await fetch(RELEASES[key].url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`Publisher release lookup returned ${response.status}`);
  const json = await response.json() as Record<string, unknown>;
  const version = text(json.tag_name);
  const url = text(json.html_url);
  const publishedAt = text(json.published_at);
  if (!version || !url || !publishedAt) throw new Error('Publisher release metadata was incomplete');
  return { version, url, publishedAt, notes: releaseNotes(json.body) };
}
function review(capability: string, collector: string, current: string | null, timestamp: string | null, release: Release | null, error?: unknown): VersionReview {
  if (!current || !release) return { capability, collector, currentVersion: current, currentEvidence: current ? { timestamp, source: collector } : null, latestVersion: null, releaseUrl: null, releaseDate: null, benefits: [], implications: { restart: 'unknown', migration: 'unknown', breakingChanges: 'unknown' }, recommendation: 'unavailable', reason: error ? String(error) : 'Current version or official publisher release data is unavailable.', confidence: 'low', unavailable: error ? String(error) : 'Current version or official publisher release data is unavailable.' };
  const same = current.replace(/^v/, '') === release.version.replace(/^v/, '');
  return { capability, collector, currentVersion: current, currentEvidence: { timestamp, source: collector }, latestVersion: release.version, releaseUrl: release.url, releaseDate: release.publishedAt, benefits: release.notes, implications: { restart: 'unknown', migration: 'unknown', breakingChanges: 'unknown' }, recommendation: same ? 'defer' : 'review first', reason: same ? 'Installed version matches the official latest stable release.' : 'A newer official stable release is available; review compatibility before applying.', confidence: release.notes.length ? 'medium' : 'low' };
}
function updateState(states: HAState[], terms: string[]): HAState | undefined { return states.find((state) => state.entity_id?.startsWith('update.') && terms.some((term) => `${state.entity_id} ${state.attributes?.friendly_name || ''}`.toLowerCase().includes(term))); }
function versionFrom(state: HAState | undefined, key: 'installed_version' | 'latest_version'): string | null { return text(state?.attributes?.[key]) || (key === 'latest_version' ? text(state?.state) : null); }

async function collectHomeAssistant(): Promise<{ collector: Collector; reviews: VersionReview[] }> {
  try {
    const result = await getHomeAssistantService().queryAllStates();
    if (!result.success) return { collector: unavailable('home_assistant', 'Home Assistant API', result.error || 'No response'), reviews: [] };
    const states = Array.isArray(result.data) ? result.data as HAState[] : [];
    const bad = states.filter((state) => state.state === 'unavailable' || state.state === 'unknown');
    const candidates: Array<[keyof typeof RELEASES, HAState | undefined]> = [
      ['home_assistant_core', updateState(states, ['home_assistant_core', 'home assistant core'])],
      ['home_assistant_os', updateState(states, ['home_assistant_operating_system', 'home assistant operating system'])],
      ['life360', updateState(states, ['life360'])],
      ['alexa_media_player', updateState(states, ['alexa_media'])],
    ];
    const reviews = await Promise.all(candidates.map(async ([key, state]) => {
      const current = versionFrom(state, 'installed_version');
      try { return review(RELEASES[key].capability, 'Home Assistant update entity + official GitHub Releases', current, state?.last_updated || null, await latestRelease(key)); }
      catch (error) { return review(RELEASES[key].capability, 'Home Assistant update entity + official GitHub Releases', current, state?.last_updated || null, null, error); }
    }));
    return { collector: { scope: 'home_assistant', source: 'Home Assistant API', status: bad.length ? 'warning' : 'ok', data: { entityCount: states.length, unavailableEntities: bad.map((s) => s.entity_id) } }, reviews };
  } catch (error) { return { collector: unavailable('home_assistant', 'Home Assistant API', error), reviews: [] }; }
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
export function findingsFromCollectors(collectors: Collector[]): Finding[] { return collectors.map((collector) => ({ id: `${collector.scope}:${collector.source}`, severity: collector.status, scope: collector.scope, source: collector.source, summary: collector.status === 'unavailable' ? `Unavailable: ${collector.error || 'no live response'}` : collector.status === 'ok' ? 'Live check completed without a detected fault.' : 'Live check requires review; inspect collector evidence.' })); }
function unavailableReview(capability: string, collector: string): VersionReview { return review(capability, collector, null, null, null); }

export const infrastructureStatusExecutor: NodeExecutor = {
  type: 'infrastructure-status',
  async execute(_input: Record<string, unknown>, config: Record<string, unknown>, context: ExecutionContext): Promise<NodeResult> {
    const scope = SCOPES.includes(config.scope as typeof SCOPES[number]) ? config.scope as typeof SCOPES[number] : 'all';
    const collectors: Collector[] = []; const versionReviews: VersionReview[] = [];
    if (scope === 'all' || scope === 'home_assistant') { const homeAssistant = await collectHomeAssistant(); collectors.push(homeAssistant.collector); versionReviews.push(...homeAssistant.reviews); }
    if (scope === 'all' || scope === 'production_app') { collectors.push(...await collectProduction()); versionReviews.push(unavailableReview('strangeramblings production application', 'No bounded version collector configured')); }
    for (const absent of ['homeserv', 'pi_runner'] as const) if (scope === 'all' || scope === absent) { collectors.push(unavailable(absent, `${absent} server integration`, 'No bounded server-side collector is configured.')); versionReviews.push(unavailableReview(absent === 'pi_runner' ? 'Pi runner(s)' : 'homeserv operating system and core service runtime', `${absent} server integration`)); }
    const findings = findingsFromCollectors(collectors);
    const report = { auditedAt: new Date().toISOString(), readOnly: true, scope, collectors, findings, versionReviews, updateCandidates: versionReviews.filter((entry) => entry.recommendation === 'review first') };
    if (!context.dryRun && context.workflowId) { const limit = Math.max(1, Math.min(52, Number(config.historyLimit) || 12)); await appendAtomic(context.workflowId, 'infrastructure-audit-history', [report], limit); }
    return { output: report, rowCount: collectors.length, logs: ['Infrastructure audit is read-only; no update actions were attempted.'] };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Optional context; collectors use server-side integrations and bounded official publisher release endpoints only.' }; },
  getOutputSchema(): JsonSchema { return { type: 'object', properties: { auditedAt: { type: 'string' }, readOnly: { type: 'boolean' }, collectors: { type: 'array' }, findings: { type: 'array' }, versionReviews: { type: 'array', description: 'Per-capability current-to-latest evidence, benefits, implications and recommendation.' }, updateCandidates: { type: 'array' } } }; },
};
