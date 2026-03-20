import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  doublePrecision,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const blogPosts = pgTable('blog_posts', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull(),
  content: text('content').notNull(),
  coverImageUrl: text('cover_image_url'),
  status: text('status').notNull().default('draft'),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const blogPostTags = pgTable('blog_post_tags', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => blogPosts.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
});

// ==========================================
// Health Dashboard - OAuth Tokens
// ==========================================

export const oauthTokens = pgTable('oauth_tokens', {
  id: serial('id').primaryKey(),
  service: text('service').notNull(), // 'strava' | 'whoop'
  refreshToken: text('refresh_token').notNull(),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  createdAt: integer('created_at').default(sql`extract(epoch from now())::integer`),
  updatedAt: integer('updated_at').default(sql`extract(epoch from now())::integer`),
});

export type OAuthToken = typeof oauthTokens.$inferSelect;

// ==========================================
// Health Dashboard - Strava Activities
// ==========================================

export const stravaActivities = pgTable('strava_activities', {
  id: bigint('id', { mode: 'number' }).primaryKey(), // Strava activity ID (no auto-increment)
  name: text('name').notNull(),
  type: text('type').notNull(), // 'Run', 'Ride', 'Swim', etc.
  sportType: text('sport_type').notNull(), // More specific: 'TrailRun', 'VirtualRide'
  startDate: integer('start_date').notNull(), // Unix timestamp for queries
  startDateLocal: text('start_date_local').notNull(), // ISO string for display
  timezone: text('timezone').notNull(),

  // Core metrics
  distance: integer('distance').notNull(), // meters
  movingTime: integer('moving_time').notNull(), // seconds
  elapsedTime: integer('elapsed_time').notNull(), // seconds
  totalElevationGain: integer('total_elevation_gain').notNull(), // meters
  averageSpeed: integer('average_speed').notNull(), // m/s * 100 (store as int)
  maxSpeed: integer('max_speed').notNull(), // m/s * 100

  // Heart rate (nullable)
  averageHeartrate: integer('average_heartrate'),
  maxHeartrate: integer('max_heartrate'),

  // Additional metrics
  calories: integer('calories'),
  sufferScore: integer('suffer_score'),

  // Map data (JSON stringified)
  mapData: text('map_data'), // { id, summary_polyline }
  startLatLng: text('start_latlng'), // JSON [lat, lng]
  endLatLng: text('end_latlng'), // JSON [lat, lng]

  // Sync metadata
  syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
});

export type StravaActivityRecord = typeof stravaActivities.$inferSelect;

// ==========================================
// Health Dashboard - Whoop Workouts
// ==========================================

export const whoopWorkouts = pgTable('whoop_workouts', {
  id: text('id').primaryKey(), // Whoop workout ID (UUID in v2 API)
  userId: integer('user_id').notNull(),
  startDate: integer('start_date').notNull(), // Unix timestamp
  endDate: integer('end_date').notNull(),
  startDateLocal: text('start_date_local').notNull(), // ISO string
  timezone: text('timezone').notNull(),

  // Sport mapping
  sportId: integer('sport_id').notNull(),
  sportName: text('sport_name'), // Derived from sportId

  // Core metrics
  strain: doublePrecision('strain').notNull(),
  averageHeartrate: integer('average_heartrate').notNull(),
  maxHeartrate: integer('max_heartrate').notNull(),
  kilojoule: doublePrecision('kilojoule').notNull(),
  distanceMeters: doublePrecision('distance_meters'),
  altitudeGainMeters: doublePrecision('altitude_gain_meters'),

  // Zone durations (milliseconds)
  zoneZero: integer('zone_zero').notNull(),
  zoneOne: integer('zone_one').notNull(),
  zoneTwo: integer('zone_two').notNull(),
  zoneThree: integer('zone_three').notNull(),
  zoneFour: integer('zone_four').notNull(),
  zoneFive: integer('zone_five').notNull(),

  // Sync metadata
  syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
});

export type WhoopWorkoutRecord = typeof whoopWorkouts.$inferSelect;

// ==========================================
// Health Dashboard - Whoop Sleep
// ==========================================

