import type { NodeDefinition } from '../types';

export const weatherBriefDef: NodeDefinition = {
  type: 'weather-brief',
  label: 'Weather brief',
  category: 'integration',
  description:
    'Decoded weather for a coordinate pair (Open-Meteo). Returns named conditions, metric temperatures, rain/wind/UV and derived "local factors" — no raw WMO codes for a downstream LLM to guess at.',
  configSchema: {
    type: 'object',
    properties: {
      latitude: { type: 'string', description: 'Latitude. Supports {{input.field}} templates.' },
      longitude: { type: 'string', description: 'Longitude. Supports {{input.field}} templates.' },
      label: { type: 'string', description: 'Human name for this place, echoed back in the output (e.g. "Home", "Cambridge").' },
      timezone: { type: 'string', description: 'IANA timezone for day boundaries and sunrise/sunset (default Europe/London).' },
    },
    required: ['latitude', 'longitude'],
  },
  defaultConfig: { latitude: '', longitude: '', label: '', timezone: 'Europe/London' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Weather' }],
  summarize: (config) => {
    const label = String(config.label ?? '').trim();
    const lat = String(config.latitude ?? '').trim();
    const lon = String(config.longitude ?? '').trim();
    const where = label || (lat && lon ? `${lat}, ${lon}` : '(no coordinates)');
    return {
      line: `Get today's weather for ${where}`,
      preview: { kind: 'other', details: { Place: where, Latitude: lat || '—', Longitude: lon || '—' } },
    };
  },
  basicConfig: [
    {
      key: 'label',
      label: 'Place name',
      type: 'template-textarea',
      placeholder: 'Home',
      description: 'What to call this location in the output. Supports {{input.field}}.',
    },
    {
      key: 'latitude',
      label: 'Latitude',
      type: 'template-textarea',
      placeholder: '54.52037  or  {{input.current.lat}}',
      description: 'Decimal latitude. Feed from a location-context node for "where I am right now".',
    },
    {
      key: 'longitude',
      label: 'Longitude',
      type: 'template-textarea',
      placeholder: '-1.57231  or  {{input.current.lon}}',
      description: 'Decimal longitude.',
    },
    {
      key: 'timezone',
      label: 'Timezone',
      type: 'text',
      placeholder: 'Europe/London',
      description: 'IANA timezone used for the day window and sunrise/sunset.',
    },
  ],
  llmDescription: `Today's weather for one coordinate pair, already decoded and unit-normalised so downstream nodes never have to interpret raw API output.

Returns \`{ success, weather: { label, lat, lon, nowC, feelsLikeC, condition, maxC, minC, precipProbMaxPct, precipMm, windKph, gustKph, windDir, uvIndexMax, sunrise, sunset, factors[] }, error? }\`.

- \`condition\` is plain English ("Overcast", "Light rain") — the WMO numeric code is decoded here.
- Temperatures are **°C**, wind is **km/h**, times are local to \`timezone\`.
- \`factors\` is a derived list of notable local conditions (e.g. "Hot — 33°C peak", "High UV (index 7)", "Rain likely (70%)", "Gusts to 55 km/h"). Empty when the day is unremarkable.

Pair with \`location-context\` to report weather where the person actually is: set latitude/longitude to \`{{input.current.lat}}\` / \`{{input.current.lon}}\`. Use a second instance with \`{{input.home.lat}}\` / \`{{input.home.lon}}\` for home.

Fails honestly — a bad coordinate or an unreachable API returns \`success:false\` with an \`error\`, never a placeholder forecast.`,
  llmExamples: [
    { label: 'Home', latitude: '54.52037', longitude: '-1.57231', timezone: 'Europe/London' },
    { label: '{{input.current.label}}', latitude: '{{input.current.lat}}', longitude: '{{input.current.lon}}' },
  ],
};
