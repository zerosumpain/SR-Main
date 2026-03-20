export interface SyncOptions {
  fullBackfill?: boolean;
  maxPages?: number;
  startDate?: Date;
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
    hrvTrend: { value: number; weight: number; direction: 'up' | 'down' | 'stable' };
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
  }>;
}
