import { env } from '$env/dynamic/private';

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1';
const WHOOP_SCOPES =
  'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

// Types

export interface WhoopTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface WhoopUser {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

export interface WhoopSleep {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate: number;
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
  };
}

export interface WhoopWorkout {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_id: number;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_duration: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

export interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

export interface WhoopBodyMeasurement {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

interface WhoopPaginatedResponse<T> {
  records: T[];
  next_token?: string;
}

// OAuth

export function getWhoopAuthUrl(state: string): string {
  const redirectUri = `${env.ORIGIN}/api/health/whoop/callback`;
  const params = new URLSearchParams({
    client_id: env.WHOOP_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: WHOOP_SCOPES,
    state,
  });
  return `${WHOOP_AUTH_URL}?${params}`;
}

export async function exchangeWhoopCode(code: string): Promise<WhoopTokens> {
  const redirectUri = `${env.ORIGIN}/api/health/whoop/callback`;
  const body = new URLSearchParams({
    client_id: env.WHOOP_CLIENT_ID || '',
    client_secret: env.WHOOP_CLIENT_SECRET || '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const error = await res.text().catch(() => 'unknown');
    throw new Error(`Whoop token exchange failed: ${res.status} - ${error}`);
  }
  return res.json();
}

export async function refreshWhoopToken(refreshToken: string): Promise<WhoopTokens> {
  const body = new URLSearchParams({
    client_id: env.WHOOP_CLIENT_ID || '',
    client_secret: env.WHOOP_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: WHOOP_SCOPES, // Whoop requires scope on refresh
  });
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const error = await res.text().catch(() => 'unknown');
    throw new Error(`Whoop token refresh failed: ${res.status} - ${error}`);
  }
  return res.json();
}

// Internal fetch helper

async function whoopFetch<T>(endpoint: string, accessToken: string): Promise<T> {
  const res = await fetch(`${WHOOP_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const error = await res.text().catch(() => 'unknown');
    throw new Error(`Whoop API error on ${endpoint}: ${res.status} - ${error}`);
  }
  return res.json();
}

// Generic paginated fetcher

export async function whoopFetchAll<T>(
  endpoint: string,
  accessToken: string,
  options: { limit?: number; start?: string; end?: string; maxPages?: number } = {}
): Promise<T[]> {
  const { limit, start, end, maxPages = 100 } = options;
  const results: T[] = [];
  let nextToken: string | null = null;
  let page = 0;

  do {
    const params = new URLSearchParams();

    if (limit && results.length < limit) {
      params.set('limit', String(Math.min(limit - results.length, 25)));
    } else {
      params.set('limit', '25');
    }

    if (nextToken) params.set('nextToken', nextToken);
    if (start) params.set('start', start);
    if (end) params.set('end', end);

    const data = await whoopFetch<WhoopPaginatedResponse<T>>(
      `${endpoint}?${params.toString()}`,
      accessToken
    );

    results.push(...data.records);
    nextToken = data.next_token ?? null;
    page++;

    if (limit && results.length >= limit) break;
    if (!nextToken) break;
    if (page >= maxPages) break;
  } while (true);

  return limit ? results.slice(0, limit) : results;
}

// Convenience getters

export async function getWhoopWorkouts(
  accessToken: string,
  options: { limit?: number; start?: string; end?: string; maxPages?: number } = {}
): Promise<WhoopWorkout[]> {
  return whoopFetchAll<WhoopWorkout>('/activity/workout', accessToken, options);
}

export async function getWhoopSleeps(
  accessToken: string,
  options: { limit?: number; start?: string; end?: string; maxPages?: number } = {}
): Promise<WhoopSleep[]> {
  return whoopFetchAll<WhoopSleep>('/activity/sleep', accessToken, options);
}

export async function getWhoopRecoveries(
  accessToken: string,
  options: { limit?: number; start?: string; end?: string; maxPages?: number } = {}
): Promise<WhoopRecovery[]> {
  return whoopFetchAll<WhoopRecovery>('/recovery', accessToken, options);
}

export async function getWhoopCycles(
  accessToken: string,
  options: { limit?: number; start?: string; end?: string; maxPages?: number } = {}
): Promise<WhoopCycle[]> {
  return whoopFetchAll<WhoopCycle>('/cycle', accessToken, options);
}

export async function getWhoopUser(accessToken: string): Promise<WhoopUser> {
  return whoopFetch<WhoopUser>('/user/profile/basic', accessToken);
}

export async function getWhoopBodyMeasurement(
  accessToken: string
): Promise<WhoopBodyMeasurement | null> {
  try {
    return await whoopFetch<WhoopBodyMeasurement>('/user/body_measurement', accessToken);
  } catch (error) {
    console.error('Whoop body measurement fetch failed:', error);
    return null;
  }
}
