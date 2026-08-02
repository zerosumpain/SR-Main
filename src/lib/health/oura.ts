// Oura API v2 client – uses platform.call to fetch data
// Requires the Oura API to be registered with secret handle 'oura'

export interface OuraSleep {
  id: string;
  day: string;
  score: number | null;
  contributors: {
    deep_sleep: number | null;
    efficiency: number | null;
    latency: number | null;
    rem_sleep: number | null;
    restfulness: number | null;
    timing: number | null;
    total_sleep: number | null;
  };
  duration: number; // seconds
  total_sleep_duration: number;
  awake_time: number;
  light_sleep_duration: number;
  deep_sleep_duration: number;
  rem_sleep_duration: number;
  bedtime_start: string;
  bedtime_end: string;
}

export interface OuraReadiness {
  id: string;
  day: string;
  score: number | null;
  contributors: {
    activity_balance: number | null;
    body_temperature: number | null;
    hrv_balance: number | null;
    previous_day_activity: number | null;
    previous_night: number | null;
    recovery_index: number | null;
    resting_heart_rate: number | null;
    sleep_balance: number | null;
  };
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
}

export interface OuraActivity {
  id: string;
  day: string;
  score: number | null;
  active_calories: number;
  total_calories: number;
  steps: number;
  daily_movement: number;
  non_wear_time: number;
  rest_mode: boolean;
  inactivity_alerts: number;
  target_calories: number;
  target_meters: number;
  target_km: number;
  class_5_min: string;
  met_minutes_moderate: number;
  met_minutes_vigorous: number;
  met_minutes_mvpa: number;
  equivalent_walking_distance: number;
}

export type OuraDataType = 'sleep' | 'readiness' | 'activity';

export type PlatformCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Fetch Oura data for a given date (defaults to today).
 * Uses platform.call('api_call', ...) which requires the Oura API to be registered.
 */
export async function fetchOuraData(
  platformCall: PlatformCall,
  type: OuraDataType,
  date?: string
): Promise<OuraSleep | OuraReadiness | OuraActivity> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const endpointMap: Record<OuraDataType, string> = {
    sleep: 'usercollection/sleep',
    readiness: 'usercollection/readiness',
    activity: 'usercollection/activity',
  };
  const endpoint = endpointMap[type];
  const url = `https://api.ouraring.com/v2/${endpoint}?start_date=${day}&end_date=${day}`;

  const response = await platformCall('api_call', {
    api: 'oura',
    url,
    method: 'GET',
  });

  if (!response || typeof response !== 'object') {
    throw new Error(`Oura API returned invalid response for ${type}`);
  }

  const data = response as { data?: unknown[] };
  if (!Array.isArray(data.data) || data.data.length === 0) {
    throw new Error(`No Oura ${type} data found for ${day}`);
  }

  return data.data[0] as OuraSleep | OuraReadiness | OuraActivity;
}

/**
 * Tool handler function – can be registered as a platform tool.
 * Expects arguments: { type: 'sleep'|'readiness'|'activity', date?: string }
 */
export async function health_fetch_oura(
  platform: { call: PlatformCall },
  args: { type: OuraDataType; date?: string }
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const data = await fetchOuraData(platform.call, args.type, args.date);
    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}
