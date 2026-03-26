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
  jsonb,
  customType,
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

// ==========================================
// Biome Config
// ==========================================

export const biomeConfig = pgTable('biome_config', {
  id: serial('id').primaryKey(),
  settings: text('settings').notNull(), // JSON blob
  updatedAt: timestamp('updated_at').defaultNow(),
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
  noveltyScore: doublePrecision('novelty_score'),
  sourceAgreement: integer('source_agreement'),
});

export type Fact = typeof facts.$inferSelect;

export const entities = pgTable('entity', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  description: text('description'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
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
  costUsd: doublePrecision('cost_usd'),
  provider: text('provider'),
  model: text('model'),
  status: text('status').default('completed'), // pending | running | completed | failed
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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

export const jkaiBuilds = pgTable('jkai_builds', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title'),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('pending'),
  budgetConfig: jsonb('budget_config').notNull().default(sql`'{}'::jsonb`),
  tokensUsed: integer('tokens_used').notNull().default(0),
  iterationsCompleted: integer('iterations_completed').notNull().default(0),
  activeMinutesUsed: doublePrecision('active_minutes_used').notNull().default(0),
  serveConfig: jsonb('serve_config'),
  publishedSlug: text('published_slug'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiBuild = typeof jkaiBuilds.$inferSelect;
export type NewJkaiBuild = typeof jkaiBuilds.$inferInsert;

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
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
