export interface SyncOptions {
  fullBackfill?: boolean;
  maxPages?: number;
  startDate?: Date;
  // Range-aware backfill (ISO 8601 strings for the underlying APIs)
  start?: string;
  end?: string;
  // Per-record progress callback. Total is undefined when unknown (paginated APIs).
  onProgress?: (info: {
    step: string;
    recordsSynced: number;
    pagesDone: number;
  }) => void;
  // Cancellation
  signal?: AbortSignal;
}

export interface SyncResult {
  success: boolean;
  recordsSynced: number;
  errors: string[];
  duration: number;
}

export interface SyncResponse {
  strava?: SyncResult;
  whoop?: SyncResult;
  apple?: SyncResult;
  timestamp: string;
}

export interface ReadinessResponse {
  score: number;
  label: string;
  factors: {
    recovery: { value: number; weight: number };
    hrvTrend: { value: number; weight: number; direction: 'up' | 'down' | 'stable'; raw?: number; avg7d?: number };
    sleepQuality: { value: number; weight: number };
    loadBalance: { value: number; weight: number; zone: string };
  };
  recommendation: string;
}

export interface TrainingLoadResponse {
  acute: number;
  chronic: number;
  ratio: number;
  zone: 'detraining' | 'undertraining' | 'optimal' | 'caution' | 'danger';
  history: Array<{ date: string; load: number }>;
}

export interface SparklineData {
  metric: string;
  values: Array<{ date: string; value: number }>;
  current: number;
  trend: 'up' | 'down' | 'stable';
}

export interface TimelineEvent {
  id: string;
  type: 'strava_activity' | 'whoop_workout' | 'whoop_sleep' | 'whoop_recovery';
  date: string;
  title: string;
  summary: Record<string, string | number>;
}

export interface SleepAnalysis {
  latest: {
    totalDuration: number;
    lightPercent: number;
    deepPercent: number;
    remPercent: number;
    awakePercent: number;
    performance: number;
    consistency: number;
    efficiency: number;
  };
  trend: Array<{ date: string; duration: number; performance: number }>;
}

export interface BodySignal {
  metric: string;
  current: number;
  average7d: number;
  trend: 'up' | 'down' | 'stable';
  unit: string;
}

export interface StatsResponse {
  weekly: {
    activities: number;
    totalDistance: number;
    totalDuration: number;
    totalElevation: number;
    avgRecovery: number;
    avgSleep: number;
  };
  personalRecords: Array<{
    label: string;
    value: number;
    unit: string;
    date: string;
    /**
     * A pre-formatted readout, where `value` + `unit` cannot say it on their
     * own. A pace is the case that forced it: 5.41 min/km is 5:25, and every
     * other pace on the site is written in the clock form.
     */
    display?: string;
  }>;
}
