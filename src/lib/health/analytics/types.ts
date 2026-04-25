// src/lib/health/analytics/types.ts
export type Sufficiency = 'ok' | 'partial' | 'insufficient';

export type MetricResult<T> = {
  value: T;
  sufficiency: Sufficiency;
  asOf: string;          // ISO date
  sampleSize: number;    // n datapoints used
};
