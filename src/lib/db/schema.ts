import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  check,
  date,
  doublePrecision,
  boolean,
  uniqueIndex,
  index,
  jsonb,
  numeric,
  customType,
  primaryKey,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// pgvector custom type for embedding columns
const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === 'string') return JSON.parse(value);
    return value as number[];
  },
});

export const blogPosts = pgTable('blog_posts', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull(),
  content: text('content').notNull(),
  coverImageUrl: text('cover_image_url'),
  coverImageAlt: text('cover_image_alt'),
  contentFormat: text('content_format').default('html').notNull(),
  // Who actually wrote the prose. Load-bearing for the voice system: only
  // 'human' posts may seed the Voice Card or supply exemplars. Feeding
  // generated text back into the corpus is model collapse in miniature —
  // with a corpus this small a handful of generated posts would outweigh
  // the real ones inside a month. Default 'unknown' so untagged rows are
  // excluded rather than silently trusted.
  authorship: text('authorship').notNull().default('unknown'),
  previewToken: text('preview_token').$defaultFn(() => crypto.randomUUID()),
  status: text('status').notNull().default('draft'),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

// The authorship vocabulary lives in $lib/blog/authorship — both so the admin UI
// can import it without pulling this file into the client bundle, and because
// THIS FILE MUST HAVE NO $lib IMPORTS AT ALL. ci-release.sh rsyncs schema.ts to
// the VPS on its own and runs drizzle-kit push against it; any $lib import it
// carries resolves to nothing there and fails the schema push with
// MODULE_NOT_FOUND, silently leaving production a column behind. (Seen for real
// on 2026-08-19 — this file briefly re-exported the vocabulary as a
// convenience and the `authorship` column never reached prod.)

export const blogPostTags = pgTable('blog_post_tags', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => blogPosts.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
});

export const blogAssistantMessages = pgTable('blog_assistant_messages', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => blogPosts.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'proposal' | 'proposal_resolved'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Revisions captured BEFORE an assistant-driven change is applied. Lets the
// user roll back any prose or metadata edit the LLM made.
export const blogPostRevisions = pgTable('blog_post_revisions', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => blogPosts.id, { onDelete: 'cascade' }),
  proposalId: text('proposal_id'),
  field: text('field').notNull(), // 'content' | 'title' | 'excerpt' | 'slug' | 'tags' | 'status' | 'cover_alt'
  previousValue: text('previous_value').notNull(), // raw text or JSON-encoded
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

  // Editorial: featured on public /health "epic activities" rail
  featured: boolean('featured').notNull().default(false),
  featuredOrder: integer('featured_order'), // lower = earlier; null = default by date desc
  featuredCaption: text('featured_caption'), // optional editorial blurb shown under the title

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

  // Sport mapping (Whoop v2 dropped numeric sport_id for many activities;
  // sport_name is now the authoritative label)
  sportId: integer('sport_id'),
  sportName: text('sport_name'),

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
  /**
   * WHOOP's 0-21 day strain.
   *
   * Guarded by a CHECK, because for four months something wrote this column at
   * strain x 100 and nothing noticed. 51 rows held values from 145 to 2033 on a
   * scale that stops at 21, written between 2026-04-27 and 2026-08-24,
   * interleaved with correct rows from the sync in this repo — so no date
   * separates them and no flag on the row says which is which. The writer was
   * never in this repository's history and is no longer present on either
   * machine; it stopped of its own accord, which is the worst way for a bug to
   * end because nothing was learned and nothing prevents its return.
   *
   * The constraint is the prevention. A scaled write now fails loudly at the
   * database, naming itself, instead of silently poisoning every average that
   * reads this column. Readers still normalise via `realStrain()` for the sake
   * of anything that slipped in before this existed.
   */
  strain: doublePrecision('strain').notNull(),
  kilojoule: doublePrecision('kilojoule').notNull(),
  averageHeartrate: integer('average_heartrate').notNull(),
  maxHeartrate: integer('max_heartrate').notNull(),

  // Sync metadata
  syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
}, (t) => [
  // The prevention, at the only layer every writer must pass through. An app
  // fix cannot help here: the writer that did this was never in this codebase.
  check('whoop_cycles_strain_scale', sql`${t.strain} >= 0 and ${t.strain} <= 21`),
]);

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
// Health Dashboard - Sync Jobs (range-aware backfill)
// ==========================================

export const healthSyncJobs = pgTable('health_sync_jobs', {
  id: text('id').primaryKey(), // uuid
  service: text('service').notNull(), // 'strava' | 'whoop' | 'all'
  mode: text('mode').notNull().default('backfill'), // 'incremental' | 'backfill'
  rangeStart: integer('range_start'), // unix seconds, null = unbounded
  rangeEnd: integer('range_end'),
  status: text('status').notNull().default('queued'), // queued | running | success | error | cancelled
  recordsSynced: integer('records_synced').notNull().default(0),
  pagesDone: integer('pages_done').notNull().default(0),
  totalPagesEstimate: integer('total_pages_estimate'),
  currentStep: text('current_step'), // 'whoop:workouts', 'whoop:sleep', 'strava:page-3', etc.
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  errorMessage: text('error_message'),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
});

export type HealthSyncJob = typeof healthSyncJobs.$inferSelect;

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

// ==========================================
// Trails — Activities, Tracks, Series
// ==========================================
// Source-agnostic workout records for /trails. Written by the Apple Health
// (Health Auto Export) workout ingest; `source` leaves room to union in the
// dormant strava_activities / whoop_workouts rows later without a migration.
//
// UNITS: these tables store real SI units in doublePrecision — metres,
// seconds, kilojoules, bpm. They deliberately do NOT follow the `value * 100`
// integer convention used by apple_health_metrics above. That convention has
// already produced values wrong by 100× on steps and strain, which read as
// display bugs and were not. Convert at the edge, never in storage.

export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(), // `${source}:${externalId}`
    source: text('source').notNull(), // 'apple' | 'strava' | 'whoop' | 'manual'
    externalId: text('external_id').notNull(),

    name: text('name').notNull(),
    // Normalised: run | trail_run | ride | mtb | walk | hike | swim | other
    activityType: text('activity_type').notNull(),
    rawType: text('raw_type'), // the source's own label, kept verbatim

    startDate: integer('start_date').notNull(), // unix seconds
    endDate: integer('end_date').notNull(),
    startDateLocal: text('start_date_local').notNull(), // ISO string for display
    timezone: text('timezone'),

    distanceM: doublePrecision('distance_m'),
    durationS: integer('duration_s').notNull(),
    activeDurationS: integer('active_duration_s'),
    elevationGainM: doublePrecision('elevation_gain_m'),
    elevationLossM: doublePrecision('elevation_loss_m'),

    avgHeartrate: integer('avg_heartrate'),
    maxHeartrate: integer('max_heartrate'),

    activeEnergyKj: doublePrecision('active_energy_kj'),
    totalEnergyKj: doublePrecision('total_energy_kj'),
    avgPaceSPerKm: doublePrecision('avg_pace_s_per_km'),
    avgCadence: doublePrecision('avg_cadence'),

    hasTrack: boolean('has_track').notNull().default(false),
    // Everything the source sent that we don't model, verbatim.
    metadata: jsonb('metadata'),

    // Owner corrections. `activityType` above keeps holding what the SOURCE said,
    // because ingest upserts it on every sync — an in-place edit would be
    // clobbered the next time the phone posted. Readers take
    // `typeOverride ?? activityType` via effectiveType() in trails/activity-meta.
    typeOverride: text('type_override'),
    // A bad recording (a drive logged as a ride, a lost fix) drops out of segment
    // matching without being deleted. The rebuild skips these outright.
    excludedFromSegments: boolean('excluded_from_segments').notNull().default(false),

    syncedAt: integer('synced_at').default(sql`extract(epoch from now())::integer`),
  },
  (t) => [
    uniqueIndex('activities_source_external_idx').on(t.source, t.externalId),
    index('activities_start_idx').on(t.startDate),
    index('activities_type_idx').on(t.activityType),
  ],
);

export type ActivityRecord = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;

// The GPS trace. One row per activity; coordinates are decimated on write.
export const activityTracks = pgTable(
  'activity_tracks',
  {
    id: serial('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    // [[lng, lat, elevationM | null, secondsFromStart], ...]
    coordinates: jsonb('coordinates').notNull(),
    pointCount: integer('point_count').notNull(),
    bounds: jsonb('bounds').notNull(), // { n, s, e, w }
    polyline: text('polyline'), // encoded, for cheap list rendering
    distanceM: doublePrecision('distance_m'),
  },
  (t) => [uniqueIndex('activity_tracks_activity_idx').on(t.activityId)],
);

export type ActivityTrackRecord = typeof activityTracks.$inferSelect;
export type NewActivityTrack = typeof activityTracks.$inferInsert;

// Per-workout time series. One row per metric, samples inline as jsonb —
// a 1 Hz hour of heart rate is 3,600 points that are only ever read whole.
export const activitySeries = pgTable(
  'activity_series',
  {
    id: serial('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(), // heart_rate | speed | cadence | altitude | power
    units: text('units').notNull(),
    sampleCount: integer('sample_count').notNull(),
    samples: jsonb('samples').notNull(), // [[secondsFromStart, value], ...]
  },
  (t) => [uniqueIndex('activity_series_activity_metric_idx').on(t.activityId, t.metric)],
);

export type ActivitySeriesRecord = typeof activitySeries.$inferSelect;
export type NewActivitySeries = typeof activitySeries.$inferInsert;

// ---------------------------------------------------------------------------
// Intra-route segments: stretches of ground covered more than once.
//
// Discovered by comparing the GPS traces of same-type activities against each
// other (see $lib/trails/segments). A segment is DIRECTIONAL — the same path
// walked back the other way is a different segment, because a climb and its
// descent are not comparable efforts. Laps within one activity each count as
// their own effort; that is the point of the exercise.
//
// Same unit convention as `activities` above: real SI in doublePrecision.
export const activitySegments = pgTable(
  'activity_segments',
  {
    id: serial('id').primaryKey(),
    // what3words-style triple, e.g. "heron.copper.stile". Stable across
    // rebuilds: reconciliation hands a recomputed segment the name of the
    // stored one it replaces, so a 30 m shift in geometry never renames a
    // place you have learned.
    name: text('name').notNull(),
    activityType: text('activity_type').notNull(),

    distanceM: doublePrecision('distance_m').notNull(),
    elevationGainM: doublePrecision('elevation_gain_m').notNull().default(0),
    elevationLossM: doublePrecision('elevation_loss_m').notNull().default(0),

    // [[lng, lat, elevationM | null, metresFromSegmentStart], ...]
    // The fourth slot is DISTANCE, not seconds: a segment has no clock of its
    // own. Deliberately the same arity as activity_tracks.coordinates so the
    // map components render it unchanged.
    coordinates: jsonb('coordinates').notNull(),
    pointCount: integer('point_count').notNull(),
    bounds: jsonb('bounds').notNull(), // { n, s, e, w }
    polyline: text('polyline'), // encoded, for thumbnails

    effortCount: integer('effort_count').notNull().default(0),
    firstEffortAt: integer('first_effort_at'), // unix seconds
    lastEffortAt: integer('last_effort_at'),

    updatedAt: integer('updated_at').default(sql`extract(epoch from now())::integer`),
  },
  (t) => [
    uniqueIndex('activity_segments_name_idx').on(t.name),
    index('activity_segments_type_idx').on(t.activityType),
  ],
);

export type ActivitySegmentRecord = typeof activitySegments.$inferSelect;
export type NewActivitySegment = typeof activitySegments.$inferInsert;

// One traversal of one segment. `startS`/`endS` are seconds from the start of
// the ACTIVITY — the same clock as activity_series, so a heart-rate window is
// a straight filter with no re-basing.
export const activitySegmentEfforts = pgTable(
  'activity_segment_efforts',
  {
    id: serial('id').primaryKey(),
    segmentId: integer('segment_id')
      .notNull()
      .references(() => activitySegments.id, { onDelete: 'cascade' }),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),

    startS: doublePrecision('start_s').notNull(),
    endS: doublePrecision('end_s').notNull(),
    durationS: doublePrecision('duration_s').notNull(),
    // The distance this effort actually covered, not the segment's canonical
    // length. Pace is computed from this one so nothing is overstated.
    distanceM: doublePrecision('distance_m').notNull(),
    speedMps: doublePrecision('speed_mps').notNull(),
    paceSPerKm: doublePrecision('pace_s_per_km').notNull(),

    avgHeartrate: doublePrecision('avg_heartrate'),
    maxHeartrate: integer('max_heartrate'),
    elevationGainM: doublePrecision('elevation_gain_m'),

    // Pace-at-HR, both directions of the same idea:
    // efficiency factor = metres/min per bpm (higher is better),
    // beats per km    = heartbeats spent per km (lower is better).
    efficiencyFactor: doublePrecision('efficiency_factor'),
    beatsPerKm: doublePrecision('beats_per_km'),

    // Absolute clock, for ordering a leaderboard without joining activities.
    startedAt: integer('started_at').notNull(),
    // Which lap this was, when one activity covers a segment more than once.
    lapIndex: integer('lap_index').notNull().default(1),
  },
  (t) => [
    uniqueIndex('activity_segment_efforts_unique_idx').on(t.segmentId, t.activityId, t.lapIndex),
    index('activity_segment_efforts_segment_idx').on(t.segmentId),
    index('activity_segment_efforts_activity_idx').on(t.activityId),
  ],
);

export type ActivitySegmentEffortRecord = typeof activitySegmentEfforts.$inferSelect;
export type NewActivitySegmentEffort = typeof activitySegmentEfforts.$inferInsert;

// A route you intend to run, as opposed to one you have run. Kept apart from
// `activities` because the two answer different questions and have different
// lifecycles — a plan can be discarded, re-planned, or run many times.
//
// A recording made in the field does NOT land here: it becomes a row in
// `activities` with source='recorded', so it sits alongside the Apple ones on
// /health/activities instead of in a parallel world.
export const plannedRoutes = pgTable(
  'planned_routes',
  {
    id: text('id').primaryKey(), // uuid
    name: text('name').notNull(),
    sport: text('sport').notNull(), // run | trail_run | ride | mtb | hike | walk
    source: text('source').notNull().default('planned'), // 'planned' | 'imported'

    coordinates: jsonb('coordinates').notNull(), // [[lng, lat, ele|null], ...]
    bounds: jsonb('bounds').notNull(),
    polyline: text('polyline'),

    distanceM: doublePrecision('distance_m').notNull(),
    ascentM: doublePrecision('ascent_m'),
    descentM: doublePrecision('descent_m'),
    durationS: integer('duration_s'), // the router's estimate

    /** 0..1 from the loop-quality scorer. Null for an imported GPX. */
    score: doublePrecision('score'),
    /** Full RouteScore — overlap, spurs, terrain, profile, notes. */
    scoreBreakdown: jsonb('score_breakdown'),
    targetDistanceM: doublePrecision('target_distance_m'),

    notes: text('notes'),
    createdAt: integer('created_at').default(sql`extract(epoch from now())::integer`),
  },
  (t) => [index('planned_routes_created_idx').on(t.createdAt), index('planned_routes_sport_idx').on(t.sport)],
);

export type PlannedRouteRecord = typeof plannedRoutes.$inferSelect;
export type NewPlannedRoute = typeof plannedRoutes.$inferInsert;

// Points of interest hung off a planned route — parking, water, a gate that
// sticks. Ported from JKAImaps, where they lived in IndexedDB and could not be
// seen from anywhere else.
export const routeWaypoints = pgTable(
  'route_waypoints',
  {
    id: text('id').primaryKey(),
    routeId: text('route_id')
      .notNull()
      .references(() => plannedRoutes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('custom'), // parking | water | viewpoint | pub | shelter | gate | custom
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    note: text('note'),
    createdAt: integer('created_at').default(sql`extract(epoch from now())::integer`),
  },
  (t) => [index('route_waypoints_route_idx').on(t.routeId)],
);

export type RouteWaypointRecord = typeof routeWaypoints.$inferSelect;
export type NewRouteWaypoint = typeof routeWaypoints.$inferInsert;

// ==========================================
// Biome Config
// ==========================================

export const biomeConfig = pgTable('biome_config', {
  id: serial('id').primaryKey(),
  settings: text('settings').notNull(), // JSON blob
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ==========================================
// Hero Titles — Cached landing-page hero copy
// ==========================================

export const heroTitles = pgTable('hero_titles', {
  id: serial('id').primaryKey(),
  hrBucket: integer('hr_bucket').notNull(),
  stepsBucket: integer('steps_bucket').notNull(),
  tempBucket: integer('temp_bucket').notNull(),
  hrCentroid: integer('hr_centroid').notNull(),
  stepsCentroid: integer('steps_centroid').notNull(),
  tempCentroid: integer('temp_centroid').notNull(),
  primary: text('primary').notNull(),
  ghost: text('ghost').notNull(),
  strapTemplate: text('strap_template').notNull(),
  style: text('style'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
});

// ==========================================
// Deep Dive — Research Agent
// ==========================================

export const researchSessions = pgTable('research_session', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  topic: text('topic').notNull(),
  goals: jsonb('goals').notNull().default(sql`'[]'::jsonb`),
  status: text('status').notNull().default('draft'),
  timeLimitMinutes: integer('time_limit_minutes'),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  report: jsonb('report'),
  shareToken: text('share_token').unique(),
  parentSessionId: text('parent_session_id'),
  seedContext: jsonb('seed_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  // --- v3: depth tiers, scope, budget (see $lib/deepdive/depth, /scope) ---
  /**
   * 'instant' | 'scan' | 'brief' | 'investigation'. The single thing a user
   * picks; expands server-side into config + phases + budget + pinned model.
   * Defaults to 'investigation' so pre-v3 rows read as what they actually were.
   */
  depth: text('depth').notNull().default('investigation'),
  /**
   * How an `instant` run reached the web: 'off' | 'fast' | 'free'.
   *
   * Only meaningful for that tier — every other tier gathers its own sources
   * through Tavily. Stored rather than derived because the three routes differ
   * in what they cost, how quick they are and how far the answer can be
   * trusted, and a finished run has to be able to say which one it took.
   */
  grounding: text('grounding').notNull().default('off'),
  /** ResearchScope — domain binding, seed urls, recency. */
  scope: jsonb('scope'),
  /** Wall-clock allowance in ms; null for unbudgeted investigations. */
  budgetMs: integer('budget_ms'),
  /** The agreed query plan from the definition stage, before any spend. */
  plan: jsonb('plan'),
  /** Total wall-clock, written on completion. Mirrors quick_answer.duration_ms. */
  durationMs: integer('duration_ms'),
  /**
   * Explicit worker heartbeat. Liveness is NEVER derived by subtracting
   * `updatedAt` — a row touched by an unrelated write would read as alive, and
   * a worker busy inside one long call would read as dead. Only the worker
   * writes this, and only while it is genuinely running.
   */
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  /** Set when a run is adopted by the resume sweep, for provenance. */
  resumedAt: timestamp('resumed_at', { withTimezone: true }),
  /** Why a run failed. Previously only ever reached console.error. */
  errorMessage: text('error_message'),
  /**
   * Which phase a resumed run should pick up at.
   *
   * The phase normally lives in `status` ('phase2' and so on), but pausing has
   * to overwrite `status` with 'paused' — so without this column a pause would
   * throw away everything the run had got through and restart at lead
   * generation. Null on every run that is not paused.
   */
  resumeFrom: text('resume_from'),
  /**
   * What this run cost at Tavily, in calls and in billed credits.
   *
   * Kept on the row rather than derived, because Tavily has no per-request
   * receipt to reconcile against later: the only moment the spend is knowable
   * is the moment the call returns. `research_credits` is the account-wide
   * number and answers a different question — see $lib/deepdive/tavily-usage.
   */
  tavilySearches: integer('tavily_searches').notNull().default(0),
  tavilyExtracts: integer('tavily_extracts').notNull().default(0),
  tavilyCredits: integer('tavily_credits').notNull().default(0),
});

export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;

export const sources = pgTable('source', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  url: text('url').notNull(),
  title: text('title'),
  snippet: text('snippet'),
  domain: text('domain'),
  category: text('category'),
  phase: integer('phase').notNull(),
  credibilityScore: doublePrecision('credibility_score'),
  credibilityType: text('credibility_type'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  // --- Research Desk (canvas) additive columns ---
  canvasX: doublePrecision('canvas_x'), // null = auto-layout
  canvasY: doublePrecision('canvas_y'),
  pinned: boolean('pinned').notNull().default(false),
  deskState: text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
  deskCategory: text('desk_category'),
  synthesisRunId: text('synthesis_run_id'), // FK -> synthesis_runs.id (nullable, no DB constraint)
  /**
   * The frontier lead that found this source. Null for sources gathered before
   * the frontier existed, and for red-team sources (phase 3 searches a claim,
   * not a line of enquiry). This is what lets phase 2 attribute extracted facts
   * back to the query that produced them — without it a lead cannot be judged,
   * because gathering and extraction happen in different phases.
   */
  leadId: text('lead_id'),
});

export type Source = typeof sources.$inferSelect;

export const facts = pgTable('fact', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  sourceId: text('source_id').notNull().references(() => sources.id),
  content: text('content').notNull(),
  eventDate: timestamp('event_date', { withTimezone: true }),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  confidence: doublePrecision('confidence').notNull().default(0.5),
  isCounterfactual: boolean('is_counterfactual').notNull().default(false),
  refutesFactId: text('refutes_fact_id').references((): any => facts.id),
  tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
  embedding: vector('embedding'),
  embeddingModel: text('embedding_model'), // which model produced `embedding` (provenance + re-embed gate)
  noveltyScore: doublePrecision('novelty_score'),
  sourceAgreement: integer('source_agreement'),
  // --- Research Desk (canvas) additive columns ---
  canvasX: doublePrecision('canvas_x'), // null = auto-layout
  canvasY: doublePrecision('canvas_y'),
  pinned: boolean('pinned').notNull().default(false),
  deskState: text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
  deskCategory: text('desk_category'), // distinct from sources.category; new to facts
  synthesisRunId: text('synthesis_run_id'), // FK -> synthesis_runs.id (nullable, no DB constraint)
});

export type Fact = typeof facts.$inferSelect;

// Semantic index over the SOURCE MATERIALS of a research session — the fetched
// page content, chunked. Complements `fact` (distilled claims): a source chunk
// is raw source text the extractor may not have turned into a fact, so @research
// can retrieve passages the fact layer skipped. Populated during phase 2 (see
// $lib/deepdive/source-index). Embedded with the SAME model as fact.embedding
// (deepdive getEmbeddingModel — text-embedding-3-small, 1536-dim) so
// searchResearch can UNION facts + chunks against one query vector.
export const sourceChunks = pgTable(
  'source_chunk',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    sessionId: text('session_id').notNull().references(() => researchSessions.id),
    sourceId: text('source_id').notNull().references(() => sources.id),
    chunkOrd: integer('chunk_ord').notNull(), // 0-based ordinal within the source
    text: text('text').notNull(),             // the chunk text that was embedded
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    embedding: vector('embedding'),           // 1536-dim, same space as fact.embedding (null if embed failed)
    embeddingModel: text('embedding_model'),  // which model produced `embedding` (provenance)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bySource: index('source_chunk_source_idx').on(table.sourceId),
    bySession: index('source_chunk_session_idx').on(table.sessionId),
    uniqChunk: uniqueIndex('source_chunk_source_ord_idx').on(table.sourceId, table.chunkOrd),
  }),
);

export type SourceChunk = typeof sourceChunks.$inferSelect;
export type NewSourceChunk = typeof sourceChunks.$inferInsert;

/**
 * The research frontier: one row per line of enquiry.
 *
 * This is deliberately three things at once, because they are the same thing:
 *
 *  - the WORK QUEUE the engine pulls from (replacing an in-memory FIFO array
 *    that had no scores and vanished on restart),
 *  - the GRAPH the user watches — lead nodes, parent edges, and the branches
 *    that got abandoned,
 *  - the RESUME RECORD, since a durable queue is what lets a worker that died
 *    mid-run be picked up instead of stranding the session forever. Seven of
 *    thirty-one production sessions were stranded in a non-terminal state
 *    before this existed, the oldest for four months.
 */
export const researchLeads = pgTable(
  'research_lead',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    sessionId: text('session_id')
      .notNull()
      .references(() => researchSessions.id, { onDelete: 'cascade' }),
    /** The search query this lead represents. */
    query: text('query').notNull(),
    /** Lead this one was spawned from; null for the seed round. */
    parentId: text('parent_id'),
    /** Hops from a seed lead — used to bound how far a branch may run. */
    depth: integer('depth').notNull().default(0),
    /** What spawned it: 'seed' | 'entity' | 'gap' | 'hypothesis' | 'followup'. */
    origin: text('origin').notNull().default('seed'),
    /** Human-readable provenance, e.g. the entity name that suggested it. */
    originDetail: text('origin_detail'),
    /** queued | running | productive | exhausted | drifted | failed | pruned */
    status: text('status').notNull().default('queued'),
    /** Why it ended up in that status, in words a person can read. */
    reason: text('reason'),
    /** Yield score; orders the frontier. */
    score: doublePrecision('score'),
    /** The measured signals behind the verdict, kept for the UI and for tuning. */
    metrics: jsonb('metrics'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    bySession: index('research_lead_session_idx').on(table.sessionId),
    byStatus: index('research_lead_status_idx').on(table.sessionId, table.status),
  }),
);

export type ResearchLead = typeof researchLeads.$inferSelect;
export type NewResearchLead = typeof researchLeads.$inferInsert;

export const entities = pgTable('entity', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  description: text('description'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  // --- Research Desk (canvas) additive columns ---
  canvasX: doublePrecision('canvas_x'), // null = auto-layout
  canvasY: doublePrecision('canvas_y'),
  pinned: boolean('pinned').notNull().default(false),
  deskState: text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
  deskCategory: text('desk_category'),
  synthesisRunId: text('synthesis_run_id'), // FK -> synthesis_runs.id (nullable, no DB constraint)
});

export type Entity = typeof entities.$inferSelect;

export const entityMentions = pgTable('entity_mention', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  entityId: text('entity_id').notNull().references(() => entities.id),
  factId: text('fact_id').notNull().references(() => facts.id),
  context: text('context'),
});

