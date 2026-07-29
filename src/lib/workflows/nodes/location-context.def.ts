import type { NodeDefinition } from '../types';

export const locationContextDef: NodeDefinition = {
  type: 'location-context',
  label: 'Location context',
  category: 'integration',
  description:
    'Resolve where home is and where the person actually is right now, from Home Assistant. Returns both coordinate pairs plus distance, place label and staleness — the input for location-aware weather and briefings.',
  configSchema: {
    type: 'object',
    properties: {
      personEntity: {
        type: 'string',
        description:
          'Home Assistant entity to locate, e.g. "person.john" or "device_tracker.life360_john_kelly". Supports {{input.field}} templates.',
      },
      homeZoneEntity: {
        type: 'string',
        description: 'Zone entity that defines home (default "zone.home"). Its lat/lon become the home coordinates.',
      },
      staleAfterMins: {
        type: 'number',
        description:
          'Flag the fix as stale when the tracker has not reported for this many minutes (default 120). Stale positions are still returned, but marked.',
      },
    },
    required: ['personEntity'],
  },
  defaultConfig: { personEntity: 'person.john', homeZoneEntity: 'zone.home', staleAfterMins: 120 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Location context' }],
  summarize: (config) => {
    const who = String(config.personEntity ?? '').trim() || '(no entity)';
    const zone = String(config.homeZoneEntity ?? 'zone.home').trim();
    return {
      line: `Locate ${who} and compare against ${zone}`,
      preview: { kind: 'other', details: { Entity: who, Home: zone } },
    };
  },
  basicConfig: [
    {
      key: 'personEntity',
      label: 'Person / tracker entity',
      type: 'text',
      placeholder: 'person.john',
      description: 'The Home Assistant person or device_tracker whose position you want. Supports {{input.field}}.',
    },
    {
      key: 'homeZoneEntity',
      label: 'Home zone entity',
      type: 'text',
      placeholder: 'zone.home',
      description: 'Zone that defines "home". Its coordinates are returned as the home position.',
    },
    {
      key: 'staleAfterMins',
      label: 'Stale after (minutes)',
      type: 'slider',
      min: 15,
      max: 1440,
      step: 15,
      description: 'Mark the position stale when the tracker has not reported within this window.',
    },
  ],
  llmDescription: `Resolves the two places a personal workflow usually cares about: HOME and WHERE THE PERSON IS RIGHT NOW.

Reads Home Assistant directly. Returns:
\`{ success, away, home: { lat, lon, label, radiusM }, current: { lat, lon, label, isHome, distanceKm, bearing, source, since, ageMins, stale, accuracyM, batteryPct, driving }, error? }\`

Use it upstream of \`weather-brief\` to get weather for wherever the person actually is — feed \`{{input.current.lat}}\` / \`{{input.current.lon}}\` (and \`{{input.home.lat}}\` / \`{{input.home.lon}}\` for home). Also useful for "am I away?" branching with a \`conditional\` node on \`input.away\`.

Fails honestly: when the entity is missing, has no GPS attributes, or Home Assistant is unreachable it returns \`success:false\` with an \`error\` string and null coordinates — it never guesses a position.`,
  llmExamples: [
    { personEntity: 'person.john', homeZoneEntity: 'zone.home' },
    { personEntity: 'device_tracker.life360_john_kelly', homeZoneEntity: 'zone.home', staleAfterMins: 60 },
  ],
};
