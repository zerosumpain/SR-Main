export const SETTINGS_PROFILE_KEY = 'briefing.profile';
export const SETTINGS_ENABLED_KEY = 'briefing.enabled';
export const SETTINGS_TOPICS_KEY = 'briefing.topics';

export type BriefingSourceKey =
  | 'location'
  | 'weather-home'
  | 'weather-here'
  | 'sleep'
  | 'readiness'
  | 'indoor'
  | 'email'
  | 'alerts'
  | 'knowledge'
  | 'daydreams'
  | 'memories'
  | 'calendar'
  | 'research'
  | 'files'
  | 'web';

export interface BriefingSourceDefinition {
  key: BriefingSourceKey;
  label: string;
  description: string;
  group: 'Now' | 'Personal' | 'Knowledge' | 'Daydreaming';
  mode: 'workflow' | 'native' | 'extension';
  nodeTypes: string[];
}

export interface BriefingSourcePreference {
  enabled: boolean;
  required: boolean;
}

export interface BriefingProfile {
  sources: Record<BriefingSourceKey, BriefingSourcePreference>;
  memoryLookbackHours: number;
  memoryLimit: number;
}

export interface BriefingMemoryRow {
  id: string;
  category: string;
  content: string;
  confidence: string;
  createdAt: string;
}

export const BRIEFING_SOURCE_CATALOG: BriefingSourceDefinition[] = [
  { key: 'location', label: 'Location', description: 'Where you are and how fresh the position is.', group: 'Now', mode: 'workflow', nodeTypes: ['location-context'] },
  { key: 'weather-home', label: 'Weather at home', description: 'Conditions, rain, wind and daylight at home.', group: 'Now', mode: 'workflow', nodeTypes: ['weather-brief'] },
  { key: 'weather-here', label: 'Weather where you are', description: 'A second forecast when you are away.', group: 'Now', mode: 'workflow', nodeTypes: ['weather-brief'] },
  { key: 'indoor', label: 'Home sensors', description: 'Selected Home Assistant readings and unavailable sensors.', group: 'Now', mode: 'workflow', nodeTypes: ['home-assistant'] },
  { key: 'sleep', label: 'Sleep', description: 'The latest sleep duration, performance and stages.', group: 'Personal', mode: 'workflow', nodeTypes: ['health-query'] },
  { key: 'readiness', label: 'Readiness', description: 'Recovery score and the current recommendation.', group: 'Personal', mode: 'workflow', nodeTypes: ['health-query'] },
  { key: 'email', label: 'Email', description: 'New mail selected by the briefing workflow.', group: 'Personal', mode: 'workflow', nodeTypes: ['gmail-search', 'gmail-fetch'] },
  { key: 'alerts', label: 'Daily alerts', description: 'Undismissed intelligence alerts from the last 24 hours, highest significance first.', group: 'Knowledge', mode: 'native', nodeTypes: [] },
  { key: 'knowledge', label: 'Knowledge graph', description: 'Relevant context already connected across JKAI.', group: 'Knowledge', mode: 'workflow', nodeTypes: ['intel-query'] },
  { key: 'calendar', label: 'Calendar', description: 'Upcoming events supplied by a calendar node.', group: 'Personal', mode: 'extension', nodeTypes: ['apple-calendar'] },
  { key: 'research', label: 'Research', description: 'Fresh findings or completed research relevant today.', group: 'Knowledge', mode: 'extension', nodeTypes: ['research-search', 'deep-dive-list', 'deep-dive-report'] },
  { key: 'files', label: 'Files', description: 'Selected documents, notes or recently changed files.', group: 'Knowledge', mode: 'extension', nodeTypes: ['file-search', 'file-read', 'file-extract'] },
  { key: 'web', label: 'Web sources', description: 'News, searches or pages gathered by workflow nodes.', group: 'Knowledge', mode: 'extension', nodeTypes: ['tavily-search', 'web-scrape', 'stealth-scrape'] },
  { key: 'daydreams', label: 'Daydream activity', description: 'What the system raised, held back and is investigating.', group: 'Daydreaming', mode: 'native', nodeTypes: [] },
  { key: 'memories', label: 'New memories', description: 'Important facts JKAI learned recently, shared back explicitly.', group: 'Daydreaming', mode: 'native', nodeTypes: [] },
];

const SOURCE_KEYS = new Set(BRIEFING_SOURCE_CATALOG.map((s) => s.key));

export const DEFAULT_BRIEFING_PROFILE: BriefingProfile = {
  sources: Object.fromEntries(
    BRIEFING_SOURCE_CATALOG.map((source) => [source.key, { enabled: true, required: false }]),
  ) as Record<BriefingSourceKey, BriefingSourcePreference>,
  memoryLookbackHours: 30,
  memoryLimit: 6,
};

const boundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function normaliseBriefingProfile(value: unknown): BriefingProfile {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const rawSources = raw.sources && typeof raw.sources === 'object' && !Array.isArray(raw.sources)
    ? (raw.sources as Record<string, unknown>)
    : {};
  const sources = structuredClone(DEFAULT_BRIEFING_PROFILE.sources);

  for (const [key, preference] of Object.entries(rawSources)) {
    if (!SOURCE_KEYS.has(key as BriefingSourceKey) || !preference || typeof preference !== 'object') continue;
    const p = preference as Record<string, unknown>;
    sources[key as BriefingSourceKey] = {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
      required: typeof p.required === 'boolean' ? p.required : false,
    };
  }

  return {
    sources,
    memoryLookbackHours: boundedInt(raw.memoryLookbackHours, DEFAULT_BRIEFING_PROFILE.memoryLookbackHours, 1, 168),
    memoryLimit: boundedInt(raw.memoryLimit, DEFAULT_BRIEFING_PROFILE.memoryLimit, 1, 20),
  };
}
