import type { NodeDefinition } from '../types';

export const infrastructureStatusDef: NodeDefinition = {
  type: 'infrastructure-status',
  label: 'Infrastructure status',
  category: 'integration',
  description: 'Read-only current-to-latest infrastructure review. Uses bounded official publisher releases and explicitly labels unavailable evidence.',
  configSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', description: 'all | home_assistant | production_app | homeserv | pi_runner' },
      historyLimit: { type: 'number', description: 'Number of audit records retained per workflow (1–52).' },
    },
  },
  defaultConfig: { scope: 'all', historyLimit: 12 },
  inputs: [{ name: 'input', type: 'object', label: 'Optional context' }],
  outputs: [{ name: 'report', type: 'object', label: 'Audit report' }],
  basicConfig: [
    { key: 'scope', label: 'Audit scope', type: 'dropdown', options: [
      { value: 'all', label: 'All available sources' },
      { value: 'home_assistant', label: 'Home Assistant and integrations' },
      { value: 'production_app', label: 'Production app and scheduler' },
      { value: 'homeserv', label: 'Homeserv host' },
      { value: 'pi_runner', label: 'Pi runner' },
    ], description: 'Unavailable server-side integrations remain explicitly unavailable; no inferred health is shown.' },
    { key: 'historyLimit', label: 'History retained', type: 'number', min: 1, max: 52, description: 'Durable audit records retained for this workflow.' },
  ],
  llmDescription: 'Read-only, reusable infrastructure version-position review. For each detected capability it returns versionReviews with installed evidence, official latest stable release URL/date, bounded release-note benefits, compatibility implications and recommendation. It has separately-scoped collectors for Home Assistant, production app, homeserv and the Pi runner. It never runs shell commands or installs updates. Missing current-version or publisher evidence is returned as unavailable; never infer it.',
  llmExamples: [{ scope: 'all', historyLimit: 12 }],
};