export const whoopSleep = pgTable('whoop_sleep', {
  id: text('id').primaryKey(), // Whoop sleep ID (UUID in v2 API)
  userId: integer('user_id').notNull(),
  startDate: integer('start_date').notNull(),
  endDate: integer('end_date').notNull(),
  startDateLocal: text('start_date_local').notNull(),
  nap: boolean('nap').notNull(),

  // Sleep stages (milliseconds)
  totalInBed: integer('total_in_bed').notNull(),
  totalAwake: integer('total_awake').notNull(),
  totalLight: integer('total_light').notNull(),
  totalSlowWave: integer('total_slow_wave').notNull(),
  totalRem: integer('total_rem').notNull(),
  sleepCycleCount: integer('sleep_cycle_count').notNull(),
  disturbanceCount: integer('disturbance_count').notNull(),

  // Sleep needs (milliseconds)
  baselineNeed: integer('baseline_need').notNull(),
  needFromDebt: integer('need_from_debt').notNull(),
  needFromStrain: integer('need_from_strain').notNull(),
  needFromNap: integer('need_from_nap').notNull(),

  // Performance metrics
  respiratoryRate: doublePrecision('respiratory_rate').notNull(),
  sleepPerformance: doublePrecision('sleep_performance').notNull(),
  sleepConsistency: doublePrecision('sleep_consistency').notNull(),
  sleepEfficiency: doublePrecision('sleep_efficiency').notNull(),

  // Sync metadata
  syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
});

export type WhoopSleepRecord = typeof whoopSleep.$inferSelect;

// ==========================================
// Health Dashboard - Whoop Recovery
// ==========================================

export const whoopRecovery = pgTable('whoop_recovery', {
  id: serial('id').primaryKey(),
  cycleId: text('cycle_id').notNull().unique(), // UUID in v2 API
  sleepId: text('sleep_id').notNull(), // UUID in v2 API
  userId: integer('user_id').notNull(),
  createdDate: integer('created_date').notNull(), // Date of recovery score

  // Recovery metrics
  recoveryScore: doublePrecision('recovery_score').notNull(), // 0-100
  restingHeartRate: doublePrecision('resting_heart_rate').notNull(),
  hrvRmssd: doublePrecision('hrv_rmssd').notNull(), // milliseconds
  spo2: doublePrecision('spo2'), // percentage
  skinTemp: integer('skin_temp'), // celsius * 100

  // Sync metadata
  syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
});

export type WhoopRecoveryRecord = typeof whoopRecovery.$inferSelect;

// ==========================================
// Health Dashboard - Whoop Cycles (Daily Strain)
// ==========================================

export const whoopCycles = pgTable('whoop_cycles', {
  id: text('id').primaryKey(), // Whoop cycle ID (UUID in v2 API)
  userId: integer('user_id').notNull(),
  startDate: integer('start_date').notNull(), // Unix timestamp
  endDate: integer('end_date').notNull(),
  startDateLocal: text('start_date_local').notNull(), // ISO string
  timezone: text('timezone').notNull(),

  // Core metrics
  strain: doublePrecision('strain').notNull(),
  kilojoule: doublePrecision('kilojoule').notNull(),
  averageHeartrate: integer('average_heartrate').notNull(),
  maxHeartrate: integer('max_heartrate').notNull(),

  // Sync metadata
  syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
});

export type WhoopCycleRecord = typeof whoopCycles.$inferSelect;

// ==========================================
// Health Dashboard - Sync State
// ==========================================

export const healthSyncState = pgTable('health_sync_state', {
  id: serial('id').primaryKey(),
  service: text('service').notNull().unique(), // 'strava' | 'whoop'
  lastSyncAt: integer('last_sync_at').notNull(),
  lastSuccessfulSyncAt: integer('last_successful_sync_at'),
  status: text('status').notNull().default('idle'), // 'idle' | 'syncing' | 'error'
  errorMessage: text('error_message'),
  recordsSynced: integer('records_synced').default(0),
});

export type HealthSyncState = typeof healthSyncState.$inferSelect;

// ==========================================
// Health Dashboard - Apple Health Metrics
// ==========================================

export const appleHealthMetrics = pgTable(
  'apple_health_metrics',
  {
    id: serial('id').primaryKey(),
    metricName: text('metric_name').notNull(), // 'heart_rate', 'hrv', 'step_count', etc.
    date: integer('date').notNull(), // Unix timestamp of measurement
    dateLocal: text('date_local').notNull(), // ISO string for display

    // Value fields (nullable - populated depending on metric type)
    value: integer('value'), // Primary value (qty or avg) * 100 for decimals
    minValue: integer('min_value'), // Min for range metrics (HR, temp) * 100
    maxValue: integer('max_value'), // Max for range metrics (HR, temp) * 100

    // Metadata
    units: text('units').notNull(), // 'bpm', 'ms', 'count', 'kcal', etc.

    // Sync metadata
    syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
  },
  (table) => [uniqueIndex('idx_apple_health_metric_date').on(table.metricName, table.date)],
);

export type AppleHealthMetricRecord = typeof appleHealthMetrics.$inferSelect;
export type NewAppleHealthMetric = typeof appleHealthMetrics.$inferInsert;