export type EntityMention = typeof entityMentions.$inferSelect;

export const relationships = pgTable('relationship', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  fromEntityId: text('from_entity_id').references(() => entities.id),
  toEntityId: text('to_entity_id').references(() => entities.id),
  fromFactId: text('from_fact_id').references(() => facts.id),
  toFactId: text('to_fact_id').references(() => facts.id),
  relationshipType: text('relationship_type').notNull(),
  sentiment: text('sentiment').notNull(),
  strength: doublePrecision('strength').notNull().default(0.5),
  sourceId: text('source_id').references(() => sources.id),
});

export type Relationship = typeof relationships.$inferSelect;

// ==========================================
// Deep Dive — Global Entities (cross-session)
// ==========================================

export const globalEntities = pgTable('global_entity', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  canonicalName: text('canonical_name').notNull(),
  type: text('type').notNull(),
  description: text('description'),
  embedding: vector('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GlobalEntity = typeof globalEntities.$inferSelect;

export const globalEntityLinks = pgTable('global_entity_link', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  globalEntityId: text('global_entity_id').notNull().references(() => globalEntities.id),
  sessionEntityId: text('session_entity_id').notNull().references(() => entities.id),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  confidence: doublePrecision('confidence').notNull().default(0.8),
});

export type GlobalEntityLink = typeof globalEntityLinks.$inferSelect;

// ==========================================
// Deep Dive — Narrative Builder
// ==========================================

export const narrativeItems = pgTable('narrative_item', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  factId: text('fact_id').references(() => facts.id),
  sortOrder: integer('sort_order').notNull(),
  annotation: text('annotation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NarrativeItem = typeof narrativeItems.$inferSelect;

// ==========================================
// Agent Transparency — Tasks, Actions, Activity
// ==========================================

export const agentTasks = pgTable('agent_tasks', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'), // pending | planning | active | paused | completed | failed
  priority: integer('priority').default(0),
  originChannel: text('origin_channel'), // whatsapp | telegram | web | etc
  originSender: text('origin_sender'), // sender ID for reply routing
  steps: jsonb('steps').default(sql`'[]'::jsonb`),
  currentStep: integer('current_step').default(0),
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = typeof agentTasks.$inferInsert;

export const agentActions = pgTable('agent_actions', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  taskId: text('task_id').references(() => agentTasks.id, { onDelete: 'set null' }),
  sessionId: text('session_id'),
  actionType: text('action_type').notNull(), // tool_call | llm_call | decision | message_in | message_out
  toolName: text('tool_name'),
  input: jsonb('input'),
  output: jsonb('output'),
  reasoning: text('reasoning'),
  durationMs: integer('duration_ms'),
  tokensInput: integer('tokens_input'),
  tokensOutput: integer('tokens_output'),
  /** Input tokens served from the provider's prompt cache. Billed at a fraction
   *  of the normal input rate, so the ratio of this to `tokens_input` is the
   *  cheapest cost lever there is — and it was captured per workflow node and
   *  then thrown away at the ledger boundary, which is why /admin/ops/costs
   *  could not say whether caching was working. */
  cacheReadTokens: integer('cache_read_tokens'),
  /** Output tokens spent thinking before the first visible character. Billed as
   *  output. Tracked separately because a reasoning model that answers in ten
   *  words can still bill three thousand tokens, and that is invisible in a
   *  completion-token total. */
  reasoningTokens: integer('reasoning_tokens'),
  costUsd: doublePrecision('cost_usd'),
  provider: text('provider'),
  model: text('model'),
  status: text('status').default('completed'), // pending | running | completed | failed
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // The per-run spend panel reads this table by session id every six seconds
  // while a research run is live, and the table grows with every LLM call the
  // whole site makes. Unindexed that is a sequential scan per poll.
  sessionIdx: index('agent_actions_session_idx').on(t.sessionId),
  // Every panel on /admin/ops/costs filters this table by a date window, and
  // the table grows with every LLM call the whole site makes. Without this the
  // costs page is a fistful of sequential scans on each load.
  createdAtIdx: index('agent_actions_created_at_idx').on(t.createdAt),
}));

export type AgentAction = typeof agentActions.$inferSelect;
export type NewAgentAction = typeof agentActions.$inferInsert;

export const agentActivity = pgTable('agent_activity', {
  id: serial('id').primaryKey(),
  actionId: text('action_id').references(() => agentActions.id, { onDelete: 'set null' }),
  taskId: text('task_id').references(() => agentTasks.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(), // task_created | step_started | tool_started | tool_completed | research_progress | message_in | message_out | decision | error
  summary: text('summary').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AgentActivityRecord = typeof agentActivity.$inferSelect;
export type NewAgentActivity = typeof agentActivity.$inferInsert;

export const agentSettings = pgTable('agent_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==========================================
// JKAI — Autonomous Build System
// ==========================================

/**
 * Studio builds only. Shape of the FACTS/GAPS research brief produced before
 * planning. `src/lib/jkai/research-brief.ts` (Task 10) owns the canonical
 * `ResearchBrief` interface with an identical shape — it imports
 * `researchSessions` FROM this file, so this file cannot import a type back
 * out of it without a circular import. The duplication here is deliberate to
 * keep schema.ts free of app-level ($lib/jkai) imports.
 */
export interface StudioResearchBrief {
  topic: string;
  facts: Array<{ claim: string; sourceUrl: string; detail?: string }>;
  concepts: Array<{ name: string; whyHard: string }>;
  causalMap: Array<{ from: string; to: string; relationship: string }>;
  liveData: Array<{ name: string; url: string; what: string }>;
  misconceptions: string[];
  gaps: string[];
  sessionId: string | null;
}

export const jkaiBuilds = pgTable('jkai_builds', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title'),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('pending'),
  // Why the build stopped, as distinct from `status`. `completed` is claimed
  // by three endings that are not the same thing: the builder delivered, it
  // ran out of budget, or someone stopped it — plus Hermes registrations that
  // file `completed` before a file exists. Counting them together reported 61%
  // success where 43% was delivered. A separate nullable column rather than new
  // statuses, because ten consumers read `status === 'completed'` to mean
  // "terminal" and a new status would render a capped build as still running.
  // 'delivered' | 'budget_cap' | 'stopped_by_user' | 'registered' — see
  // $lib/builds/build-status.ts. Null on rows written before this existed.
  outcome: text('outcome'),
  budgetConfig: jsonb('budget_config').notNull().default(sql`'{}'::jsonb`),
  tokensUsed: integer('tokens_used').notNull().default(0),
  // The split, kept rather than collapsed. recordBuildUsage receives prompt
  // and completion separately and used to add them together on the way in, so
  // every question about cost was answered by derivation: a 2.5M-token build
  // looks alarming until you know that ~40 tool calls per chapter each re-send
  // the same resident context, and that Codex caches that prefix server-side.
  // Without the split there is no way to see which it is.
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  iterationsCompleted: integer('iterations_completed').notNull().default(0),
  activeMinutesUsed: doublePrecision('active_minutes_used').notNull().default(0),
  serveConfig: jsonb('serve_config'),
  publishedSlug: text('published_slug'),
  /**
   * The `/projects` address this build CREATED IN THE REPO, as opposed to
   * `publishedSlug`, which is wherever its sandbox app was copied to — or, on
   * a git-target build, the PR url.
   *
   * Two columns because a change request has both and they are not the same
   * thing. It opens a PR (recorded in `publishedSlug`) that may also add
   * `src/routes/projects/<slug>/+page.svelte`, and that page is a real route
   * the moment the PR merges. Until this column existed nothing connected the
   * two: `isProjectSlug` filtered the build off the index because its
   * `publishedSlug` was a URL, and `getAllowedProjectKeys` would not permit a
   * visibility toggle on the new address either. A page could ship, deploy and
   * be reachable with no way to give it a card.
   *
   * Null on every app build and on any change request that added no page.
   * Setting it does NOT publish: like an AI build's slug, an address with no
   * `project_visibility` row is PRIVATE (see $lib/projects/visibility), so the
   * card appears for the owner and the toggle is what makes it public.
   */
  projectSlug: text('project_slug'),
  // How the build presents itself on /projects once promoted. All three are
  // null for a build published before this existed, and the card falls back to
  // `title` and `prompt` exactly as it always did — which is the reason to
  // curate: an unedited card leads with the raw prompt that was typed to start
  // the build, and reads like a work order rather than a project.
  cardTitle: text('card_title'),
  cardBlurb: text('card_blurb'),
  /** The small right-hand line on the card — "Interactive · Pay data". */
  cardTag: text('card_tag'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  modelProvider: text('model_provider').notNull().default('openrouter'),
  modelId: text('model_id').notNull().default('z-ai/glm-5-turbo'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  priceSnapshot: jsonb('price_snapshot').$type<{ promptPrice: number; completionPrice: number } | null>(),
  failure: jsonb('failure'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /**
   * Liveness ping, written every ~15s while an iteration is in flight.
   * Mirrors `workflow_runs.heartbeat_at` and exists for the same reason.
   *
   * `updated_at` is stamped only at iteration boundaries, and the longest phase
   * of a git-target iteration — `npm run gate` — writes nothing at all for its
   * whole duration (10m22s of silence on one observed build). So a build inside
   * the gate and a build whose sidecar was killed ten minutes ago serialised to
   * byte-identical output, and anything reading the row had no field that could
   * separate them.
   */
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  enforceDesignSystem: boolean('enforce_design_system').notNull().default(true),
  planStatus: text('plan_status').notNull().default('approved'),
  origin: text('origin', { enum: ['manual', 'hermes', 'forge', 'studio'] }).notNull().default('manual'),
  // Git-target mode (Brass & Rails Forge). NULL for every normal build —
  // when null the builder behaves byte-identically to before (same workspace,
  // same publish). When set, the build clones a git repo, branches, runs the
  // gate as its test, and publishes via a GitHub PR instead of the static
  // publish path. The resulting PR/branch URL is recorded in `publishedSlug`.
  gitTargetConfig: jsonb('git_target_config').$type<{
    repoUrl: string;
    baseBranch: string;
    branchPrefix: string;
    gateCommand: string;
    /** Ran once before the PR rather than every iteration — see GitTargetConfig. */
    finalGateCommand?: string;
    openPr: boolean;
    prTitlePrefix?: string;
  } | null>().default(null),
  milestones: jsonb('milestones').$type<Array<{ id: string; title: string; done: boolean; iter?: number }>>().notNull().default(sql`'[]'::jsonb`),
  /**
   * Studio builds only. The FACTS/GAPS brief produced before planning — see
   * src/lib/jkai/research-brief.ts. Injected into the planner and into every
   * iteration; the sourcing gate resolves citations against its fact URLs.
   */
  researchBrief: jsonb('research_brief').$type<StudioResearchBrief | null>().default(null),
  /**
   * Studio builds only. Where the research brief's evidence comes from:
   * 'reuse' = only what the corpus already knows, 'extend' = reuse if it clears
   * the bar else research the gaps seeded with it, 'fresh' = always a new Deep
   * Dive. `src/lib/jkai/research-brief.ts` owns the canonical ResearchMode
   * union; the literals are repeated here deliberately, for the same reason
   * StudioResearchBrief is — schema.ts stays free of app-level ($lib/jkai)
   * imports.
   */
  researchMode: text('research_mode', { enum: ['reuse', 'extend', 'fresh'] })
    .notNull()
    .default('extend'),
  /**
   * Studio builds only. The chapter spine. `leverId`/`outcomeId` are the
   * data-attribute ids studio-gate drives — a chapter with no declared pair
   * cannot be interactivity-checked, and a check that cannot run is a check
   * that silently passes.
   *
   * `src/lib/jkai/prompt.ts` owns the canonical `ChapterPlanEntry` type with
   * an identical shape. This file keeps its own inline copy deliberately, to
   * stay free of app-level ($lib/jkai) imports.
   */
  // `form` and `control` are the editorial half of the spine: how a chapter is
  // told and what the reader touches. Optional in the type because rows
  // written before they existed have neither, and a build mid-flight must keep
  // parsing. jsonb needs no migration for the added keys.
  chapterPlan: jsonb('chapter_plan')
    .$type<
      Array<{
        n: number;
        title: string;
        form?: string;
        control?: string;
        leverId: string;
        outcomeId: string;
      }>
    >()
    .notNull()
    .default(sql`'[]'::jsonb`),
  requireIterationApproval: boolean('require_iteration_approval').notNull().default(false),
  thinkingLevel: text('thinking_level').notNull().default('medium'),
  enabledToolsets: jsonb('enabled_toolsets').$type<string[]>().notNull().default(sql`'["all"]'::jsonb`),
  conversationId: text('conversation_id'),
  attachedWorkflowIds: jsonb('attached_workflow_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  queuedAction: jsonb('queued_action').$type<{
    kind: 'start' | 'resume' | 'restart' | 'approvePlan' | 'skipPlan' | 'approveIteration' | 'replan' | 'continue' | 'rejectIteration';
    prompt?: string;
    modelOverride?: { provider?: string; modelId?: string };
    notes?: string;
    revisedPrompt?: string;
  } | null>(),
  queuedAt: timestamp('queued_at', { withTimezone: true }),
});

export type JkaiBuild = typeof jkaiBuilds.$inferSelect;
export type NewJkaiBuild = typeof jkaiBuilds.$inferInsert;

// Per-project public/private overlay for the /projects page. Keyed by the URL
// segment after /projects/ (a static card key or an AI build's publishedSlug).
// Absence of a row means PUBLIC — the feature is inert until a project is
// explicitly toggled private.
export const projectVisibility = pgTable('project_visibility', {
  projectKey: text('project_key').primaryKey(),
  isPublic: boolean('is_public').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectVisibility = typeof projectVisibility.$inferSelect;

// Guest login allow-list. Emails here may sign in with Google but are NOT site
// owners — owners come from the AUTH_ALLOWED_EMAILS env var and get admin +
// owner-only surfaces. Managed from /admin/access. See src/lib/server/access.ts.
export const allowedUser = pgTable('allowed_user', {
  email: text('email').primaryKey(), // always stored lower-cased
  note: text('note'), // optional label, e.g. "partner", "colleague"
  addedBy: text('added_by'), // owner email that granted access
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AllowedUser = typeof allowedUser.$inferSelect;

// Secure per-project share links. A row grants access to ONE project page even
// when it is private, via an unguessable token. We store only the sha256 of the
// token (the raw token is shown once at creation); a row is live while revokedAt
// is null and expiresAt is null-or-future. One project can have many links.
export const projectShares = pgTable(
  'project_share',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    projectKey: text('project_key').notNull(),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    useCount: integer('use_count').notNull().default(0),
  },
  (t) => ({
    byTokenHash: uniqueIndex('project_share_token_hash_idx').on(t.tokenHash),
    byProject: index('project_share_project_idx').on(t.projectKey),
  }),
);

export type ProjectShare = typeof projectShares.$inferSelect;

// ==========================================
// sr. decks — presentation capability
// Spec: docs/superpowers/specs/2026-07-11-decks-presentation-capability.md
// ==========================================

// A deck is a shareable presentation. Private by default: reachable only by
// the owner or via a deck_share token, until isPublic is toggled.
export const decks = pgTable(
  'decks',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    theme: text('theme').notNull().default('editorial'),
    isPublic: boolean('is_public').notNull().default(false),
    // Social-card poster (site-relative URL) — refreshed by the PDF export,
    // which screenshots the first slide. Null until the deck is first exported.
    ogImage: text('og_image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bySlug: uniqueIndex('decks_slug_idx').on(t.slug) }),
);

export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;

// A deck is a TREE of slides: parentSlideId=null is the main plane; a slide
// with children can be "zoomed into" in the player. `blocks` is the ordered
// jsonb array of typed blocks validated by $lib/presentation/registry.
// `version` is the optimistic-concurrency counter (workflow_nodes pattern):
// clients PATCH with expectedVersion and get 409 on a stale edit.
// parentSlideId has no self-FK (Drizzle self-reference typing quirk); rows are
// removed via the deckId cascade and tree integrity is enforced app-side.
export const deckSlides = pgTable(
  'deck_slides',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    deckId: text('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
    parentSlideId: text('parent_slide_id'),
    position: integer('position').notNull().default(0),
    title: text('title'),
    layout: text('layout').notNull().default('default'),
    blocks: jsonb('blocks').notNull().default(sql`'[]'::jsonb`),
    notes: text('notes'),
    // Names the journey INTO this slide's children ("down for <label>").
    journeyLabel: text('journey_label'),
    // Manual-arrange frames: { "<blockIdx>": {x,y,w} } in % of the stage.
    // Null = the layout archetype positions blocks.
    geometry: jsonb('geometry'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byDeck: index('deck_slides_deck_idx').on(t.deckId, t.parentSlideId, t.position) }),
);

export type DeckSlide = typeof deckSlides.$inferSelect;
export type NewDeckSlide = typeof deckSlides.$inferInsert;

// Secure per-deck share links — exact mirror of project_share: store only the
// sha256 of the raw token; a row is live while revokedAt is null and expiresAt
// is null-or-future.
export const deckShares = pgTable(
  'deck_share',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    deckId: text('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    useCount: integer('use_count').notNull().default(0),
    // Slide-reach telemetry: { "<slideId>": hitCount } — bumped by the
    // player's anonymous beacon (POST /api/decks/[id]/track), share sessions only.
    slidesReached: jsonb('slides_reached'),
  },
  (t) => ({
    byTokenHash: uniqueIndex('deck_share_token_hash_idx').on(t.tokenHash),
    byDeck: index('deck_share_deck_idx').on(t.deckId),
  }),
);

export type DeckShare = typeof deckShares.$inferSelect;

/**
 * Per-event log written by every JKAI-built app. The app POSTs to
 * /api/jkai/builds/<id>/events (same-origin from the proxy iframe; uses the
 * user's session cookie). One row per emission — gives every app a
 * database backing without each canvas needing a data-store wired up.
 */
export const jkaiBuildEvents = pgTable('jkai_build_events', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  // Server-side timestamp — always set, no matter what the client sent.
  // Client-reported `ts` (Date.now() etc.) survives inside `payload`.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiBuildEvent = typeof jkaiBuildEvents.$inferSelect;
export type NewJkaiBuildEvent = typeof jkaiBuildEvents.$inferInsert;

export const buildWorkflowSubscriptions = pgTable(
  'build_workflow_subscriptions',
  {
    buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.buildId, t.workflowId] }),
  }),
);

export type BuildWorkflowSubscription = typeof buildWorkflowSubscriptions.$inferSelect;

export const pendingWorkflowDeliveries = pgTable('pending_workflow_deliveries', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  workflowId: text('workflow_id').notNull(),
  runId: text('run_id').notNull(),
  output: jsonb('output'),
  source: text('source').notNull().default('subscription'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export type PendingWorkflowDelivery = typeof pendingWorkflowDeliveries.$inferSelect;

export const jkaiIterations = pgTable('jkai_iterations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  status: text('status').notNull().default('running'),
  goals: text('goals'),
  plan: text('plan'),
  actions: jsonb('actions').notNull().default(sql`'[]'::jsonb`),
  messages: jsonb('messages').notNull().default(sql`'[]'::jsonb`),
  evaluation: text('evaluation'),
  nextSteps: text('next_steps'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  /** Output only. The per-iteration cap counts these, and they are the part
   *  of an iteration that is genuinely new work rather than re-sent context. */
  outputTokens: integer('output_tokens').notNull().default(0),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  failure: jsonb('failure'),
  retryOfIterationId: text('retry_of_iteration_id'),
});

export type JkaiIteration = typeof jkaiIterations.$inferSelect;
export type NewJkaiIteration = typeof jkaiIterations.$inferInsert;

export const jkaiLogs = pgTable('jkai_logs', {
  id: serial('id').primaryKey(),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  iterationId: text('iteration_id').references(() => jkaiIterations.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiLog = typeof jkaiLogs.$inferSelect;

// Mid-flight user interjections — Phase 5. The agent's iteration loop drains
// any unconsumed rows for a build at the start of each LLM turn and prepends
// them as a `<user-injected>` block in the system prompt, then marks them
// consumed. Lets the user say "stop, do this instead" without restarting.
export const jkaiBuildPendingMessages = pgTable('jkai_build_pending_messages', {
  id: serial('id').primaryKey(),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('user'), // 'user' | 'system' | 'shell-result'
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export type JkaiBuildPendingMessage = typeof jkaiBuildPendingMessages.$inferSelect;

// Pinned notes — Phase 6. Re-injected at the top of every iteration's system
// prompt. Used for "always remember this" feedback that the user wants the
// agent to apply for the rest of the build (e.g. "use black not navy",
// "the API key is in env.X"). Soft delete via removedAt so audit + history
// of notes survive cleanup.
export const jkaiBuildNotes = pgTable('jkai_build_notes', {
  id: serial('id').primaryKey(),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
});

export type JkaiBuildNote = typeof jkaiBuildNotes.$inferSelect;

// ==========================================
// Workflows — Visual Automation Engine
// ==========================================

/**
 * Per-workflow run-outcome notification preferences (D1). Stored on the
 * additive nullable `workflows.notifications` jsonb column. `null`/absent means
 * silent — existing workflows are unaffected and never ping. The engine reads
 * this at terminal-status time (see `src/lib/workflows/run-notifications.ts`).
 *
 *  - onFailure   — WhatsApp the owner when a run ends failed / completed_with_errors.
 *  - onCompletion — WhatsApp the owner a short digest when a run completes cleanly.
 *  - channel     — delivery channel; only 'whatsapp' is wired today.
 *  - digestField — dot-path into the merged terminal-node outputs whose value is
 *                  appended to the completion message (truncated); optional.
 */
export type WorkflowNotifications = {
  onFailure?: boolean;
  onCompletion?: boolean;
  channel?: 'whatsapp';
  digestField?: string;
  // D2 — when true (and channel is whatsapp), an approval node that pauses the
  // run pings the owner on WhatsApp with a one-time code they can reply
  // APPROVE/DENY to, resuming the run remotely.
  approvals?: boolean;
};

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull(),
  description: text('description'),
  trigger: jsonb('trigger').default(sql`'{"type":"manual"}'::jsonb`),
  // D1 — additive nullable opt-in run-outcome notifications. Nullable so the
  // drizzle-kit push is non-destructive; default silent when null/absent.
  notifications: jsonb('notifications').$type<WorkflowNotifications>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export const workflowNodes = pgTable('workflow_nodes', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  position: jsonb('position').notNull().default(sql`'{"x":0,"y":0}'::jsonb`),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  label: text('label').notNull(),
  // Optimistic-concurrency counter, bumped on every PATCH. A client sends the
  // version it loaded as `expectedVersion`; a mismatch (e.g. the AI orchestrator
  // edited the node meanwhile) returns 409 so the human edit isn't silently lost.
  version: integer('version').notNull().default(0),
});

export type WorkflowNode = typeof workflowNodes.$inferSelect;
export type NewWorkflowNode = typeof workflowNodes.$inferInsert;

export const workflowEdges = pgTable('workflow_edges', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  sourceNodeId: text('source_node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  targetNodeId: text('target_node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  sourceHandle: text('source_handle'),
  targetHandle: text('target_handle'),
});

export type WorkflowEdge = typeof workflowEdges.$inferSelect;
export type NewWorkflowEdge = typeof workflowEdges.$inferInsert;

export const workflowRuns = pgTable('workflow_runs', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  trigger: text('trigger').notNull().default('manual'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  healingHistory: jsonb('healing_history').default(sql`'[]'::jsonb`),
  pausedAtNodeId: text('paused_at_node_id'),
  /** Liveness ping written by the engine every ~10s while the run is active.
   *  The boot + periodic reaper marks runs whose heartbeat is &gt;5min stale as
   *  failed/abandoned so a crash or deploy mid-run doesn't leave orphaned
   *  `running` rows that block subsequent dispatch. */
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  /**
   * #19 DURABLE RUN-WORKER (ADDITIVE, FEATURE-FLAGGED) — claim/lease columns
   * for the optional out-of-process run-worker. ALL NULLABLE so existing rows
   * and the in-process (flag-OFF) path are completely unaffected; they are only
   * read/written when `JKAI_RUN_WORKER === '1'`. Not yet applied to the DB —
   * `npx drizzle-kit push` is a separate manual step.
   *
   *  - claimedBy: worker id (hostname:pid:uuid) that currently owns the run.
   *  - claimedAt: when the lease was last (re)acquired.
   *  - leaseExpiresAt: when the lease lapses; another worker may reclaim a
   *    pending/running row past this without waiting for the heartbeat reaper.
   */
  claimedBy: text('claimed_by'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  /**
   * #19 RUN-WORKER — the run's initial input payload, persisted so an enqueued
   * run can be replayed by the out-of-process worker with the same input the
   * in-process path would have passed to engine.execute (gmail/webhook event
   * payloads, manual-run `input`). NULLABLE/additive; only set on the enqueue
   * paths and only read by the worker. Scheduled runs leave it null ({}).
   */
  inputData: jsonb('input_data'),
});

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;

export const nodeExecutions = pgTable('node_executions', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  runId: text('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  inputData: jsonb('input_data'),
  outputData: jsonb('output_data'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  logs: jsonb('logs').default(sql`'[]'::jsonb`),
  // LLM cost / token telemetry — populated by the gateway wrapper when a
  // node makes one or more LLM calls. Sum across calls within a single
  // node execution; per-call breakdown is not retained. Nullable: non-LLM
  // nodes and unknown-priced models leave these fields null so charts can
  // distinguish "no data" from "zero".
  tokensInput: integer('tokens_input'),
  tokensOutput: integer('tokens_output'),
  cacheReadTokens: integer('cache_read_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  provider: text('provider'),
  model: text('model'),
  priceSnapshot: jsonb('price_snapshot'),
});

export type NodeExecution = typeof nodeExecutions.$inferSelect;
export type NewNodeExecution = typeof nodeExecutions.$inferInsert;

export const workflowAuditLog = pgTable(
  'workflow_audit_log',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(), // 'workflow' | 'node' | 'edge' | 'trigger' | 'schedule'
    entityId: text('entity_id'),
    action: text('action').notNull(), // 'create' | 'delete' | 'rename' | 'config' | 'update'
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkflowAt: index('workflow_audit_log_workflow_at_idx').on(t.workflowId, t.at.desc()),
  }),
);

export type WorkflowAuditLog = typeof workflowAuditLog.$inferSelect;
export type NewWorkflowAuditLog = typeof workflowAuditLog.$inferInsert;

export const workflowSchedules = pgTable('workflow_schedules', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
});

export type WorkflowSchedule = typeof workflowSchedules.$inferSelect;
export type NewWorkflowSchedule = typeof workflowSchedules.$inferInsert;

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull(),
  description: text('description'),
  baseUrl: text('base_url'),
  authType: text('auth_type').notNull().default('none'),
  authConfig: jsonb('auth_config').default(sql`'{}'::jsonb`),
  operations: jsonb('operations').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

// ==========================================
// Conversations (JKAI Chat Hub)
// ==========================================

export const conversations = pgTable('jkai_conversations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title'),
  source: text('source').notNull().default('web'), // 'web' | 'whatsapp-continuation'
  whatsappPhoneNumber: text('whatsapp_phone_number'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastMemoryReview: timestamp('last_memory_review', { withTimezone: true }),
  modelProvider: text('model_provider').notNull().default('openrouter'),
  modelId: text('model_id').notNull().default('z-ai/glm-5.2'),
  promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
  completionTokens: bigint('completion_tokens', { mode: 'number' }).notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  priceSnapshot: jsonb('price_snapshot').$type<{ promptPrice: number; completionPrice: number } | null>(),
  pinned: boolean('pinned').notNull().default(false),
  // Read-only sharing. shareVisibility: 'private' (owner only) | 'users' (any
  // signed-in user with the link) | 'public' (anyone with the link). shareToken
  // is the unguessable link id, minted when first shared, kept on unshare.
  shareToken: text('share_token').unique(),
  shareVisibility: text('share_visibility').notNull().default('private'),
  // Whether this thread's entities and relationships are added to /jkai/intel.
  // On by default — the graph rail and the entity links in replies both depend
  // on it. Turning it off stops FUTURE extraction only; whatever the thread has
  // already contributed stays, and is removed separately (see the rail's
  // "forget what this thread added").
  intelEnabled: boolean('intel_enabled').notNull().default(true),
  // How hard the model is told to think on this thread's turns — one of
  // THINKING_LEVELS in $lib/models/thinking, which also maps it onto each
  // provider's request field. NULL means "whatever the provider does by
  // default", which is what every thread did before the control existed.
  //
  // Unlike model_id this is NOT locked after the first message: the model is
  // frozen because price_snapshot and the cost ledger are pinned to it, and a
  // thinking level changes neither. Mid-thread is exactly when you want it —
  // the answer that came back thin is the reason to turn it up.
  thinkingLevel: text('thinking_level'),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

// ==========================================
// Orchestrator Chat Messages
// ==========================================

export const orchestratorChats = pgTable('orchestrator_chats', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The history loader reads a conversation newest-first with a LIMIT, on every
  // turn. Before this the table had only its primary key, so that read was a
  // scan of the whole table filtered down — fine at 3,064 rows and not fine
  // later. Declared HERE rather than added by hand because `drizzle push`
  // drops any index it cannot see in this file.
  index('orchestrator_chats_conversation_idx').on(t.conversationId, t.createdAt),
  index('orchestrator_chats_workflow_idx').on(t.workflowId, t.createdAt),
]);

export type OrchestratorChat = typeof orchestratorChats.$inferSelect;
export type NewOrchestratorChat = typeof orchestratorChats.$inferInsert;

// ==========================================
// JKAI tool-call traces (one row per turn)
// ==========================================
//
// The ordered chain of tool calls a single chat turn made, recorded server-side
// in `handleWithHermes` and rendered by /jkai/trace/[traceId].
//
// This table exists because the chain is otherwise not durable anywhere: the
// Hermes branch never writes `orchestrator_chats.metadata.toolSteps` (only the
// retired in-process loop did), so tool activity lives in the watching browser
// tab and dies on reload. Keeping it here rather than back in message metadata
// is deliberate — the conversation loader selects `metadata` for every message
// in a thread, and a chain can be hundreds of KB.
//
// `id` is the chat job id, which is the only turn identifier that exists on BOTH
// sides while the turn is in flight; the assistant message's row id is not
// created until after `done` has already been published to the client.
export const jkaiToolTraces = pgTable(
  'jkai_tool_traces',
  {
    /** The chat job id (`jobId`) that produced the turn. */
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }),
    /** Back-filled once the assistant row is inserted; null if the turn never persisted one. */
    messageId: text('message_id').references(() => orchestratorChats.id, { onDelete: 'cascade' }),
    /** First user-visible words of the prompt, so the trace page can say what turn this was. */
    prompt: text('prompt'),
    model: text('model'),
    provider: text('provider'),
    costUsd: doublePrecision('cost_usd'),
    stepCount: integer('step_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    /** Wall-clock span of the tool chain (not the whole turn). */
    durationMs: integer('duration_ms'),
    /** ToolTrace from $lib/jkai/tool-trace — capped before it reaches here. */
    steps: jsonb('steps').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jkai_tool_traces_conversation_idx').on(t.conversationId, t.createdAt),
    index('jkai_tool_traces_message_idx').on(t.messageId),
    index('jkai_tool_traces_created_idx').on(t.createdAt),
  ],
);

export type JkaiToolTrace = typeof jkaiToolTraces.$inferSelect;
export type NewJkaiToolTrace = typeof jkaiToolTraces.$inferInsert;

// ==========================================
// JKAI Attachments (multimedia I/O)
// ==========================================

export const jkaiAttachments = pgTable('jkai_attachments', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => orchestratorChats.id, { onDelete: 'set null' }),
  source: text('source').notNull(), // 'web' | 'whatsapp' | 'generated'
  kind: text('kind').notNull(), // 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text'
  mimeType: text('mime_type').notNull(),
  originalName: text('original_name'),
  sizeBytes: integer('size_bytes').notNull(),
  diskPath: text('disk_path').notNull(),
  duration: doublePrecision('duration'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiAttachment = typeof jkaiAttachments.$inferSelect;
export type NewJkaiAttachment = typeof jkaiAttachments.$inferInsert;

// ==========================================
// Workflow Data Store (KV per workflow)
// ==========================================

export const workflowDataStore = pgTable(
  'workflow_data_store',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueWorkflowKey: uniqueIndex('workflow_data_store_workflow_key_idx').on(table.workflowId, table.key),
  }),
);

export type WorkflowDataStore = typeof workflowDataStore.$inferSelect;
export type NewWorkflowDataStore = typeof workflowDataStore.$inferInsert;

// ==========================================
// WhatsApp Integration
// ==========================================

export const whatsappConfig = pgTable('whatsapp_config', {
  id: text('id').primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(false),
  allowedNumbers: jsonb('allowed_numbers').notNull().default(sql`'[]'::jsonb`),
  soulMd: text('soul_md').notNull().default(''),
  authDir: text('auth_dir').notNull().default('data/whatsapp-auth'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsAppConfig = typeof whatsappConfig.$inferSelect;
export type NewWhatsAppConfig = typeof whatsappConfig.$inferInsert;


// ==========================================
// Channels (site-level messaging channels: WhatsApp, Email, ...)
// ==========================================

export const channels = pgTable('channels', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  kind: text('kind').notNull(), // 'whatsapp' | 'email'
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  // config shape per kind:
  //   whatsapp: { allowedNumbers: string[], defaultRecipient?: string, authDir?: string }
  //   email:    { provider: 'smtp'|'resend'|'postmark', from: string, providerConfig: {...}, allowedRecipients?: string[] }
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

// ==========================================
// Home Assistant Integration
// ==========================================

export const homeAssistantConfig = pgTable('home_assistant_config', {
  id: text('id').primaryKey().default('default'),
  url: text('url').notNull().default('http://localhost:8123'),
  token: text('token').notNull().default(''),
  entityRegistry: jsonb('entity_registry').notNull().default(sql`'[]'::jsonb`),
  deviceRegistry: jsonb('device_registry').notNull().default(sql`'[]'::jsonb`),
  areaRegistry: jsonb('area_registry').notNull().default(sql`'[]'::jsonb`),
  lastSynced: timestamp('last_synced', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HomeAssistantConfig = typeof homeAssistantConfig.$inferSelect;
export type NewHomeAssistantConfig = typeof homeAssistantConfig.$inferInsert;

// ==========================================
// Prompt Cache
// ==========================================

export const promptCache = pgTable('prompt_cache', {
  id: text('id').primaryKey().default('default'),
  compiledPrompt: text('compiled_prompt').notNull().default(''),
  fileManifest: jsonb('file_manifest').notNull().default(sql`'[]'::jsonb`),
  lastSynced: timestamp('last_synced', { withTimezone: true }),
});

export type PromptCache = typeof promptCache.$inferSelect;

// ==========================================
// Custom Tools (JKAI self-expanding)
// ==========================================

export const customTools = pgTable('custom_tools', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  toolset: text('toolset').notNull(),
  parameters: jsonb('parameters').notNull().default(sql`'{"type":"object","properties":{}}'::jsonb`),
  handlerCode: text('handler_code').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  runCount: integer('run_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  // 'orchestrator' = LLM-created via create_tool (today, all rows).
  // 'user' = future admin-created path. Defaults to 'orchestrator' so
  // existing rows backfill correctly.
  createdBy: text('created_by').notNull().default('orchestrator'),
});

export type CustomTool = typeof customTools.$inferSelect;

// ==========================================
// JKAI Memories
// ==========================================

export const jkaiMemories = pgTable('jkai_memories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  category: text('category').notNull(), // people, preferences, places, health, devices, situations
  content: text('content').notNull(),
  sourceConversationId: text('source_conversation_id'),
  confidence: text('confidence').notNull().default('high'), // high, medium
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  supersededBy: text('superseded_by'),
});

export type JkaiMemory = typeof jkaiMemories.$inferSelect;

export const quickAnswers = pgTable('quick_answer', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  topic: text('topic').notNull(),
  goals: jsonb('goals').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text('status').notNull().default('pending'),
  answer: text('answer'),
  sources: jsonb('sources').$type<QuickAnswerSource[]>().notNull().default(sql`'[]'::jsonb`),
  queries: jsonb('queries').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  errorMessage: text('error_message'),
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export interface QuickAnswerSource {
  url: string;
  title: string;
  domain: string;
  credibilityScore: number;
  credibilityType: string;
  snippet: string;
  citationIndex: number;
}

export type QuickAnswer = typeof quickAnswers.$inferSelect;

// ==========================================
// Research Desk — Synthesis Runs
// On-demand, re-runnable streamed LLM passes over the artefact pile. Each run
// owns its own clusters/summary; it never overwrites researchSessions.report.
// ==========================================

export const synthesisRuns = pgTable('synthesis_runs', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id')
    .notNull()
    .references(() => researchSessions.id),
  scope: jsonb('scope').notNull().default(sql`'{}'::jsonb`),
  status: text('status').notNull().default('running'), // running|complete|failed|cancelled
  summary: text('summary'),
  clusters: jsonb('clusters').notNull().default(sql`'[]'::jsonb`),
  tokensUsed: integer('tokens_used'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type SynthesisRun = typeof synthesisRuns.$inferSelect;
export type NewSynthesisRun = typeof synthesisRuns.$inferInsert;

// ==========================================
// Intel explorations — per-canvas index of
// deep/quick research sessions commissioned
// from an intelligence node's "Explore further"
// action. Authoritative data lives in
// research_sessions / quick_answers; this row
// lets the canvas rehydrate pending children
// on reload without reverse-engineering the
// node's config.
// ==========================================

export const intelExplorations = pgTable('intel_explorations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  nodeId: text('node_id')
    .notNull()
    .references(() => workflowNodes.id, { onDelete: 'cascade' }),
  parentNodeId: text('parent_node_id')
    .notNull()
    .references(() => workflowNodes.id, { onDelete: 'cascade' }),
  engine: text('engine').notNull(), // 'deep' | 'quick'
  sessionId: text('session_id').notNull(),
  status: text('status').notNull(), // 'running' | 'complete' | 'failed' | 'cancelled'
  topic: text('topic').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
});

export type IntelExploration = typeof intelExplorations.$inferSelect;
export type NewIntelExploration = typeof intelExplorations.$inferInsert;

// ==========================================
// App Settings (generic key/value) + OpenRouter models cache
// ==========================================

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const openrouterModels = pgTable('openrouter_models', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  contextLength: integer('context_length'),
  promptPrice: numeric('prompt_price', { precision: 20, scale: 12 }),
  completionPrice: numeric('completion_price', { precision: 20, scale: 12 }),
  imagePrice: numeric('image_price', { precision: 20, scale: 12 }),
  modality: text('modality'),
  provider: text('provider'),
  // Tokens/sec — max p50_throughput across the model's OpenRouter provider
  // endpoints (from the frontend stats API). Null when none report throughput.
  throughput: numeric('throughput', { precision: 12, scale: 3 }),
  raw: jsonb('raw').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── JKAI Intel: Knowledge Graph ─────────────────────────────────────

export const intelEntityTypes = pgTable('intel_entity_types', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull().unique(),
  /** 'active' | 'proposed' | 'retired'. A model-proposed type is HELD rather
   *  than admitted straight into the taxonomy: an auto-admitted type re-enters
   *  the next extraction prompt as a legitimate option, which is how a stray
   *  `font` type ended up collecting newspapers. */
  status: text('status').notNull().default('active'),
  proposedRationale: text('proposed_rationale'),
  /** Set when this type has been folded into another. */
  mergedIntoTypeId: text('merged_into_type_id'),
  icon: text('icon').notNull().default('🔷'),
  color: text('color').notNull().default('#7dd3fc'),
  isSeeded: boolean('is_seeded').notNull().default(false),
  description: text('description').notNull().default(''),
  propertySchema: jsonb('property_schema').$type<Record<string, string>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelEntityType = typeof intelEntityTypes.$inferSelect;

export const intelNotes = pgTable('intel_notes', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title'),
  rawContent: text('raw_content').notNull(),
  processedContent: text('processed_content'),
  source: text('source').notNull().default('web'),
  format: text('format').notNull().default('text'),
  embedding: vector('embedding'),
  status: text('status').notNull().default('pending'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  /** Resolved ER category slugs (see intel_categories). Denormalised from the
   *  source's Drive folder at extraction time so the graph can filter on them
   *  without walking file paths inside the cached analytics snapshot; re-synced
   *  when folder settings change. */
  categories: jsonb('categories').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /**
   * When the thing this note describes actually HAPPENED, as distinct from when
   * the row was written. Null means "no better answer than createdAt".
   *
   * `createdAt` is the ingest clock and is useless for ranking correspondence:
   * every email note lands on the day its sweep ran, so on 2026-08-05 all 1,038
   * of them shared a single day while the mail they describe spanned the twelve
   * week rolling window. Anything time-weighted — relevance, the graph's
   * staleness fade, the card's evidence timeline — has to read this instead, or
   * an eleven-week-old thread scores exactly as fresh as this morning's.
   *
   * For Gmail this is the thread's `internalDate`, which is Gmail's own receipt
   * time rather than the sender-written `Date` header.
   */
  observedAt: timestamp('observed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Same reasoning as `intel_entities_embedding_hnsw_idx` — this is the second
  // vector query `buildKnowledgeContext` runs on every chat turn. Smaller table
  // (1,821 embedded notes) so it costs ~21ms today, but it is the same Seq Scan
  // and it grows the same way.
  byEmbedding: index('intel_notes_embedding_hnsw_idx').using(
    'hnsw',
    sql`${t.embedding} vector_cosine_ops`,
  ),
}));

export type IntelNote = typeof intelNotes.$inferSelect;
export type NewIntelNote = typeof intelNotes.$inferInsert;

export const intelEntities = pgTable(
  'intel_entities',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    name: text('name').notNull(),
    typeId: text('type_id').notNull().references(() => intelEntityTypes.id),
    summary: text('summary'),
    properties: jsonb('properties').$type<Record<string, unknown>>(),
    embedding: vector('embedding'),
    confidence: text('confidence').notNull().default('medium'),
    confirmed: boolean('confirmed').notNull().default(false),
    mergedIntoId: text('merged_into_id'),
    firstSeenIn: text('first_seen_in').references(() => intelNotes.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // ── Resolution ───────────────────────────────────────────────────────
    /** Every observed surface form. Later extractions bind onto these rather
     *  than forking a second node — "IBCA" lives here on the expanded row. */
    aliases: jsonb('aliases').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** `canonicalName(name)` — the name with file extensions, namespace
     *  prefixes and legal suffixes removed. Stored rather than computed so
     *  write-time resolution is one indexed lookup instead of a scan; it is
     *  derived, so a bad value is fixed by recomputing it. */
    canonicalName: text('canonical_name'),

    // ── Foreground ───────────────────────────────────────────────────────
    /** On the watchlist: structural changes to this entity raise an insight. */
    watched: boolean('watched').notNull().default(false),
    /** Which lens this belongs to — 'professional' | 'personal' | null. */
    lens: text('lens'),

    // ── Trust (Admiralty-style dual grading) ─────────────────────────────
    /** Source reliability A–F. Null until graded. */
    sourceGrade: text('source_grade'),
    /** Information credibility 1–6. Null until graded. */
    credibility: integer('credibility'),
    /** Distinct notes independently asserting this entity. */
    corroboration: integer('corroboration').notNull().default(0),
    /** Computed, explainable 0..1 — never shown without its components. */
    confidenceScore: doublePrecision('confidence_score'),
    lastCorroboratedAt: timestamp('last_corroborated_at', { withTimezone: true }),
  },
  // Plain indexes only. A unique index on a POPULATED table silently breaks
  // non-interactive `drizzle-kit push` (see reference_drizzle_unique_push_gotcha);
  // these are all non-unique and therefore safe to add in place.
  (t) => ({
    byType: index('intel_entities_type_idx').on(t.typeId),
    byMerged: index('intel_entities_merged_idx').on(t.mergedIntoId),
    byWatched: index('intel_entities_watched_idx').on(t.watched),
    byUpdated: index('intel_entities_updated_idx').on(t.updatedAt),
    byCanonical: index('intel_entities_canonical_idx').on(t.canonicalName),
    // Cosine-distance ANN index for the `<=>` lookup `buildKnowledgeContext`
    // runs on EVERY chat turn. Without it that query is a Seq Scan over every
    // embedded entity: measured 2026-08-24 on production at 187ms / 13,313
    // rows / 14,170 buffers read, and it grows with the graph. It sits on the
    // critical path before the first LLM call, so it is latency the user feels.
    // Measured on a production-scale copy: 61.5ms → 0.65ms.
    //
    // Three things to know before touching this:
    //
    // 1. Written as raw SQL rather than `t.embedding.op('vector_cosine_ops')`
    //    because `vector` here is a `customType`, which has no `.op()`. The
    //    opclass must match the operator the query uses (`<=>` = cosine); an
    //    l2_ops index would be built happily and then never chosen.
    //
    // 2. **drizzle-kit 0.31 cannot round-trip an hnsw index**, so `push` DROPS
    //    AND RECREATES both of these every time it runs — verified by OID, and
    //    it is specific to hnsw (the plain btree indexes beside it are stable).
    //    That costs ~5.4s per index at 13k rows and the release step allows
    //    180s, so it is tolerated, not fixed. It is NOT fixable by leaving the
    //    index out of this file and creating it by hand either: `push`
    //    reconciles, so an index it cannot see is an index it deletes.
    //
    // 3. HNSW is APPROXIMATE. The query post-filters on `merged_into_id IS
    //    NULL` (407 of 13,720 rows, 3%) against a default `ef_search` of 40 for
    //    a LIMIT of 8, so it will not run short in practice — but it is a
    //    ranked shortlist for a prompt section, already cut at distance < 0.6,
    //    and exact top-8 was never the requirement.
    byEmbedding: index('intel_entities_embedding_hnsw_idx').using(
      'hnsw',
      sql`${t.embedding} vector_cosine_ops`,
    ),
  }),
);

export type IntelEntity = typeof intelEntities.$inferSelect;
export type NewIntelEntity = typeof intelEntities.$inferInsert;

export const intelRelationships = pgTable(
  'intel_relationships',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    sourceEntityId: text('source_entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
    targetEntityId: text('target_entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    label: text('label'),
    /** Display bucket. Derived from `weight` — see the note on it below. */
    strength: text('strength').notNull().default('moderate'),
    properties: jsonb('properties').$type<Record<string, unknown>>(),
    confidence: text('confidence').notNull().default('medium'),
    sourceNoteId: text('source_note_id').references(() => intelNotes.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Continuous edge weight 0..1. The TEXT `strength` column has never been
     *  written by anything — every live edge sat at the 'moderate' default,
     *  which made the graph's stroke-width encoding inert. This is the real
     *  measure; `strength` is now derived from it for display. */
    weight: doublePrecision('weight').notNull().default(0.5),
    /** How many independent notes assert this edge. Drives weight and
     *  corroboration; incremented on re-observation instead of duplicating. */
    observationCount: integer('observation_count').notNull().default(1),
    /** Carried from the deep-dive relationship extractor, previously discarded. */
    sentiment: text('sentiment'),
    /** User-authored or user-corrected — never overwritten by extraction. */
    manual: boolean('manual').notNull().default(false),
    /** Deleted-with-reason. Blocks re-creation by a later extraction, so
     *  correcting the graph actually sticks. */
    suppressed: boolean('suppressed').notNull().default(false),
    suppressedReason: text('suppressed_reason'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => ({
    bySource: index('intel_rel_source_idx').on(t.sourceEntityId),
    byTarget: index('intel_rel_target_idx').on(t.targetEntityId),
    byNote: index('intel_rel_note_idx').on(t.sourceNoteId),
  }),
);

export type IntelRelationship = typeof intelRelationships.$inferSelect;

// ==========================================
// RAG — "Interact using model" over Drive files
// One row per built index. The heavy embeddings are serialized to Azure Blob
// (via file-store/storage.ts under a `rag-index/` prefix), NOT pgvector — so
// this table has NO `vector` column and drizzle-kit push never depends on the
// pgvector extension for it, and a quality 3072-dim embedding model has a home.
// ==========================================
export const ragCollections = pgTable(
  'rag_collections',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    name: text('name').notNull(),
    owner: text('owner').notNull(), // email; the whole authed area is owner-only
    status: text('status').notNull().default('pending'), // 'pending'|'indexing'|'ready'|'error'
    embeddingModel: text('embedding_model').notNull(),
    embeddingDim: integer('embedding_dim').notNull().default(0),
    fileIds: jsonb('file_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    fileNames: jsonb('file_names').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    chunkCount: integer('chunk_count').notNull().default(0),
    indexBlobKey: text('index_blob_key'), // rag-index/<id>.ndjson; null until built
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ownerIdx: index('rag_collections_owner_idx').on(t.owner) }),
);

export type RagCollection = typeof ragCollections.$inferSelect;
export type NewRagCollection = typeof ragCollections.$inferInsert;

// One row per chat turn against a collection. Kept deliberately separate from
// jkai_conversations/orchestrator_chats so the RAG feature is self-contained
// and does not show up in the jkai cost/metrics ledgers.
export const ragMessages = pgTable(
  'rag_messages',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    collectionId: text('collection_id')
      .notNull()
      .references(() => ragCollections.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user'|'assistant'
    content: text('content').notNull(),
    citations: jsonb('citations')
      .$type<Array<{ n: number; source: string; ord: number }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byCollection: index('rag_messages_collection_idx').on(t.collectionId) }),
);

export type RagMessage = typeof ragMessages.$inferSelect;
export type NewRagMessage = typeof ragMessages.$inferInsert;

export const intelNoteEntities = pgTable('intel_note_entities', {
  noteId: text('note_id').notNull().references(() => intelNotes.id, { onDelete: 'cascade' }),
  entityId: text('entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
  relevance: text('relevance').notNull().default('mentioned'),
  excerpt: text('excerpt'),
});

export const intelTimelineEvents = pgTable('intel_timeline_events', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  entityId: text('entity_id').references(() => intelEntities.id, { onDelete: 'set null' }),
  noteId: text('note_id').notNull().references(() => intelNotes.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  dateEnd: text('date_end'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelTimelineEvent = typeof intelTimelineEvents.$inferSelect;

export const intelAlerts = pgTable('intel_alerts', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  noteId: text('note_id').notNull().references(() => intelNotes.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  significance: text('significance').notNull().default('medium'),
  relatedEntityIds: jsonb('related_entity_ids').$type<string[]>().notNull().default([]),
  delivered: boolean('delivered').notNull().default(false),
  dismissed: boolean('dismissed').notNull().default(false),
  /** Why it was dismissed — feeds back into scoring rather than vanishing. */
  dismissedReason: text('dismissed_reason'),
  /** Stable key so the same alert is not raised twice. */
  dedupeKey: text('dedupe_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Scraper ----

export const scraperCredentials = pgTable('scraper_credentials', {
  id: serial('id').primaryKey(),
  domain: text('domain').notNull(),      // e.g. 'civilservicejobs.gov.uk'
  label: text('label').notNull(),        // human-friendly label
  credentialEnc: text('credential_enc').notNull(), // AES-GCM, JSON blob
  loginUrl: text('login_url'),           // optional — where to POST/fill credentials
  loginStrategy: text('login_strategy').notNull().default('form'), // 'form' | 'script' | 'cookie'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const scraperRunLog = pgTable('scraper_run_log', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  profile: text('profile').notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
  success: boolean('success').notNull().default(false),
  pagesLoaded: integer('pages_loaded').notNull().default(0),
  error: text('error'),
  workflowRunId: text('workflow_run_id'),
});

export type ScraperCredential = typeof scraperCredentials.$inferSelect;
export type ScraperRunLogRow = typeof scraperRunLog.$inferSelect;

export type IntelAlert = typeof intelAlerts.$inferSelect;

// ── Intel phase 2: insights, lenses, dossiers, commissions, merge ledger ────
//
// Every table below is NEW, so unique indexes are safe here — the drizzle-kit
// push hazard only applies to adding a unique constraint to a table that
// already holds rows.

/**
 * Generated insights, persisted rather than recomputed per request.
 *
 * The dashboard computed these on the fly, which meant they could not be
 * dismissed, snoozed, or compared against yesterday — and "what changed" is
 * the whole point of a watchlist. `dedupeKey` stops the same finding
 * reappearing every night.
 */
export const intelInsights = pgTable(
  'intel_insights',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** Deterministic, rule-generated. Always present. */
    explanation: text('explanation').notNull(),
    /** Optional LLM phrasing, applied to the top few only. Never required. */
    narrative: text('narrative'),
    score: doublePrecision('score').notNull().default(0),
    /** Every component of `score`, so a card can show the breakdown.
     *  Rule: never show an unexplained number. */
    components: jsonb('components').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    entityIds: jsonb('entity_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    path: jsonb('path').$type<string[]>(),
    lens: text('lens'),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull().default('new'), // new|seen|dismissed|actioned|snoozed
    dismissedReason: text('dismissed_reason'),
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
    proposedActions: jsonb('proposed_actions')
      .$type<Array<{ kind: string; label: string; payload: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    runId: text('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index('intel_insights_status_idx').on(t.status),
    byKind: index('intel_insights_kind_idx').on(t.kind),
    uniqDedupe: uniqueIndex('intel_insights_dedupe_idx').on(t.dedupeKey),
  }),
);

export type IntelInsight = typeof intelInsights.$inferSelect;
export type NewIntelInsight = typeof intelInsights.$inferInsert;

/** A named perspective, applied across graph, entities, timeline and chat. */
export const intelLenses = pgTable(
  'intel_lenses',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** { typeIds?, sources?, lens?, communityIds?, minConfidence?, query? } */
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Prepended to jkai's intel context while this lens is active. */
    standingInstructions: text('standing_instructions'),
    isDefault: boolean('is_default').notNull().default(false),
    /** Non-null turns a saved view into a LIVE query: a scheduled run that
     *  raises an insight when the result set grows. */
    cron: text('cron'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastCount: integer('last_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqSlug: uniqueIndex('intel_lenses_slug_idx').on(t.slug) }),
);

export type IntelLens = typeof intelLenses.$inferSelect;

/** A case file: the working set for one line of enquiry. */
export const intelDossiers = pgTable(
  'intel_dossiers',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    standingInstructions: text('standing_instructions'),
    lensId: text('lens_id'),
    status: text('status').notNull().default('open'), // open|parked|closed
    openQuestions: jsonb('open_questions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqSlug: uniqueIndex('intel_dossiers_slug_idx').on(t.slug) }),
);

export type IntelDossier = typeof intelDossiers.$inferSelect;

export const intelDossierItems = pgTable(
  'intel_dossier_items',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    dossierId: text('dossier_id')
      .notNull()
      .references(() => intelDossiers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // entity|note|insight|commission|timeline|text
    refId: text('ref_id'),
    body: text('body'), // for kind='text' — the analyst's own note
    position: integer('position').notNull().default(0),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byDossier: index('intel_dossier_items_dossier_idx').on(t.dossierId) }),
);

export type IntelDossierItem = typeof intelDossierItems.$inferSelect;

/**
 * Work commissioned from a finding. Records what was started and, once it
 * finishes, where the output landed — which is what closes the loop back into
 * the graph rather than leaving a deep dive orphaned.
 */
export const intelCommissions = pgTable(
  'intel_commissions',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    insightId: text('insight_id'),
    entityId: text('entity_id'),
    dossierId: text('dossier_id'),
    kind: text('kind').notNull(), // research|ask|monitor|workflow|canvas|briefing|brief
    payload: text('payload').notNull(),
    /** The durable handle the target system returned (research sessionId,
     *  monitor workflowId, …), so progress can be polled. */
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    status: text('status').notNull().default('queued'), // queued|running|complete|failed
    resultNoteId: text('result_note_id'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index('intel_commissions_status_idx').on(t.status),
    byEntity: index('intel_commissions_entity_idx').on(t.entityId),
  }),
);

export type IntelCommission = typeof intelCommissions.$inferSelect;

/**
 * Merge ledger. `unmergeEntity` could previously only clear the tombstone;
 * with a pre-merge snapshot recorded here a bad resolution decision can be
 * undone properly, months later.
 */
export const intelEntityMerges = pgTable(
  'intel_entity_merges',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    survivorId: text('survivor_id').notNull(),
    mergedId: text('merged_id').notNull(),
    /** Pre-merge state of the merged row plus the ids that were repointed. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    score: doublePrecision('score'),
    method: text('method').notNull().default('manual'), // auto|manual
    reason: text('reason'),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bySurvivor: index('intel_merges_survivor_idx').on(t.survivorId) }),
);

export type IntelEntityMerge = typeof intelEntityMerges.$inferSelect;

/**
 * Analyst-defined labels for intel SOURCES — "work", "family", "policy" — as
 * distinct from `intel_entity_types`, which classify what a node *is*. A
 * category is attached to a Drive folder and inherited by everything under it;
 * the resolved slugs land on `intel_notes.categories` at extraction time and
 * become a first-class filter on the graph.
 */
export const intelCategories = pgTable(
  'intel_categories',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#7dd3fc'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqSlug: uniqueIndex('intel_categories_slug_idx').on(t.slug) }),
);

export type IntelCategory = typeof intelCategories.$inferSelect;
export type NewIntelCategory = typeof intelCategories.$inferInsert;

/**
 * Per-folder settings for /drive. Drive folders are VIRTUAL — they exist only
 * as `/`-separated prefixes of `workflow_files.name` — so there is no row to
 * hang a column on, and a per-file column would need rewriting on every move.
 * Keyed on the folder path with no trailing slash ('' is the root).
 *
 * Resolution is inheritance-based (see `$lib/jkai/intel/source-policy`):
 *   - `intelMode`: the NEAREST ancestor with a non-'inherit' mode decides.
 *   - `categoryIds`: the UNION of every ancestor's categories.
 */
export const driveFolderSettings = pgTable(
  'drive_folder_settings',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    path: text('path').notNull(),
    /** 'inherit' | 'include' | 'exclude' — whether files here feed the intel graph. */
    intelMode: text('intel_mode').notNull().default('inherit'),
    categoryIds: jsonb('category_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqPath: uniqueIndex('drive_folder_settings_path_idx').on(t.path) }),
);

export type DriveFolderSetting = typeof driveFolderSettings.$inferSelect;
export type NewDriveFolderSetting = typeof driveFolderSettings.$inferInsert;

// ---- Gmail channel ----

export const gmailAccounts = pgTable('gmail_accounts', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  // Encrypted with AES-GCM; format iv:tag:ct
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  accessTokenEnc: text('access_token_enc'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  scopes: text('scopes').notNull(), // space-separated
  status: text('status').notNull().default('active'), // active | auth_expired | disabled
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const gmailWatches = pgTable('gmail_watches', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull(),
  label: text('label').notNull(),
  query: text('query').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gmailHistoryCursors = pgTable('gmail_history_cursors', {
  accountId: integer('account_id').primaryKey(),
  historyId: text('history_id').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type GmailWatch = typeof gmailWatches.$inferSelect;
export type GmailHistoryCursor = typeof gmailHistoryCursors.$inferSelect;

// ---- Workflow interactions (human-in-the-loop) ----
// A single pending or resolved interaction request, emitted by the engine
// when a workflow reaches an `interactive-step` node. The workflow run's
// status becomes 'awaiting_human' until this row's resolvedAt is set.

export const workflowInteractions = pgTable('workflow_interactions', {
  id: serial('id').primaryKey(),
  runId: text('run_id').notNull(),              // references workflow_runs.id (text UUID)
  nodeId: text('node_id').notNull(),            // the workflow_nodes.node_id (string, per convention)
  mode: text('mode').notNull(),                 // 'vnc' | 'confirm' | 'both'
  prompt: text('prompt').notNull().default(''), // instruction shown to the human
  configSnapshot: jsonb('config_snapshot').notNull(),  // full node config as seen at pause time (fields, profile, url, etc.)
  vncSessionId: text('vnc_session_id'),         // populated when mode includes 'vnc'; references the in-memory session
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: text('resolved_by'),              // user email from session at resolve time
  formValues: jsonb('form_values'),             // populated on resolve (for 'confirm' / 'both' modes)
  cancelled: boolean('cancelled').notNull().default(false),
});

export type WorkflowInteraction = typeof workflowInteractions.$inferSelect;

// ==========================================
// Scraper — Target Knowledge Store
// ==========================================

export const scraperTargetKnowledge = pgTable('scraper_target_knowledge', {
  id: serial('id').primaryKey(),
  domain: text('domain').notNull().unique(),
  requiresInteractive: boolean('requires_interactive').notNull().default(false),
  interactiveHint: text('interactive_hint'),    // e.g. 'Altcha CAPTCHA + cookie consent'
  knownSelectors: jsonb('known_selectors'),     // optional { field -> selector } map
  notes: text('notes'),
  source: text('source').notNull().default('manual'),  // 'manual' | 'auto-captcha-detected' | 'auto-failure'
  // Deterministic recipe generated by the site-mapper node: url template,
  // wait condition, extract rules, acceptance test. stealth-scrape dispatches
  // through this when present so unattended runs don't re-derive navigation
  // every execution. Shape in src/lib/workflows/scraper/playbook.ts.
  playbook: jsonb('playbook'),
  playbookUpdatedAt: timestamp('playbook_updated_at'),
  lastVerifiedAt: timestamp('last_verified_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type ScraperTargetKnowledge = typeof scraperTargetKnowledge.$inferSelect;

// ==========================================
// Workflow Files (file store consumed by pipelines)
// ==========================================
//
// One row per stored file. Files live on disk at `diskPath` (absolute path
// inside WORKFLOW_FILES_ROOT). The `permissions` JSONB is a simple capability
// map — the file-store node enforces it at runtime. Files are global, not
// workflow-scoped, so the same file can be consumed by multiple workflows.

export const workflowFiles = pgTable(
  'workflow_files',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    name: text('name').notNull(),                    // display name (unique, used as key from nodes)
    description: text('description'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    diskPath: text('disk_path').notNull(),           // absolute path under WORKFLOW_FILES_ROOT
    permissions: jsonb('permissions').notNull().default(sql`'{"read":true,"write":false,"append":false,"delete":false}'::jsonb`),
    uploadedBy: text('uploaded_by'),                 // email of uploader, nullable for system-generated
    contentHash: text('content_hash'),               // sha256 hex of the current bytes; gates re-embedding (null = never embedded)
    indexError: text('index_error'),                 // why the last index attempt produced no text; null once it succeeds
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueName: uniqueIndex('workflow_files_name_idx').on(table.name),
  }),
);

export type WorkflowFile = typeof workflowFiles.$inferSelect;
export type NewWorkflowFile = typeof workflowFiles.$inferInsert;

// One high-entropy capability, one drive file. Replaced `route_export_token`,
// the GPX-only ancestor dropped in #311 — that table's `expires_at` was
// nullable and never written, so every link it minted was a permanent,
// unlisted, unkillable anonymous URL.
//
// The two columns that stop that recurring:
//   - `expiresAt` is NOT NULL, so a share cannot be created without a lifetime.
//   - `createdBy` records whether the owner or an agent minted it, so the
//     revocation list on /drive can be read at a glance.
export const fileShareTokens = pgTable(
  'file_share_token',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    fileId: text('file_id').notNull().references(() => workflowFiles.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** Free text shown in the owner's share list, e.g. "WhatsApp to Dad". */
    label: text('label'),
    /** An owner email, or an agent tag such as `route-export`. */
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    useCount: integer('use_count').notNull().default(0),
  },
  (t) => ({
    byTokenHash: uniqueIndex('file_share_token_hash_idx').on(t.tokenHash),
    byFile: index('file_share_token_file_idx').on(t.fileId),
    byExpiry: index('file_share_token_expires_idx').on(t.expiresAt),
  }),
);

export type FileShareToken = typeof fileShareTokens.$inferSelect;

export type WorkflowFilePermissions = {
  read: boolean;
  write: boolean;
  append: boolean;
  delete: boolean;
};

// Global, always-on semantic index over the CONTENT of every /drive file — one
// row per chunk. Populated automatically on upload/edit (see $lib/file-index),
// keyed on the stable workflow_files.id (never the mutable name). Text files are
// chunked from extracted text; images are captioned+OCR'd; audio is transcribed;
// each chunk is embedded with text-embedding-3-small (1536-dim) so the existing
// pgvector `vector(1536)` type + `<=>` cosine operator work directly. Deleting a
// file cascades away its chunks. This is the backing store for the `@files`
// search tool in /jkai, distinct from the per-collection RAG (rag_collections).
export const fileEmbeddings = pgTable(
  'file_embeddings',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    fileId: text('file_id')
      .notNull()
      .references(() => workflowFiles.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),     // hash of the bytes this chunk was embedded from
    chunkOrd: integer('chunk_ord').notNull(),         // 0-based ordinal within the file
    source: text('source').notNull(),                 // file name at embed time (display/citation)
    modality: text('modality').notNull(),             // 'text' | 'image' | 'audio' | 'ocr' — how the text was derived
    text: text('text').notNull(),                     // the chunk text that was embedded
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embeddingDim: integer('embedding_dim').notNull(),
    embedding: vector('embedding').notNull(),         // unit-normalized 1536-dim vector
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byFile: index('file_embeddings_file_idx').on(table.fileId),
    uniqChunk: uniqueIndex('file_embeddings_file_chunk_idx').on(table.fileId, table.chunkOrd),
  }),
);

export type FileEmbedding = typeof fileEmbeddings.$inferSelect;
export type NewFileEmbedding = typeof fileEmbeddings.$inferInsert;

// One row per provisioned WebDAV mount credential. The mount client uses
// HTTP Basic Auth — username is informational (we use the label), password
// is the raw token whose sha256 is stored in `secretHash`. The token is
// shown to the user once at creation and never retrievable after.
// Drive operations are gated only by an unrevoked credential — they do NOT
// honour the per-file workflow_files.permissions map (that map exists to
// gate workflow nodes, not the human mount).

export const webdavCredentials = pgTable(
  'webdav_credentials',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    label: text('label').notNull(),
    secretHash: text('secret_hash').notNull(),
    ownerEmail: text('owner_email').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    bySecret: uniqueIndex('webdav_credentials_secret_hash_idx').on(t.secretHash),
  }),
);

export type WebdavCredentialRow = typeof webdavCredentials.$inferSelect;

// ==========================================
// Heartbeat — perpetual action queue
// ==========================================
// One perpetual ticker (default 30s). On each tick the engine looks at the
// heartbeat_actions table and fires any active row whose next_run_at has
// passed. There is NO retry limit — actions run forever until status flips
// to 'done' (orchestrator marks the goal met) or 'paused' (admin disables).
//
// Two kinds:
//   - 'system-scan'  — code-driven background scans like chat-continuation,
//                      build-progress-check, workflow-review. Seeded by the
//                      engine on first boot. Handler matches `name`.
//   - 'targeted'     — dynamic actions written by the orchestrator via a
//                      tool call (register_heartbeat_action). Each carries
//                      a goal + prompt + conversation_id; the engine runs
//                      a focused LLM turn, lets the LLM either take a step
//                      (auto-continuing the conversation) or mark itself
//                      done by replying with a DONE: prefix.

export const heartbeatActions = pgTable('heartbeat_actions', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  /** 'system-scan' | 'targeted' */
  kind: text('kind').notNull().default('targeted'),
  /** What "done" looks like — used for prompting + audit. */
  goal: text('goal'),
  /** For 'targeted' — the LLM prompt run on each tick. */
  prompt: text('prompt'),
  cadenceSeconds: integer('cadence_seconds').notNull(),
  /** 'active' | 'done' | 'failed' | 'paused' */
  status: text('status').notNull().default('active'),
  /** For 'targeted' — the conversation that owns this action. */
  conversationId: text('conversation_id'),
  /** 'orchestrator' | 'system' | 'manual' */
  source: text('source').notNull().default('system'),
  // Optional active-hours window. HH:MM 24h. tz IANA. Null = 24/7.
  activeHoursStart: text('active_hours_start'),
  activeHoursEnd: text('active_hours_end'),
  activeHoursTz: text('active_hours_tz'),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  totalRuns: integer('total_runs').notNull().default(0),
  /**
   * Error pulses since the last non-error one. Reset to 0 on any success.
   * Same column name and semantics as `jkai_builds.consecutive_failures`.
   *
   * Without this the engine had no failure budget at all: an action whose
   * conversation had been deleted logged 22,127 consecutive `conversation not
   * found` errors over nine days at full 30s cadence, and was only stopped by
   * a human noticing. Past `HEARTBEAT_BACKOFF_AFTER` the engine widens the
   * interval; past `HEARTBEAT_PAUSE_AFTER` it flips status to 'paused'.
   */
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /** Summary of the most recent error, so a paused action can explain itself. */
  lastError: text('last_error'),
  totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type HeartbeatAction = typeof heartbeatActions.$inferSelect;
export type NewHeartbeatAction = typeof heartbeatActions.$inferInsert;

export const heartbeatPulses = pgTable(
  'heartbeat_pulses',
  {
    id: serial('id').primaryKey(),
    actionId: text('action_id').notNull().references(() => heartbeatActions.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    /** 'fired' | 'ok' | 'skipped' | 'error' | 'completed' */
    outcome: text('outcome').notNull(),
    summary: text('summary').notNull(),
    details: jsonb('details'),
    durationMs: integer('duration_ms'),
    conversationId: text('conversation_id'),
    jobId: text('job_id'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  },
  (table) => ({
    byAction: index('heartbeat_pulses_action_ts_idx').on(table.actionId, table.ts),
    byTs: index('heartbeat_pulses_ts_idx').on(table.ts),
  }),
);

export type HeartbeatPulse = typeof heartbeatPulses.$inferSelect;
export type NewHeartbeatPulse = typeof heartbeatPulses.$inferInsert;

// ==========================================
// Scheduled callbacks — one-shot time-based fires
// ==========================================
// Distinct from heartbeat (periodic agent turns) and background tasks
// (long-running work). This is the OpenClaw "cron lane": "do X at time Y",
// either as a fixed reply, a direct tool call, or a re-engagement of the
// orchestrator. One-shot for v1 (recurrence is a future addition).

export const scheduledCallbacks = pgTable(
  'scheduled_callbacks',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    /** Stable, human-readable name. Reusing a name on insert updates the row. */
    name: text('name').notNull().unique(),
    description: text('description').notNull(),
    /** Wall-clock time when the callback should fire. */
    fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
    /**
     * 'reply'              — post a fixed message into conversation_id
     * 'tool'               — call a registered site-tool directly (no LLM)
     * 'orchestrator-turn'  — re-engage conversation with a synthetic user message
     */
    kind: text('kind').notNull(),
    conversationId: text('conversation_id'),
    payload: jsonb('payload').notNull(),
    /** 'pending' | 'fired' | 'failed' | 'cancelled' */
    status: text('status').notNull().default('pending'),
    /** 'orchestrator' | 'system' | 'manual' */
    source: text('source').notNull().default('orchestrator'),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    error: text('error'),
    totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byFireAt: index('scheduled_callbacks_fire_at_idx').on(table.fireAt),
    byStatus: index('scheduled_callbacks_status_idx').on(table.status),
  }),
);

export type ScheduledCallback = typeof scheduledCallbacks.$inferSelect;
export type NewScheduledCallback = typeof scheduledCallbacks.$inferInsert;

// ── Integrations ────────────────────────────────────────────────────────

export const integrationCredentials = pgTable('integration_credentials', {
  id: text('id').primaryKey(), // uuid (caller-provided via crypto.randomUUID())
  integrationType: text('integration_type').notNull(),
  label: text('label').notNull(),
  kind: text('kind').notNull(), // 'apikey' | 'basic' | 'oauth2'
  // Encrypted JSON: format `${iv-hex}:${tag-hex}:${ciphertext-hex}` produced
  // by src/lib/integrations/crypto.ts. Shape of the decrypted JSON depends
  // on `kind` — see CredentialPayload<K> in src/lib/integrations/types.ts.
  payloadEnc: text('payload_enc').notNull(),
  // Non-secret config (e.g. CalDAV server URL, OAuth callback override).
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  // Health tracking — written by /api/integrations/test/[integrationType].
  lastTestedAt: timestamp('last_tested_at'),
  lastTestStatus: text('last_test_status'), // 'ok' | 'failed' | null
  lastTestError: text('last_test_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byType: index('integration_credentials_type_idx').on(t.integrationType),
}));

export const integrationOauthConfigs = pgTable('integration_oauth_configs', {
  integrationType: text('integration_type').primaryKey(),
  authorizationUrl: text('authorization_url').notNull(),
  tokenUrl: text('token_url').notNull(),
  defaultScopes: jsonb('default_scopes').$type<string[]>().notNull().default([]),
  clientIdEnvVar: text('client_id_env_var').notNull(),
  clientSecretEnvVar: text('client_secret_env_var').notNull(),
  // Used to construct the absolute callback URL when redirecting to the
  // provider. Defaults to env.PUBLIC_BASE_URL + the generic callback path.
  callbackUrlOverride: text('callback_url_override'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type IntegrationCredentialRow = typeof integrationCredentials.$inferSelect;
export type IntegrationOauthConfigRow = typeof integrationOauthConfigs.$inferSelect;

// ── API secret registry ──────────────────────────────────────────────────
//
// Credentials jkai can USE but never READ. An `api_catalog` entry references a
// secret by `handle`; the value is resolved server-side at call time and the
// plaintext is scrubbed from every response/error before it reaches the model.
//
// `allowedHosts` is the load-bearing security field and is OWNER-SET ONLY: a
// secret only ever authenticates a request whose URL host is on its own list.
// That is what makes the documented exfiltration path (a prompt-injected model
// registering `{baseUrl: attacker.example, auth: {handle: 'openrouter'}}`)
// structurally impossible rather than merely discouraged — see
// src/lib/secrets/registry.ts.
export const apiSecrets = pgTable('api_secrets', {
  id: text('id').primaryKey(), // uuid (caller-provided via crypto.randomUUID())
  /** Stable reference used by catalogue entries, e.g. 'openrouter'. */
  handle: text('handle').notNull(),
  label: text('label').notNull(),
  /**
   * 'vault' — value encrypted in `payload_enc` (this host's
   *   INTEGRATION_CREDENTIALS_KEY; NOTE the key differs per host, so vault
   *   secrets are per-environment and must be entered on each host).
   * 'ref'   — no copy stored; resolved from an existing server key source at
   *   call time (see REF_SOURCES in src/lib/secrets/registry.ts). Preferred for
   *   keys the site already owns, so there is no second copy to rotate.
   */
  source: text('source').notNull(), // 'vault' | 'ref'
  payloadEnc: text('payload_enc'), // vault only — `${iv}:${tag}:${ciphertext}`
  refKey: text('ref_key'), // ref only — a REF_SOURCES key
  /** How the value is attached: {kind:'bearer'} | {kind:'header',name} | {kind:'query',name}. */
  injection: jsonb('injection').$type<Record<string, unknown>>().notNull(),
  /** Owner-set host allow-list. Exact host or a `*.example.com` wildcard. */
  allowedHosts: jsonb('allowed_hosts').$type<string[]>().notNull().default([]),
  /** Optional owner-set least-privilege narrowing, e.g. ['/api/v1/credits']. Empty = any path. */
  allowedPathPrefixes: jsonb('allowed_path_prefixes').$type<string[]>().notNull().default([]),
  /**
   * Owner-set HTTP methods this credential may authenticate. Path narrowing
   * limits WHERE a key goes, never WHAT it does — without this, a credential
   * scoped to a read-only endpoint could still be sent with DELETE. Empty is
   * treated as ['GET','HEAD'], so a credential is read-only until the owner
   * says otherwise.
   */
  allowedMethods: jsonb('allowed_methods').$type<string[]>().notNull().default(['GET', 'HEAD']),
  /** Last 4 chars only, for UI identification. Never the value. */
  hint: text('hint'),
  notes: text('notes'),
  lastUsedAt: timestamp('last_used_at'),
  useCount: integer('use_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byHandle: uniqueIndex('api_secrets_handle_idx').on(t.handle),
}));

export type ApiSecretRow = typeof apiSecrets.$inferSelect;

// ── Hermes sessions ──────────────────────────────────────────────────────

export const hermesSessions = pgTable('hermes_sessions', {
  id: serial('id').primaryKey(),
  hermesSessionId: text('hermes_session_id').notNull(),
  kind: text('kind', { enum: ['build', 'canvas_chat', 'manual'] }).notNull(),
  kindId: text('kind_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => ({
  uniqueByKind: uniqueIndex('hermes_sessions_kind_kind_id_idx').on(t.kind, t.kindId).where(sql`closed_at IS NULL`),
}));

export type HermesSessionRow = typeof hermesSessions.$inferSelect;

// ── Hermes chat origin ───────────────────────────────────────────────────
// Records which SvelteKit host a given chat_id originated on so the
// homeserv-side `/api/mcp` routing proxy can forward tool calls back to
// the correct backend. Written on inbound by the jkai_platform plugin
// (Phase 3 of docs/superpowers/plans/2026-05-14-hermes-multi-origin-routing.md);
// read by `/api/mcp/+server.ts`.

export const hermesChatOrigin = pgTable('hermes_chat_origin', {
  chatId: text('chat_id').primaryKey(),
  origin: text('origin', { enum: ['vps', 'homeserv'] }).notNull(),
  mcpUrl: text('mcp_url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type HermesChatOriginRow = typeof hermesChatOrigin.$inferSelect;

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
});

// Forge triggers — cron-scheduled and autonomous (backlog-driven) git-target
// jkai builds against the brass-and-rails game repo. Mirrors the workflow
// scheduler pattern (croner Cron + leader-elected dispatcher). The forge
// scheduler reads `enabled` rows and registers one cron job per row.
export const forgeSchedules = pgTable('forge_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  cron: text('cron').notNull(),            // croner expression, e.g. '0 9 * * 1'
  directive: text('directive').notNull(),  // the prompt (scheduled) / note (autonomous)
  mode: text('mode').notNull().default('scheduled'), // 'scheduled' | 'autonomous'
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  lastBuildId: text('last_build_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type ForgeSchedule = typeof forgeSchedules.$inferSelect;
export type NewForgeSchedule = typeof forgeSchedules.$inferInsert;

// Policy-engine live-data observation layer. One authoritative row per tracked
// indicator per official reference period: what reality actually was, alongside
// the model's projected value for that year under BOTH the status-quo and the
// announced-policy scenarios, plus a freshness stamp. Written by the ingest route
// (driven by jkai cron workflows); read by the /monitor page. Mirrors the
// openrouter_models cached-external-data precedent (raw jsonb + fetchedAt).
export const policyIndicatorSnapshots = pgTable(
  'policy_indicator_snapshots',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    indicatorKey: text('indicator_key').notNull(),            // 'attainment8', 'persistentAbsence', …
    observedValue: numeric('observed_value', { precision: 14, scale: 4 }),
    unit: text('unit').notNull(),
    refYear: integer('ref_year').notNull(),                   // calendar year the value describes
    refPeriodLabel: text('ref_period_label'),                 // '2024/25', 'Jan–Mar 2026'
    source: text('source').notNull(),                         // 'DfE EES — KS4 performance'
    sourceUrl: text('source_url'),
    releaseDate: timestamp('release_date', { withTimezone: true }), // official publish date (EES lastPublished)
    releaseHash: text('release_hash'),                        // content hash for cheap change-detection
    projectedBaseline: numeric('projected_baseline', { precision: 14, scale: 4 }), // status-quo projection @ refYear
    projectedPolicy: numeric('projected_policy', { precision: 14, scale: 4 }),      // announced-policy projection @ refYear
    statusVsBaseline: text('status_vs_baseline').notNull().default('no-data'), // on-track | off-track | no-data
    statusVsPolicy: text('status_vs_policy').notNull().default('no-data'),
    provenanceNote: text('provenance_note'),                  // optional LLM-written one-liner about the release
    raw: jsonb('raw'),                                        // full upstream payload (audit)
    live: boolean('live').notNull().default(true),            // true = fetched, false = snapshot fallback
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('policy_indicator_snapshot_key_period_idx').on(t.indicatorKey, t.refYear)],
);

export type PolicyIndicatorSnapshot = typeof policyIndicatorSnapshots.$inferSelect;
export type NewPolicyIndicatorSnapshot = typeof policyIndicatorSnapshots.$inferInsert;

// --- Data Standard Designer: emerging-standards registry -------------------
// Discovered government data standards, surfaced in the project's portal. The
// discovery is index-driven (GOV.UK Search API etc.), deduped on canonicalId,
// with cheap change-detection via contentHash. LLM classification only sets
// kind/confidence/summary — never whether the row exists.
export const standardRegistryEntries = pgTable(
  'standard_registry_entries',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    canonicalId: text('canonical_id').notNull(), // stable key: sourceKey + upstream id/url
    title: text('title').notNull(),
    url: text('url').notNull(),
    sourceKey: text('source_key').notNull(), // govuk-search | data-gov-uk | github | manual
    sourceQuery: text('source_query'),
    publisher: text('publisher'),
    domain: text('domain'), // classified sector
    docType: text('doc_type'),
    summary: text('summary'),
    kind: text('kind'), // data-standard | data-dictionary | metadata | api-standard | identifier | guidance | other
    watch: text('watch'), // id of the named watch (e.g. 'cwsa') that surfaced this entry, if any
    confidence: text('confidence').notNull().default('medium'), // high | medium | low
    status: text('status').notNull().default('listed'), // listed | review | dismissed
    publishedAt: timestamp('published_at', { withTimezone: true }),
    contentHash: text('content_hash'),
    raw: jsonb('raw'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('standard_registry_canonical_idx').on(t.canonicalId)],
);
export type StandardRegistryEntry = typeof standardRegistryEntries.$inferSelect;
export type NewStandardRegistryEntry = typeof standardRegistryEntries.$inferInsert;

// Per-source run telemetry — the coverage-health signal. A source that
// normally returns N and suddenly returns 0 (or errors) shows up here, so a
// silently-broken feed is visible rather than mistaken for "nothing new".
export const standardRegistrySourceRuns = pgTable(
  'standard_registry_source_runs',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    sourceKey: text('source_key').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    ok: boolean('ok').notNull().default(true),
    itemsFound: integer('items_found').notNull().default(0),
    itemsNew: integer('items_new').notNull().default(0),
    totalAvailable: integer('total_available'), // upstream's reported total — coverage signal
    error: text('error'),
    durationMs: integer('duration_ms'),
  },
  (t) => [index('standard_registry_source_runs_key_idx').on(t.sourceKey, t.runAt)],
);
export type StandardRegistrySourceRun = typeof standardRegistrySourceRuns.$inferSelect;

// --- Keystone (DfE data-strategy workbench): intelligence radar -------------
// A daily sweep fetches new gov publications/news/policy (GOV.UK Search), then
// the LLM classifies each item AGAINST the strategy: how it influences which
// strategies/pressures, and any considerations / misalignments. Index-driven +
// deduped on canonicalId; classification enriches, never gates existence.
export const keystoneIntel = pgTable(
  'keystone_intel',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    canonicalId: text('canonical_id').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    source: text('source').notNull(), // govuk-search | ...
    sourceQuery: text('source_query'),
    publisher: text('publisher'),
    docType: text('doc_type'),
    summary: text('summary'),
    watch: text('watch'), // id of a named watch (e.g. 'cwsa') that surfaced this item, if any
    relevance: integer('relevance').notNull().default(0), // 0–5 relevance to the strategy
    influences: jsonb('influences'), // [{ kind:'strategy'|'pressure', id, how, direction }]
    considerations: jsonb('considerations'), // string[]
    misalignments: jsonb('misalignments'), // [{ point, severity }]
    status: text('status').notNull().default('new'), // new | classified | dismissed
    publishedAt: timestamp('published_at', { withTimezone: true }),
    contentHash: text('content_hash'),
    raw: jsonb('raw'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('keystone_intel_canonical_idx').on(t.canonicalId)],
);
export type KeystoneIntel = typeof keystoneIntel.$inferSelect;

export const keystoneIntelRuns = pgTable('keystone_intel_runs', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  ok: boolean('ok').notNull().default(true),
  itemsFound: integer('items_found').notNull().default(0),
  itemsNew: integer('items_new').notNull().default(0),
  classified: integer('classified').notNull().default(0),
  error: text('error'),
  durationMs: integer('duration_ms'),
});
export type KeystoneIntelRun = typeof keystoneIntelRuns.$inferSelect;

// --- Terminal Descent: spaceship-landing game leaderboard ------------------
// A single-use session (nonce) is issued when a run starts; at touchdown the
// client POSTs TELEMETRY (never a trusted score). The server recomputes the
// score from telemetry + difficulty (src/lib/space-lander/score.ts), validates
// plausibility, burns the nonce, then stores the row. Public read+write,
// whitelisted in src/lib/auth.ts. Routes: src/routes/api/space-lander/*.
export const spaceLanderSessions = pgTable(
  'space_lander_sessions',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    nonce: text('nonce').notNull(),
    difficulty: text('difficulty').notNull(),
    seed: text('seed'),
    ipHash: text('ip_hash'),
    used: boolean('used').notNull().default(false),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('space_lander_sessions_expires_idx').on(t.expiresAt)],
);
export type SpaceLanderSession = typeof spaceLanderSessions.$inferSelect;

export const spaceLanderScores = pgTable(
  'space_lander_scores',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(), // pilot handle (sanitised, ≤6 chars)
    score: integer('score').notNull(), // server-recomputed, authoritative
    tier: text('tier').notNull().default('safe'), // 'bullseye' | 'safe'
    difficulty: text('difficulty').notNull(), // 'cadet' | 'pilot' | 'ace'
    seed: text('seed'),
    // telemetry, native engine units (m/s, rad)
    vy: doublePrecision('vy').notNull(),
    vx: doublePrecision('vx').notNull(),
    tiltRad: doublePrecision('tilt_rad').notNull(),
    angVelMag: doublePrecision('ang_vel_mag').notNull().default(0),
    padOffset: doublePrecision('pad_offset').notNull(),
    fuelStart: doublePrecision('fuel_start').notNull(),
    fuelRemaining: doublePrecision('fuel_remaining').notNull(),
    tElapsed: doublePrecision('t_elapsed').notNull(),
    sessionId: text('session_id'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    flagged: boolean('flagged').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('space_lander_scores_diff_score_idx').on(t.difficulty, t.score),
    index('space_lander_scores_score_idx').on(t.score),
    // One score per session — DB-level defence against nonce double-spend.
    // sessionId is nullable; Postgres treats NULLs as distinct, so unranked
    // (session-less) rows are unaffected.
    uniqueIndex('space_lander_scores_session_idx').on(t.sessionId),
  ],
);
export type SpaceLanderScore = typeof spaceLanderScores.$inferSelect;
export type NewSpaceLanderScore = typeof spaceLanderScores.$inferInsert;

// ==========================================
// Claude Code Changelog — session + stage history
// (ingested from ~/.claude transcripts by scripts/claude-changelog)
// ==========================================

export const claudeSessions = pgTable(
  'claude_sessions',
  {
    id: text('id').primaryKey(), // Claude Code session UUID
    project: text('project').notNull().default('unknown'),
    title: text('title'),
    firstPrompt: text('first_prompt'),
    cwd: text('cwd'),
    gitBranch: text('git_branch'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    status: text('status').notNull().default('completed'), // 'active' | 'completed'
    messageCount: integer('message_count').notNull().default(0),
    userMsgCount: integer('user_msg_count').notNull().default(0),
    assistantMsgCount: integer('assistant_msg_count').notNull().default(0),
    toolCallCount: integer('tool_call_count').notNull().default(0),
    models: jsonb('models').notNull().default(sql`'[]'::jsonb`),
    tokens: jsonb('tokens').notNull().default(sql`'{}'::jsonb`), // {input,output,cacheRead,cacheCreation}
    estCostUsd: numeric('est_cost_usd', { precision: 12, scale: 4 }),
    costKnown: boolean('cost_known').notNull().default(true),
    featureTypes: jsonb('feature_types').notNull().default(sql`'[]'::jsonb`),
    termFreq: jsonb('term_freq').notNull().default(sql`'[]'::jsonb`), // [{term,count}]
    toolHistogram: jsonb('tool_histogram').notNull().default(sql`'{}'::jsonb`),
    touchedPaths: jsonb('touched_paths').notNull().default(sql`'[]'::jsonb`),
    skills: jsonb('skills').notNull().default(sql`'{}'::jsonb`),
    costBreakdown: jsonb('cost_breakdown').notNull().default(sql`'[]'::jsonb`), // per-model tokens×rate audit
    fullTranscript: text('full_transcript'), // rendered readable full conversation
    summary: text('summary'),
    aiSummary: text('ai_summary'), // optional LLM-written narrative (best-effort)
    transcriptPath: text('transcript_path'),
    contentHash: text('content_hash'), // sha256 of transcript — skip re-ingest if unchanged
    fileMtime: timestamp('file_mtime', { withTimezone: true }),
    fileSize: bigint('file_size', { mode: 'number' }),
    schemaVersion: integer('schema_version').notNull().default(1),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('claude_sessions_project_started_idx').on(t.project, t.startedAt),
    index('claude_sessions_started_idx').on(t.startedAt),
    index('claude_sessions_hash_idx').on(t.contentHash),
  ],
);
export type ClaudeSession = typeof claudeSessions.$inferSelect;
export type NewClaudeSession = typeof claudeSessions.$inferInsert;

export const claudeSessionStages = pgTable(
  'claude_session_stages',
  {
    id: serial('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => claudeSessions.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(), // 'request' | 'design' | 'plan' | 'result' | 'fixes'
    ordinal: integer('ordinal').notNull(),
    title: text('title'),
    summary: text('summary'),
    aiSummary: text('ai_summary'),
    rawText: text('raw_text'), // verbatim prompt / plan / action trace
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    tokens: jsonb('tokens').notNull().default(sql`'{}'::jsonb`),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }), // est. cost for this stage
    messageCount: integer('message_count').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`), // {skills:[],files:[]}
  },
  (t) => [
    uniqueIndex('claude_session_stages_session_ordinal_idx').on(t.sessionId, t.ordinal),
    index('claude_session_stages_stage_idx').on(t.stage),
    index('claude_session_stages_started_idx').on(t.startedAt),
  ],
);
export type ClaudeSessionStage = typeof claudeSessionStages.$inferSelect;
export type NewClaudeSessionStage = typeof claudeSessionStages.$inferInsert;

// ==========================================
// Release log — what actually went live
// ==========================================
//
// One row per production deploy, plus LLM-derived feature entries. Deliberately
// INDEPENDENT of claude_sessions: this answers "what shipped and when", not
// "who or what built it". A release is written by scripts/ci-deploy.sh AFTER the
// public-URL check passes, so a build that never reached production never
// appears here.
//
// Two provenances, distinguished by `via`:
//   'github-actions' — a real deploy. sha/prevSha are exactly what was swapped.
//   'backfill'       — reconstructed from git history for the era before this
//                      table existed. Boundaries are inferred (PR-squash commits
//                      are their own release; other commits cluster by time gap),
//                      so treat the timestamps as approximate.

export const releases = pgTable(
  'releases',
  {
    id: serial('id').primaryKey(),
    sha: text('sha').notNull(), // the commit that went live
    shortSha: text('short_sha').notNull(),
    prevSha: text('prev_sha'), // the commit it replaced; null = first release / repo root
    version: text('version').notNull(), // human label, YYYY.MM.DD.N
    branch: text('branch').notNull().default('master'),
    via: text('via').notNull().default('github-actions'), // 'github-actions' | 'manual' | 'backfill'
    deployedAt: timestamp('deployed_at', { withTimezone: true }).notNull(),
    builtAt: timestamp('built_at', { withTimezone: true }),
    // ── raw git facts (the evidence every summary must be grounded in) ──
    commits: jsonb('commits').notNull().default(sql`'[]'::jsonb`), // [{sha,short,author,date,subject,body,pr}]
    files: jsonb('files').notNull().default(sql`'[]'::jsonb`), // [{path,status,insertions,deletions}]
    stats: jsonb('stats').notNull().default(sql`'{}'::jsonb`), // {commits,files,insertions,deletions,prs:[]}
    // ── LLM-derived narrative ──
    title: text('title'),
    summary: text('summary'),
    kinds: jsonb('kinds').notNull().default(sql`'[]'::jsonb`), // distinct item kinds, denormalised for chips + filtering
    summaryStatus: text('summary_status').notNull().default('pending'), // 'pending' | 'ok' | 'failed'
    summaryError: text('summary_error'),
    summaryModel: text('summary_model'),
    summarisedAt: timestamp('summarised_at', { withTimezone: true }),
    contentHash: text('content_hash'), // sha256 of the git facts — re-ingest is a no-op when unchanged
    schemaVersion: integer('schema_version').notNull().default(1),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('releases_sha_idx').on(t.sha),
    index('releases_deployed_idx').on(t.deployedAt),
    index('releases_summary_status_idx').on(t.summaryStatus),
  ],
);
export type Release = typeof releases.$inferSelect;
export type NewRelease = typeof releases.$inferInsert;

/**
 * One shipped thing inside a release. The point of the table is `includes` /
 * `excludes`: what the change actually covers versus what a reader would
 * reasonably assume it covers but which was deferred or explicitly left out.
 * Both are grounded in the parent release's commits/files — never invented.
 */
export const releaseItems = pgTable(
  'release_items',
  {
    id: serial('id').primaryKey(),
    releaseId: integer('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    kind: text('kind').notNull(), // 'feature' | 'fix' | 'improvement' | 'infra' | 'content' | 'chore'
    impact: text('impact').notNull().default('internal'), // 'user-facing' | 'internal'
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    includes: jsonb('includes').notNull().default(sql`'[]'::jsonb`), // string[] — what IS in it
    excludes: jsonb('excludes').notNull().default(sql`'[]'::jsonb`), // string[] — what is NOT in it
    surfaces: jsonb('surfaces').notNull().default(sql`'[]'::jsonb`), // routes/services touched
    files: jsonb('files').notNull().default(sql`'[]'::jsonb`), // evidence: file paths
    commits: jsonb('commits').notNull().default(sql`'[]'::jsonb`), // evidence: short shas
    confidence: text('confidence').notNull().default('medium'), // 'low' | 'medium' | 'high'
  },
  (t) => [
    uniqueIndex('release_items_release_ordinal_idx').on(t.releaseId, t.ordinal),
    index('release_items_kind_idx').on(t.kind),
  ],
);
export type ReleaseItem = typeof releaseItems.$inferSelect;
export type NewReleaseItem = typeof releaseItems.$inferInsert;

// ==========================================
// Datastore — permanent, flexible, sitewide store
// ==========================================
//
// Three tables behind the single access layer `$lib/datastore/` (the only place
// permissions are enforced). Collections hold jsonb records with natural-key
// upsert, row-level capability-map permissions (precedent: workflow_files),
// optional JSON-Schema validation, TTL/expiry, optimistic `version`, and a
// before/after audit log that doubles as revision history. Feature-2 engine
// state dogfoods these tables via `isSystem` collections — no dedicated tables.

export const datastoreCollections = pgTable(
  'datastore_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name'),
    description: text('description'),
    schema: jsonb('schema'), // JSON-Schema subset, nullable = no validation
    defaultPermissions: jsonb('default_permissions'), // PermissionSet | null
    settings: jsonb('settings'), // { ttlSeconds?, maxRecords?, maxPayloadBytes? }
    isSystem: boolean('is_system').notNull().default(false),
    createdBy: text('created_by'), // actor string
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySlug: uniqueIndex('datastore_collections_slug_idx').on(t.slug),
  }),
);

export type DatastoreCollectionRow = typeof datastoreCollections.$inferSelect;
export type NewDatastoreCollectionRow = typeof datastoreCollections.$inferInsert;

export const datastoreRecords = pgTable(
  'datastore_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => datastoreCollections.id, { onDelete: 'cascade' }),
    key: text('key'), // natural key, nullable
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    permissions: jsonb('permissions'), // row-level PermissionSet override | null
    version: integer('version').notNull().default(1),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    // Partial unique index: a natural key is unique within a collection, but many
    // records may have no key (key IS NULL) — those are exempt from the constraint.
    byCollectionKey: uniqueIndex('datastore_records_collection_key_idx')
      .on(t.collectionId, t.key)
      .where(sql`key IS NOT NULL`),
    byCollectionUpdated: index('datastore_records_collection_updated_idx').on(
      t.collectionId,
      t.updatedAt,
    ),
  }),
);

export type DatastoreRecordRow = typeof datastoreRecords.$inferSelect;
export type NewDatastoreRecordRow = typeof datastoreRecords.$inferInsert;

export const datastoreAuditLog = pgTable(
  'datastore_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No FK on collection_id/record_id: audit rows must survive record/collection
    // deletion (the delete audit entry references a row that no longer exists).
    collectionId: uuid('collection_id'),
    recordId: uuid('record_id'),
    actor: text('actor').notNull(),
    // insert | update | delete | expire | permissions | collection_create |
    // collection_update | collection_delete
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCollectionCreated: index('datastore_audit_log_collection_created_idx').on(
      t.collectionId,
      t.createdAt,
    ),
  }),
);

export type DatastoreAuditLogRow = typeof datastoreAuditLog.$inferSelect;
export type NewDatastoreAuditLogRow = typeof datastoreAuditLog.$inferInsert;

// ==========================================
// Codegraph — the build-history knowledge graph
// ==========================================
//
// A SECOND graph, deliberately separate from `intel_*`. Intel is about the
// world (people, organisations, documents). This is about THIS CODEBASE and
// what building it has already taught us, and its only job is to put the right
// context in front of a pi build at the moment that build needs it.
//
// WHY THE NODES ARE FILES AND GATES, NOT SESSIONS
//
// Sessions end and their transcripts are deleted — 54 of 150 production
// sessions already have no `.jsonl` on disk. `src/lib/jkai/executor.ts`, by
// contrast, appears across the whole corpus and will be edited again next week.
// Code identity is the only durable key here, so files and gates are the nodes
// and the history (episodes, lessons) hangs off them.
//
// WHY RETRIEVAL IS NOT KEYED ON THE PROMPT
//
// 29% of John's real prompts are 25 characters or fewer. "crack on" embeds to
// nothing, so prose similarity cannot be the entry point. The two keys that
// ARE sharp are both extracted deterministically with regex and zero LLM calls:
//   1. the FILE SET a build is about to touch, and
//   2. the FINGERPRINT of the gate error it just hit — which orchestrator.ts
//      has already appended to the previous iteration's evaluation.
//
// WHY EVERY UNIT CARRIES AN OUTCOME
//
// 17.1% of merged PRs were themselves repairs of an earlier merge, so "it
// merged" is not "it was right". Ranking multiplies by a verdict tier, meaning
// retrieval returns what demonstrably worked rather than what merely reads
// similarly. Standard RAG has no notion of whether its chunk was ever correct.

/**
 * A durable thing in the codebase: a file, a directory, a gate, a route, a
 * table. `canonicalPath` is repo-relative and is the identity — never an
 * absolute path, because the same file is `/home/john/...` on homeserv and
 * `/home/jkai/workspace/<id>/dev/...` inside a build sandbox.
 */
export const codegraphNodes = pgTable(
  'codegraph_nodes',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    /** 'file' | 'dir' | 'gate' | 'route' | 'table' | 'tool' | 'skill' */
    kind: text('kind').notNull().default('file'),
    /** Repo-relative path, or the gate name for kind='gate'. Identity. */
    canonicalPath: text('canonical_path').notNull(),
    /** Which repo this belongs to — staleness resolves against THIS tree only. */
    repo: text('repo').notNull().default('SR-Main'),
    displayName: text('display_name'),
    /** Template-generated, never LLM-written. See the fabrication memory. */
    summary: text('summary'),
    embedding: vector('embedding'),
    /**
     * What KIND of file this is — 'api-endpoint', 'site-tool', 'test', … — a
     * pure function of the path (see codegraph/family.ts), stamped server-side
     * at ingest so no caller can disagree about it.
     *
     * Null is meaningful: a file with no family has no siblings, and a
     * catch-all would make every unclassified file a precedent for every other.
     */
    family: text('family'),
    episodeCount: integer('episode_count').notNull().default(0),
    lessonCount: integer('lesson_count').notNull().default(0),
    /**
     * Does this path still exist at git HEAD? A node whose file was deleted
     * cannot teach anything actionable. Refreshed by the sweep, and NEVER
     * trusted when the sentinel self-test fails — see codegraph/liveness.ts.
     */
    existsOnHead: boolean('exists_on_head').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Tombstone, mirroring intel's merge model. Never a magic string. */
    mergedIntoId: text('merged_into_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('codegraph_nodes_repo_path_idx').on(t.repo, t.canonicalPath),
    index('codegraph_nodes_kind_idx').on(t.kind),
    index('codegraph_nodes_merged_idx').on(t.mergedIntoId),
  ],
);
export type CodegraphNode = typeof codegraphNodes.$inferSelect;
export type NewCodegraphNode = typeof codegraphNodes.$inferInsert;

/**
 * A relation between two nodes. `co_change` is measured (they were edited in
 * the same session), `needs_context` is asserted (reading one required reading
 * the other). `weight` is the observation count, so a one-off pairing ranks
 * below a habit.
 */
export const codegraphEdges = pgTable(
  'codegraph_edges',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    sourceId: text('source_id')
      .notNull()
      .references(() => codegraphNodes.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => codegraphNodes.id, { onDelete: 'cascade' }),
    /**
     * 'imports'       — STATIC: this file imports that one. Exact, directional,
     *                   and available without any session history. The strongest
     *                   linkage in a codebase and the one the first cut missed
     *                   entirely, which is why half the graph was isolated.
     * 'tests'         — STATIC: a test file and its subject.
     * 'co_change'     — BEHAVIOURAL: edited in the same session. Symmetric, so
     *                   the pair is stored sorted to avoid two rows per pair.
     * 'needs_context' — BEHAVIOURAL: read before the other was edited.
     * 'gated_by' | 'fixed_by' — reserved.
     */
    kind: text('kind').notNull(),
    weight: integer('weight').notNull().default(1),
    /** Suppressed by a human in review — filtered by the one loader, not deleted. */
    suppressed: boolean('suppressed').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('codegraph_edges_triple_idx').on(t.sourceId, t.targetId, t.kind),
    index('codegraph_edges_source_idx').on(t.sourceId),
    index('codegraph_edges_target_idx').on(t.targetId),
  ],
);
export type CodegraphEdge = typeof codegraphEdges.$inferSelect;
export type NewCodegraphEdge = typeof codegraphEdges.$inferInsert;

/**
 * One recorded piece of work: something was attempted against some files, a
 * gate said something about it, and it either held or it did not.
 *
 * `fingerprint` is the hot lane — a normalised, ANSI-stripped error key such as
 * `tsc:TS2345` or `vitest:AssertionError`. Measured: agents almost never re-run
 * a byte-identical command (1 exact-command repeat across 25 sessions), so the
 * key must be the error class, not the command. Plain btree, sub-10ms.
 */
export const codegraphEpisodes = pgTable(
  'codegraph_episodes',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    repo: text('repo').notNull().default('SR-Main'),
    /**
     * Natural key, so re-ingesting the same transcript updates rather than
     * duplicates. Its absence was a real bug: nodes and lessons had natural
     * keys and episodes did not, so the first re-run of the backfill took the
     * corpus from 83 episodes to 166 — and a daily refresh cron would have
     * doubled it every night while every count on every surface kept rising.
     * Derived by the caller from (sourceId, fingerprint, files, occurredAt).
     */
    dedupeKey: text('dedupe_key'),
    /** Claude Code session id, or a jkai build id — provenance, not identity. */
    sourceKind: text('source_kind').notNull().default('session'),
    sourceId: text('source_id'),
    title: text('title'),
    /** What went wrong, verbatim-ish and trimmed. Never LLM-written. */
    problem: text('problem'),
    /** What was changed. Template-assembled from the recorded edits. */
    resolution: text('resolution'),
    /** How we know it worked — the command whose exit code changed. */
    verification: text('verification'),
    /** Normalised error key, e.g. 'tsc:TS2345'. Null when not gate-derived. */
    fingerprint: text('fingerprint'),
    /** 'svelte-check' | 'vitest' | 'build' | 'lint' | null */
    gate: text('gate'),
    /**
     * verified > landed > unverified > repaired > abandoned.
     * Ranking multiplies by this: 'merged' is not 'correct'.
     */
    verdict: text('verdict').notNull().default('unverified'),
    filesTouched: jsonb('files_touched').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    prNumber: integer('pr_number'),
    embedding: vector('embedding'),
    /** How often this episode has been SERVED, and how often it preceded a pass. */
    servedCount: integer('served_count').notNull().default(0),
    helpfulCount: integer('helpful_count').notNull().default(0),
    unhelpfulCount: integer('unhelpful_count').notNull().default(0),
    lastServedAt: timestamp('last_served_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Plain unique, NOT partial. Postgres already treats NULLs as distinct in a
    // unique index, so rows minted before this column existed coexist happily
    // without a predicate — and a PARTIAL index cannot serve as an ON CONFLICT
    // arbiter unless the statement repeats its exact WHERE clause, which made
    // every episode insert fail with a 500 the moment it shipped. The predicate
    // bought nothing and cost the whole ingest.
    uniqueIndex('codegraph_episodes_dedupe_idx').on(t.dedupeKey),
    index('codegraph_episodes_fingerprint_idx').on(t.fingerprint),
    index('codegraph_episodes_verdict_idx').on(t.verdict),
    index('codegraph_episodes_gate_idx').on(t.gate),
    index('codegraph_episodes_occurred_idx').on(t.occurredAt),
    index('codegraph_episodes_retired_idx').on(t.retiredAt),
  ],
);
export type CodegraphEpisode = typeof codegraphEpisodes.$inferSelect;
export type NewCodegraphEpisode = typeof codegraphEpisodes.$inferInsert;

/**
 * A durable rule about this codebase — "a new `scripts/` file needs its own
 * rsync line in ci-release.sh or it silently never ships".
 *
 * Seeded VERBATIM from the 272 hand-written `~/.claude/.../memory/*.md` notes,
 * which are the highest-quality knowledge body in the estate (median 2,919 B,
 * already claim-plus-consequence, 117 citing concrete `src/` paths) and which
 * jkai could not previously read a single byte of. No distillation pass: the
 * text is already better than anything an LLM would write over it, and
 * rewriting recorded facts is how fabrication gets in.
 */
export const codegraphLessons = pgTable(
  'codegraph_lessons',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    repo: text('repo').notNull().default('SR-Main'),
    slug: text('slug'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** 'memory-note' | 'session' | 'build' | 'manual' */
    origin: text('origin').notNull().default('memory-note'),
    originRef: text('origin_ref'),
    /** Repo-relative paths this lesson names. Drives staleness AND retrieval. */
    citedPaths: jsonb('cited_paths').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    embedding: vector('embedding'),
    servedCount: integer('served_count').notNull().default(0),
    /**
     * Outcome evidence — the input to `relevance.ts`.
     *
     * `helpful` and `unhelpful` are resolved MECHANICALLY from what the build
     * did next (did the fingerprint that triggered the retrieval recur?), never
     * by a model's judgement. A wrong "helpful" is indistinguishable from a real
     * one afterwards and would poison the ranking permanently, so an
     * unresolvable serve is left uncounted rather than guessed at — which is
     * why `served` is deliberately larger than `helpful + unhelpful`.
     */
    helpfulCount: integer('helpful_count').notNull().default(0),
    unhelpfulCount: integer('unhelpful_count').notNull().default(0),
    lastServedAt: timestamp('last_served_at', { withTimezone: true }),
    /**
     * Forgetting, three distinct states — conflating them is what makes a
     * "forget" button destructive:
     *   retiredAt   — no longer true, keep for provenance, never served
     *   supersededById — a REAL id, never a magic string (forget_memory's
     *                    literal 'forgotten' left 23 dangling rows)
     *   staleAt     — every path it cites is gone from its OWN repo
     */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    supersededById: text('superseded_by_id'),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('codegraph_lessons_repo_slug_idx').on(t.repo, t.slug),
    index('codegraph_lessons_retired_idx').on(t.retiredAt),
    index('codegraph_lessons_stale_idx').on(t.staleAt),
    index('codegraph_lessons_origin_idx').on(t.origin),
  ],
);
export type CodegraphLesson = typeof codegraphLessons.$inferSelect;
export type NewCodegraphLesson = typeof codegraphLessons.$inferInsert;

/**
 * Which lessons attach to which nodes. Composite PK, deliberately: the sibling
 * `intel_note_entities` shipped without one and silently accumulated duplicate
 * links until a repair run removed them.
 */
export const codegraphNodeLessons = pgTable(
  'codegraph_node_lessons',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => codegraphNodes.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => codegraphLessons.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.lessonId] }),
    index('codegraph_node_lessons_lesson_idx').on(t.lessonId),
  ],
);

/** Same, for episodes. */
export const codegraphNodeEpisodes = pgTable(
  'codegraph_node_episodes',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => codegraphNodes.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => codegraphEpisodes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.episodeId] }),
    index('codegraph_node_episodes_episode_idx').on(t.episodeId),
  ],
);

/**
 * Every serve, logged. This table is the whole reason we will be able to answer
 * "is it working?" honestly.
 *
 * The precedent is painful and exact: the builder's site-tool bridge logged
 * "Tool bridge OK — 167 site tools" for sixty days while every one of 5,214
 * production tool actions was a pi built-in and not one was a bridged call.
 * Self-reported health proved nothing; only SQL over recorded actions did. So
 * the retrieval path records what it served, to which build and iteration,
 * joinable to `jkai_iterations` — including the serves that returned NOTHING,
 * because a system that only logs its hits cannot be shown to be idle.
 */
export const codegraphQueries = pgTable(
  'codegraph_queries',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    /** 'push' | 'pull' | 'chat' — which channel asked. */
    channel: text('channel').notNull(),
    buildId: text('build_id'),
    iterationId: text('iteration_id'),
    /** The CGQL actually executed, verbatim, so a bad serve is reproducible. */
    query: text('query').notNull(),
    /** 'served' | 'empty' | 'failed' — empty and failed are NOT the same. */
    outcome: text('outcome').notNull(),
    episodeIds: jsonb('episode_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    lessonIds: jsonb('lesson_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    charsServed: integer('chars_served').notNull().default(0),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    /**
     * The fingerprints that CAUSED this retrieval. Kept so the serve can be
     * resolved later: if they recur in the next iteration's gate, what was
     * served did not address them.
     */
    servedFor: jsonb('served_for').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 'helpful' | 'unhelpful' | null while still unresolved. */
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('codegraph_queries_build_idx').on(t.buildId),
    index('codegraph_queries_resolution_idx').on(t.resolution),
    index('codegraph_queries_channel_idx').on(t.channel),
    index('codegraph_queries_outcome_idx').on(t.outcome),
    index('codegraph_queries_created_idx').on(t.createdAt),
  ],
);
export type CodegraphQuery = typeof codegraphQueries.$inferSelect;
export type NewCodegraphQuery = typeof codegraphQueries.$inferInsert;

// ── Daydreaming ──────────────────────────────────────────────────────────────
//
// A background state in which jkai looks at what it already knows — where you
// are, where you have been, how you slept, what is in your inbox and calendar —
// and asks whether anything is worth saying. Most ticks it says nothing.
//
// Three tables, and the split between them is the design:
//
//   daydream_trail   the sensor record. High volume, narrow, pruned.
//   daydream_places  what the trail's repeated stops MEAN. Named by you.
//   daydream_thoughts what was noticed, what was said, and how it landed.
//
// The detectors that read these are deliberately RULE-BASED (same argument as
// intel_insights above): a rule that fires on a measurable condition can be
// trusted, explained and tested. The model's job is phrasing a confirmed
// finding, never deciding there is one.

/**
 * One observation of where the subject was — or one record of having looked
 * and failed.
 *
 * **A gap is a row, not an absence of rows.** The push writer only fires on
 * GPS change, so standing still produces no pushes; if silence meant "no data"
 * the trail could not tell stillness from a dead sensor, and every "you have
 * not left the house in three days" would be a coin flip. So the poll floor
 * writes `source: 'poll'` when it gets a fix and `source: 'gap'` when it looked
 * and could not — and coverage over a window is then computable rather than
 * assumed. Home Assistant runs on homeserv while the site runs on the VPS, so
 * "could not" is a real, recurring state, not a theoretical one.
 */
export const daydreamTrail = pgTable(
  'daydream_trail',
  {
    id: serial('id').primaryKey(),
    /**
     * When the fix was OBSERVED. Distinct from `createdAt`, which is when the
     * row was written — a queued push can land minutes late, and everything
     * time-weighted has to read this one. Same lesson as intel_notes.observedAt.
     */
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    /** Whose fix. 'john' today; the column exists so a second subject never
     *  means a second table. Family members are presence-only by policy. */
    subject: text('subject').notNull().default('john'),
    /** 'push' | 'poll' | 'gap' — see the note above. */
    source: text('source').notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    accuracyM: doublePrecision('accuracy_m'),
    /** Home Assistant's own state string ('home', 'not_home', a zone name).
     *  HA's zone logic is authoritative for "am I home"; the radius check is
     *  only a fallback, exactly as the location-context node has it. */
    haState: text('ha_state'),
    isHome: boolean('is_home'),
    distanceHomeKm: doublePrecision('distance_home_km'),
    /** Derived from the PREVIOUS fix. Null when there is no usable previous
     *  fix, when the gap is too long to mean anything, or when the implied
     *  speed is physically absurd (a GPS jump, not a journey). */
    speedKmh: doublePrecision('speed_kmh'),
    /** 'still' | 'walking' | 'active' | 'vehicle' | 'rail' | 'unknown'.
     *  Deliberately coarse: GPS speed cannot separate running from cycling, so
     *  it does not pretend to. Advisory only — never stated to you as fact. */
    mode: text('mode').notNull().default('unknown'),
    placeId: text('place_id'),
    batteryPct: integer('battery_pct'),
    /** Age of the underlying HA reading at write time. A fresh row carrying a
     *  two-hour-old reading is not a fresh observation. */
    readingAgeS: integer('reading_age_s'),
    /** Why a gap row exists — the error, verbatim, so a silent trail is
     *  diagnosable after the fact rather than merely noticeable. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('daydream_trail_ts_idx').on(t.ts),
    index('daydream_trail_subject_ts_idx').on(t.subject, t.ts),
    index('daydream_trail_place_idx').on(t.placeId),
    index('daydream_trail_source_idx').on(t.source),
  ],
);

export type DaydreamTrailRow = typeof daydreamTrail.$inferSelect;
export type NewDaydreamTrailRow = typeof daydreamTrail.$inferInsert;

/**
 * A place the trail keeps returning to.
 *
 * Clusters are cheap; MEANING is not. A centroid with four visits is a fact
 * about coordinates and says nothing useful — it becomes useful the moment it
 * has a name, and the only reliable source of that name is you. So the whole
 * point of this table is `source: 'confirmed'`: an unnamed frequent place
 * raises a question, your answer is written to jkai_memories under the
 * existing `places` category, and the memory id is recorded here so the two
 * can never drift apart.
 */
export const daydreamPlaces = pgTable(
  'daydream_places',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    /** Derived from member spread, floored at the clustering radius. */
    radiusM: doublePrecision('radius_m').notNull(),
    /** Null until named. A null label is the trigger for asking. */
    label: text('label'),
    /** 'home' | 'school' | 'work' | 'shop' | 'cafe' | 'gym' | 'other' | 'unknown' */
    kind: text('kind').notNull().default('unknown'),
    /**
     * 'confirmed' — you said so. Quotable back to you as fact.
     * 'geocoded'  — Nominatim reverse lookup. Good for a street, weak for a shop.
     * 'inferred'  — pattern only. Never stated as fact, only ever as a question.
     */
    source: text('source').notNull().default('inferred'),
    /** The jkai_memories row written when you confirmed this place. */
    memoryId: text('memory_id'),
    /**
     * What the reverse geocoder thinks this place is called, precomputed so the
     * naming form opens already filled in.
     *
     * Deliberately NOT `label`. Writing a guess into `label` would collapse the
     * confirmed > geocoded > inferred ladder above: everything downstream treats
     * a non-null label as "the owner said so", and seven detectors gate on
     * exactly that. A suggestion is scaffolding for a human answer, never a
     * substitute for one, so it lives in its own columns and only a tap ever
     * promotes it into `label`.
     */
    suggestedLabel: text('suggested_label'),
    suggestedKind: text('suggested_kind'),
    suggestedAddress: text('suggested_address'),
    suggestedAt: timestamp('suggested_at', { withTimezone: true }),
    visitCount: integer('visit_count').notNull().default(0),
    medianDwellMins: integer('median_dwell_mins').notNull().default(0),
    /** Visit counts by weekday (7) and by local hour (24) — a cheap rhythm
     *  summary, so "usually Tuesday afternoon" costs no query. */
    dayHistogram: jsonb('day_histogram').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    hourHistogram: jsonb('hour_histogram').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /**
     * 'active' | 'ignored' | 'merged'. `ignored` is you saying "stop asking
     * about this one" — a place-level mute that survives re-clustering, which
     * a dismissed thought alone would not.
     */
    status: text('status').notNull().default('active'),
    mergedIntoId: text('merged_into_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('daydream_places_status_idx').on(t.status),
    index('daydream_places_kind_idx').on(t.kind),
    index('daydream_places_label_idx').on(t.label),
  ],
);

/**
 * One row per local day, per subject — the table that makes a cross-domain
 * correlation computable at all.
 *
 * Nothing in this database previously put health, movement and activity on a
 * common key. 472,072 Apple rows, 1,138 activities and 9,313 trail fixes exist,
 * in four different time formats (a x100 integer with an offset string, a unix
 * epoch, an ISO string with a Z, and a timestamptz) and two different scaling
 * conventions — one of which, strain, is applied inconsistently within its own
 * column. Asking "does poor sleep track shop visits?" was not gated, it was
 * unanswerable.
 *
 * Two rules govern every column here:
 *
 *   EVERY FEATURE IS NULLABLE. A day with no reading stores null, never zero.
 *   Zero is a measurement; absent is not. Conflating them is how "you took no
 *   steps on Sunday" gets said about a day the phone was flat, and it is the
 *   single fastest way to manufacture a correlation out of an outage.
 *
 *   COVERAGE TRAVELS WITH THE NUMBERS. `sources` records, per domain, whether
 *   that day was actually observed. A statistical test can then exclude a day
 *   it cannot see rather than treating it as a data point.
 *
 * Derived and disposable: every value is recomputed from the source tables, so
 * this can be dropped and rebuilt. It is a cache with opinions, not a record.
 */
export const daydreamDayFeatures = pgTable(
  'daydream_day_features',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    subject: text('subject').notNull().default('john'),
    /** LOCAL calendar day (Europe/London), never UTC. A rhythm is a local fact
     *  and a UTC day boundary puts half of every evening on the wrong date. */
    day: date('day').notNull(),

    // ── Movement, from the trail. No coordinates, ever. ──
    trailFixes: integer('trail_fixes'),
    trailCoverage: doublePrecision('trail_coverage'),
    placesVisited: integer('places_visited'),
    distinctPlaces: integer('distinct_places'),
    minutesAtHome: integer('minutes_at_home'),
    minutesOut: integer('minutes_out'),
    firstOutAtMins: integer('first_out_at_mins'),
    lastHomeAtMins: integer('last_home_at_mins'),

    // ── Health. Normalised in features/normalise.ts, never inline. ──
    steps: integer('steps'),
    activeEnergyKj: doublePrecision('active_energy_kj'),
    meanHeartRate: doublePrecision('mean_heart_rate'),
    hrvMs: doublePrecision('hrv_ms'),
    restingHeartRate: doublePrecision('resting_heart_rate'),
    recoveryScore: doublePrecision('recovery_score'),
    strain: doublePrecision('strain'),
    sleepMinutes: doublePrecision('sleep_minutes'),
    sleepPerformance: doublePrecision('sleep_performance'),
    sleepEfficiency: doublePrecision('sleep_efficiency'),
    disturbanceCount: integer('disturbance_count'),

    // ── Deliberate activity. ──
    workouts: integer('workouts'),
    activeMinutes: doublePrecision('active_minutes'),
    activityDistanceM: doublePrecision('activity_distance_m'),

    // ── Diary. ──
    calendarEvents: integer('calendar_events'),
    calendarBusyMinutes: integer('calendar_busy_minutes'),

    /**
     * Per-domain observation state: 'ok' | 'partial' | 'absent'.
     *
     * The difference between "he did not go out" and "we could not see" — which
     * is the entire reason the coverage gate exists elsewhere in this feature,
     * and would be thrown away by a bare feature vector.
     */
    sources: jsonb('sources').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daydream_day_features_subject_day_idx').on(t.subject, t.day),
    index('daydream_day_features_day_idx').on(t.day),
  ],
);

/**
 * Questions the assistant decided were worth asking, and what the data said.
 *
 * The point of the table is the rows nobody would keep. `refuted`,
 * `wrong_direction` and `underpowered` are stored exactly as durably as
 * `supported`, because a system that keeps only its hits looks prescient and is
 * unfalsifiable. "I checked whether shop visits track poor sleep; they do not,
 * r = 0.06" is a useful thing to read, and until this table existed there was
 * nowhere in this codebase for it to live.
 *
 * `proposedAt` is recorded separately from `testedAt` and always precedes it.
 * That ordering is the pre-registration guarantee: the model proposed this
 * claim without seeing a p-value, so the correction applies over the handful it
 * asked for rather than the several hundred an exhaustive sweep runs. A row
 * where the two are equal, or where the verdict was written by anything other
 * than `judge()`, has lost that property.
 */
export const daydreamHypotheses = pgTable(
  'daydream_hypotheses',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    subject: text('subject').notNull().default('john'),
    /** Stable identity, so the same question is not asked twice. */
    hypothesisKey: text('hypothesis_key').notNull(),

    metricA: text('metric_a').notNull(),
    metricB: text('metric_b').notNull(),
    lagDays: integer('lag_days').notNull().default(0),
    /** 'positive' | 'negative' | 'either' — stated BEFORE the test, so a
     *  contradicting result is a refutation rather than a shrug. */
    direction: text('direction').notNull(),

    /** The model's words. Never rendered as fact, only as a question asked. */
    question: text('question').notNull(),
    rationale: text('rationale').notNull(),

    /** 'supported' | 'refuted' | 'wrong_direction' | 'underpowered' | null. */
    verdict: text('verdict'),
    /** Deterministic, from judge(). A model never writes this. */
    summary: text('summary'),
    r: doublePrecision('r'),
    pValue: doublePrecision('p_value'),
    qValue: doublePrecision('q_value'),
    pairs: integer('pairs'),
    /** m — how many tests the correction ran over. Without it the q-value on
     *  this row cannot be interpreted, or audited later. */
    familySize: integer('family_size'),
    fdr: doublePrecision('fdr'),

    /** Model tokens spent proposing. Codex reports no price, so this is the
     *  only honest cost figure. */
    proposalTokens: integer('proposal_tokens').notNull().default(0),

    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
    testedAt: timestamp('tested_at', { withTimezone: true }),
    /** Retested periodically as the window fills — an underpowered question
     *  becomes answerable, and a supported one can stop holding. */
    lastRetestedAt: timestamp('last_retested_at', { withTimezone: true }),
    retestCount: integer('retest_count').notNull().default(0),

    /** Owner verdict on the QUESTION, not the statistics: was this worth
     *  asking? That is the signal that shapes what gets proposed next. */
    feedback: text('feedback'),
    feedbackAt: timestamp('feedback_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('daydream_hypotheses_subject_key_idx').on(t.subject, t.hypothesisKey),
    index('daydream_hypotheses_verdict_idx').on(t.verdict),
    index('daydream_hypotheses_proposed_idx').on(t.proposedAt),
  ],
);

/**
 * Things John has asked it to look into.
 *
 * The only owner-authored text this engine could previously read was a place
 * name. There was no way to say "look at what I'm spending at weekends", and
 * so no way for his priorities to reach a system whose entire job is deciding
 * what he'd find interesting.
 *
 * A steer REORDERS work. It grants no new access whatsoever: the proposer still
 * sees only the metric catalogue, and a steer becomes at most a sentence of
 * emphasis in its prompt. That boundary is deliberate and load-bearing — free
 * text from a chat box that could widen what a model may read is an injection
 * surface, and this one cannot, by construction.
 */
export const daydreamSteers = pgTable(
  'daydream_steers',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    subject: text('subject').notNull().default('john'),
    /** What he typed, verbatim. Rendered back to him; never executed. */
    text: text('text').notNull(),
    /** 'active' | 'done' | 'dropped'. */
    status: text('status').notNull().default('active'),
    /** How many proposal batches have been run under this steer, so one that
     *  has shaped a fortnight of questions and produced nothing is visible. */
    batchesInfluenced: integer('batches_influenced').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('daydream_steers_status_idx').on(t.status)],
);

export type DaydreamSteer = typeof daydreamSteers.$inferSelect;

/**
 * One card a morning: everything it thought yesterday, including the quiet parts.
 *
 * This is what decouples THINKING volume from TALKING volume. `budget.ts`
 * already declares that spare budget buys thinking and never talking, but that
 * was aspirational: a fifty-fold rise in thinking produced fifty times more
 * rows nobody read, because the only way anything reached him was an
 * interruption capped at four a day.
 *
 * A digest is not an interruption. It is a place for quiet output to land, and
 * it reports the nothing as well as the something — a morning that says "18
 * tests, nothing survived, 3 questions still short of data" is an honest and
 * useful morning, and a digest that only appears when there is news is a digest
 * that cannot be trusted when it is silent.
 */
export const daydreamDigests = pgTable(
  'daydream_digests',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    subject: text('subject').notNull().default('john'),
    /** Local day the digest covers. */
    day: date('day').notNull(),
    /** Deterministic summary, assembled from counts. Always present. */
    summary: text('summary').notNull(),
    /** Optional model phrasing over the same counts. Never the only record. */
    narrative: text('narrative'),
    /** Did anything check the narrative? Same three states as a thought. */
    verified: boolean('verified'),
    /** Every number the summary quotes, so none of them is unexplained. */
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daydream_digests_subject_day_idx').on(t.subject, t.day),
    index('daydream_digests_day_idx').on(t.day),
  ],
);

/**
 * Money actually spent, as far as the mailbox can tell.
 *
 * This table is deliberately narrow, and the reason is worth stating because
 * the obvious version of this feature is a trap. 605 email notes contain a
 * currency amount — and an audit of them found the overwhelming majority are
 * ADVERTISED prices, not payments: "Price reduced by £34.30", "Luxury Escapes
 * From £879pp", "Up to 12 months at 0%". A spend series built from "emails
 * mentioning money" would track how much marketing John receives, and it would
 * correlate beautifully with things, and every word of it would be false.
 *
 * So only genuinely receipt-shaped mail is admitted, and the extracted amount
 * must appear verbatim in the source text before the row is written. At the
 * time of building that is 34 messages over eight weeks — about four a week.
 *
 * That density is why `daydream_spend` is NOT wired into the sweep metrics.
 * Four points a week is nulls on most days, and every question asked of it
 * would come back underpowered at best and spurious at worst. It accumulates
 * first and earns its way in later; `spendDensity()` reports how close it is,
 * so the decision is a number on a page rather than an opinion.
 *
 * It will always understate. No cash, no card-present spend without an emailed
 * receipt, and nothing from a merchant who does not email. Anything reading
 * this table must say so.
 */
export const daydreamSpend = pgTable(
  'daydream_spend',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    subject: text('subject').notNull().default('john'),
    /** The intel_notes row this came from. The provenance, and the dedupe key. */
    sourceNoteId: text('source_note_id').notNull(),
    merchant: text('merchant').notNull(),
    /** Minor units (pence), integer — never a float. Money in floating point is
     *  a rounding error waiting to be summed. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('GBP'),
    /** LOCAL day of the purchase, for joining against day features later. */
    day: date('day').notNull(),
    /** The exact substring the amount was read from. Stored so a wrong figure
     *  can be traced to the text that produced it rather than argued about. */
    evidence: text('evidence').notNull(),
    /** Did the amount actually appear in the source? Written by code, never by
     *  a model. A false here means the row is quarantined, not quoted. */
    verified: boolean('verified').notNull().default(false),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daydream_spend_note_idx').on(t.sourceNoteId),
    index('daydream_spend_day_idx').on(t.day),
    index('daydream_spend_merchant_idx').on(t.merchant),
  ],
);

/**
 * A durable queue of things the assistant is still chewing on.
 *
 * The difference from a hypothesis: a hypothesis is one testable claim,
 * proposed and answered in a single tick and then finished. A LEAD is a line of
 * enquiry that outlives a tick — "sleep and going out seem tangled up, work out
 * how" — which spawns hypotheses, accumulates evidence across days, and is
 * eventually either paid off or abandoned.
 *
 * `score` is what makes a frontier rather than a list. It is recomputed from
 * the lead's own results — how many of its hypotheses held, how many came back
 * empty — so effort follows what is paying off, and a line that has produced
 * nothing for several rounds falls to the bottom on its own arithmetic rather
 * than on a constant somebody chose.
 *
 * NOTE ON THE THRESHOLDS: `abandonAfterBarrenRounds` and the score weights are
 * deliberately stored per-row and left at conservative defaults rather than
 * tuned. The whole point of this table is to stop constants deciding what is
 * interesting, and tuning them before the hypothesis engine has produced a
 * month of real verdicts would be inventing exactly the numbers this feature
 * exists to replace. They are set from measured behaviour, not guessed.
 */
export const daydreamLeads = pgTable(
  'daydream_leads',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    subject: text('subject').notNull().default('john'),
    /** Stable identity so the same line of enquiry is not opened twice. */
    leadKey: text('lead_key').notNull(),
    /** What it is trying to find out, in John's terms. */
    title: text('title').notNull(),
    /** The model's reasoning for opening it. Never rendered as fact. */
    rationale: text('rationale').notNull(),
    /** Metric names this lead is allowed to range over — its own allow-list,
     *  narrower than the global one, so a lead cannot quietly become a sweep. */
    metrics: jsonb('metrics').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    /** 'open' | 'paid_off' | 'abandoned' | 'parked'. */
    status: text('status').notNull().default('open'),
    /** Recomputed each round from this lead's own results. */
    score: doublePrecision('score').notNull().default(0.5),
    /** Every input to `score`, named. Never show an unexplained number. */
    scoreComponents: jsonb('score_components').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),

    roundsRun: integer('rounds_run').notNull().default(0),
    /** Consecutive rounds that produced no supported hypothesis. */
    barrenRounds: integer('barren_rounds').notNull().default(0),
    hypothesesSpawned: integer('hypotheses_spawned').notNull().default(0),
    hypothesesHeld: integer('hypotheses_held').notNull().default(0),

    /** Per-row so it can be tuned from evidence later without a migration. */
    abandonAfterBarrenRounds: integer('abandon_after_barren_rounds').notNull().default(4),

    /** Owner steer that opened this, when one did. */
    steerId: text('steer_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastRoundAt: timestamp('last_round_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('daydream_leads_subject_key_idx').on(t.subject, t.leadKey),
    index('daydream_leads_status_score_idx').on(t.status, t.score),
  ],
);

export type DaydreamLead = typeof daydreamLeads.$inferSelect;

/**
 * One step of thinking, kept.
 *
 * The reviewable trace. Without it "the model explored during idle time" is an
 * unfalsifiable claim and a token bill; with it there is a record of what it
 * looked at, what it decided, and what that cost — which is the only way an
 * exploration loop can be audited rather than trusted.
 *
 * Deliberately append-only and pruned by age, not by interest. Keeping only
 * the steps that led somewhere would make the trace agree with the conclusion.
 */
export const daydreamLeadSteps = pgTable(
  'daydream_lead_steps',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    leadId: text('lead_id').notNull(),
    round: integer('round').notNull(),
    /** 'plan' | 'spawn' | 'read' | 'judge' | 'prune'. */
    kind: text('kind').notNull(),
    /** What happened, in one deterministic line. */
    note: text('note').notNull(),
    /** Structured detail — hypothesis ids, verdicts, the numbers behind a
     *  pruning decision. */
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    tokens: integer('tokens').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('daydream_lead_steps_lead_idx').on(t.leadId, t.round),
    index('daydream_lead_steps_created_idx').on(t.createdAt),
  ],
);

export type DaydreamLeadStep = typeof daydreamLeadSteps.$inferSelect;

export type DaydreamSpend = typeof daydreamSpend.$inferSelect;

export type DaydreamDigest = typeof daydreamDigests.$inferSelect;

export type DaydreamHypothesis = typeof daydreamHypotheses.$inferSelect;
export type NewDaydreamHypothesis = typeof daydreamHypotheses.$inferInsert;

export type DaydreamDayFeature = typeof daydreamDayFeatures.$inferSelect;
export type NewDaydreamDayFeature = typeof daydreamDayFeatures.$inferInsert;

export type DaydreamPlace = typeof daydreamPlaces.$inferSelect;
export type NewDaydreamPlace = typeof daydreamPlaces.$inferInsert;

/**
 * One daydream: what was noticed, what was said about it, and how it landed.
 *
 * Modelled on intel_insights, for the same reason that table exists — a
 * finding that is recomputed per request cannot be dismissed, cannot be
 * snoozed, and has no yesterday to compare against. `dedupeKey` is the
 * identity that survives recomputation.
 *
 * Rows land here whether or not they were ever delivered, INCLUDING the ones
 * suppressed by rate limits or a learned weight, with the reason. A ledger
 * that only records what got through cannot answer the one question worth
 * asking of this feature: is it any good?
 */
export const daydreamThoughts = pgTable(
  'daydream_thoughts',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** Deterministic, rule-generated. Always present, even when the model
     *  never ran — so a thought is explainable without an LLM call. */
    explanation: text('explanation').notNull(),
    /** Optional model phrasing, applied to survivors only. Never required. */
    narrative: text('narrative'),
    /**
     * Did the verify pass actually rule on `narrative`?
     *
     * Three states, and the third is the one that matters. `null` means no
     * model prose exists. `true` means a second pass checked every claim
     * against the FACTS block and let it through. `false` means prose exists
     * that NOTHING checked — which already happens today, because
     * DEPTH_PLANS.minimal sets verify:false and compose returns early with the
     * narrative populated. Until this column existed there was no way to tell
     * the two apart on the page, so unchecked prose read exactly like checked
     * prose. The headline promotion gates on `true`, never on "narrative is
     * non-null".
     */
    verified: boolean('verified'),
    /** Why the phrasing was thrown away, when it was — "no usable evidence",
     *  "verify failed: …", or the model's own SKIP. Rendered on the ledger, so
     *  a composer that has started refusing everything is visible rather than
     *  looking like a quiet week. */
    narrativeDroppedReason: text('narrative_dropped_reason'),
    /**
     * What the phrasing actually cost, in tokens.
     *
     * Tokens rather than only money, because the daydream model is pinned to
     * Codex, where price is NULL on every row — a pounds-only meter reads
     * 0.000000 whatever the work was, which is exactly the state this feature
     * shipped in. `costUsd` below stays, and stays honest at zero for a model
     * that bills nothing; these are the numbers that move.
     */
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    score: doublePrecision('score').notNull().default(0),
    /** Every component of `score`. Rule: never show an unexplained number. */
    components: jsonb('components').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** Typed references to what this rests on — trail ids, place ids, email
     *  ids, memory ids, calendar uids. The composer may fetch ONLY these. */
    evidence: jsonb('evidence').$type<Array<{ kind: string; id: string; note?: string }>>().notNull().default(sql`'[]'::jsonb`),
    placeId: text('place_id'),
    dedupeKey: text('dedupe_key').notNull(),
    /** new | delivered | seen | dismissed | actioned | snoozed | suppressed */
    status: text('status').notNull().default('new'),
    /** Why it never went out: 'below_threshold', 'rate_limited',
     *  'quiet_hours', 'kind_muted', 'evidence_unverified'. */
    suppressedReason: text('suppressed_reason'),
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
    proposedActions: jsonb('proposed_actions')
      .$type<Array<{ kind: string; label: string; payload: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 'push' | 'chat' | 'silent' — one channel per thought, never two. */
    channel: text('channel'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    /** 'useful' | 'not_useful' | 'never_kind'. `never_kind` is an immediate,
     *  absolute mute — not a down-weight. With push as the default channel it
     *  is the escape hatch, so no statistics stand between you and silence. */
    feedback: text('feedback'),
    /**
     * Where the verdict came from. 'explicit' | 'triage' | 'action'.
     *
     * The reason this column exists rather than a second boolean: `confirmPlace`
     * has always refused to record naming a place as feedback, on the correct
     * grounds that quietly manufacturing an upvote would inflate a kind's score
     * with something the owner never said. But that left the strongest evidence
     * the feature has ever produced — he named five places, which is the exact
     * act the whole thing exists to elicit — recorded nowhere at all, while the
     * threshold sat pinned at its ceiling waiting for 25 responses it had no way
     * to get.
     *
     * Both concerns are real, and they are answerable at once by keeping the
     * provenance instead of throwing the signal away. An action counts, at a
     * discount, and says on the page that it was inferred rather than said.
     */
    feedbackSource: text('feedback_source'),
    feedbackNote: text('feedback_note'),
    /**
     * How many detect ticks have re-proposed this exact thing.
     *
     * `persistCandidates` updates a suppressed row in place every ten minutes,
     * which is right — a candidate is one standing proposal, not 144 a day —
     * but it meant the page could not tell a thing noticed once from a thing
     * that has been almost-said forty times and never cleared the bar. That
     * distinction is the whole basis for deciding what to triage first.
     */
    recurrenceCount: integer('recurrence_count').notNull().default(1),
    feedbackAt: timestamp('feedback_at', { withTimezone: true }),
    runId: text('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daydream_thoughts_dedupe_idx').on(t.dedupeKey),
    index('daydream_thoughts_status_idx').on(t.status),
    index('daydream_thoughts_kind_idx').on(t.kind),
    index('daydream_thoughts_created_idx').on(t.createdAt),
    index('daydream_thoughts_feedback_idx').on(t.feedback),
  ],
);

export type DaydreamThought = typeof daydreamThoughts.$inferSelect;
export type NewDaydreamThought = typeof daydreamThoughts.$inferInsert;

/**
 * Offers extracted from bulk email, so "you have a voucher for this shop" is a
 * fact rather than a guess.
 *
 * Two-stage by design. A free, rule-based filter over subject lines picks the
 * shortlist — 1,073 bulk emails in ninety days is far too many to hand a model,
 * and most of them are newsletters. Only the shortlist is extracted, and that
 * extraction spends against the same Codex caps as everything else here.
 *
 * `expiresAt` is the column that matters most. An EXPIRED voucher is worse than
 * no voucher: it sends you into a shop for nothing. Null means the email did
 * not state a date, which is a different thing from "does not expire" and is
 * scored lower rather than assumed generous.
 */
export const daydreamOffers = pgTable(
  'daydream_offers',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    /** The BRAND, as a person would say it — "Sports Direct", not
     *  "email.sportsdirect.com". It has to match a place label to be useful. */
    merchant: text('merchant').notNull(),
    /** One line, as it would be read back. */
    summary: text('summary').notNull(),
    /** Discount code, when the email carried one. */
    code: text('code'),
    /** Null when the email stated no date — NOT a synonym for "no expiry". */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** 'high' | 'medium' | 'low' — the extractor's own confidence. Anything
     *  below high is never used to interrupt, only to fill the page. */
    confidence: text('confidence').notNull().default('medium'),
    /** The intel note this came from, so a thought can cite it. */
    noteId: text('note_id'),
    /** Deep link back to the message in Gmail. */
    sourceUrl: text('source_url'),
    senderDomain: text('sender_domain'),
    /** merchant + code + expiry day. Stops the same voucher landing twice when
     *  a merchant re-sends it, which they all do. */
    dedupeKey: text('dedupe_key').notNull(),
    /** 'active' | 'expired' | 'dismissed' */
    status: text('status').notNull().default('active'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daydream_offers_dedupe_idx').on(t.dedupeKey),
    index('daydream_offers_status_idx').on(t.status),
    index('daydream_offers_merchant_idx').on(t.merchant),
    index('daydream_offers_expires_idx').on(t.expiresAt),
  ],
);

export type DaydreamOffer = typeof daydreamOffers.$inferSelect;
export type NewDaydreamOffer = typeof daydreamOffers.$inferInsert;

/**
 * Rules a model proposed, and what happened to them.
 *
 * The mesh between rules-driven and model-driven: the model authors the RULE,
 * deterministic code evaluates it. `spec` is a validated expression tree over a
 * fixed allow-list of scalar facts — never code, never `eval`, and never able
 * to name anything the fact extractor did not put in front of it.
 *
 * Nothing here fires until `status = 'active'`, and only the owner moves a rule
 * there. A proposal that survives validation and backtesting is still only a
 * proposal; the self-improvement engine auto-enables what it builds, and that
 * is defensible for a tool nobody is interrupted by. This one buzzes a phone.
 */
export const daydreamRules = pgTable(
  'daydream_rules',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    /** Becomes the thought `kind`, so it is also the mute key and the weight key. */
    kind: text('kind').notNull(),
    /** The validated RuleSpec. See $lib/daydream/rules/spec.ts. */
    spec: jsonb('spec').$type<Record<string, unknown>>().notNull(),
    /** 'proposed' | 'active' | 'rejected' | 'deprecated' */
    status: text('status').notNull().default('proposed'),
    /** Why the model proposed it, in its own words. Shown to the owner when
     *  approving; never shown to the composer, which must work from evidence. */
    rationale: text('rationale').notNull().default(''),
    /** 'new' | 'tweak' | 'deprecate' — what the model was doing. */
    proposalKind: text('proposal_kind').notNull().default('new'),
    /** For a tweak or a deprecation, the rule it is about. */
    supersedesId: text('supersedes_id'),

    // ── Backtest ──
    /** How many times it would have fired over the replayed window. */
    backtestFires: integer('backtest_fires'),
    backtestDays: integer('backtest_days'),
    /**
     * True when the replay could not reconstruct every fact the rule uses, so
     * the firing count is a LOWER BOUND. Such a rule can never be auto-anything
     * — an under-estimate is the dangerous direction for a noise check.
     */
    backtestLowerBound: boolean('backtest_lower_bound').notNull().default(false),
    backtestNote: text('backtest_note'),

    // ── Outcome, once live ──
    firedCount: integer('fired_count').notNull().default(0),
    usefulCount: integer('useful_count').notNull().default(0),
    notUsefulCount: integer('not_useful_count').notNull().default(0),

    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daydream_rules_kind_idx').on(t.kind),
    index('daydream_rules_status_idx').on(t.status),
  ],
);

export type DaydreamRule = typeof daydreamRules.$inferSelect;
export type NewDaydreamRule = typeof daydreamRules.$inferInsert;
