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
  index,
  jsonb,
  numeric,
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
  contentFormat: text('content_format').default('html').notNull(),
  previewToken: text('preview_token').$defaultFn(() => crypto.randomUUID()),
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
  modelProvider: text('model_provider').notNull().default('zai'),
  modelId: text('model_id').notNull().default('glm-5-turbo'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  priceSnapshot: jsonb('price_snapshot').$type<{ promptPrice: number; completionPrice: number } | null>(),
  failure: jsonb('failure'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  enforceDesignSystem: boolean('enforce_design_system').notNull().default(true),
  planStatus: text('plan_status').notNull().default('approved'),
  milestones: jsonb('milestones').$type<Array<{ id: string; title: string; done: boolean; iter?: number }>>().notNull().default(sql`'[]'::jsonb`),
  requireIterationApproval: boolean('require_iteration_approval').notNull().default(false),
  thinkingLevel: text('thinking_level').notNull().default('medium'),
  enabledToolsets: jsonb('enabled_toolsets').$type<string[]>().notNull().default(sql`'["all"]'::jsonb`),
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

// ==========================================
// CDO 100-Day Plan
// ==========================================

export const cdoPlans = pgTable('cdo_plans', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  version: integer('version').notNull().default(1),
  title: text('title').notNull().default('First 100 Days — DfE CDO'),
  structure: jsonb('structure'),
  previousPlanId: text('previous_plan_id'),
  changelog: jsonb('changelog'),
  status: text('status').notNull().default('draft'), // draft | synthesizing | complete | failed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CdoPlan = typeof cdoPlans.$inferSelect;
export type NewCdoPlan = typeof cdoPlans.$inferInsert;

// ==========================================
// Workflows — Visual Automation Engine
// ==========================================

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull(),
  description: text('description'),
  trigger: jsonb('trigger').default(sql`'{"type":"manual"}'::jsonb`),
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
  modelProvider: text('model_provider').notNull().default('zai'),
  modelId: text('model_id').notNull().default('glm-5.1'),
  promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
  completionTokens: bigint('completion_tokens', { mode: 'number' }).notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  priceSnapshot: jsonb('price_snapshot').$type<{ promptPrice: number; completionPrice: number } | null>(),
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
});

export type OrchestratorChat = typeof orchestratorChats.$inferSelect;
export type NewOrchestratorChat = typeof orchestratorChats.$inferInsert;

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
  raw: jsonb('raw').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── JKAI Intel: Knowledge Graph ─────────────────────────────────────

export const intelEntityTypes = pgTable('intel_entity_types', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull().unique(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelNote = typeof intelNotes.$inferSelect;
export type NewIntelNote = typeof intelNotes.$inferInsert;

export const intelEntities = pgTable('intel_entities', {
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
});

export type IntelEntity = typeof intelEntities.$inferSelect;
export type NewIntelEntity = typeof intelEntities.$inferInsert;

export const intelRelationships = pgTable('intel_relationships', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sourceEntityId: text('source_entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
  targetEntityId: text('target_entity_id').notNull().references(() => intelEntities.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  label: text('label'),
  strength: text('strength').notNull().default('moderate'),
  properties: jsonb('properties').$type<Record<string, unknown>>(),
  confidence: text('confidence').notNull().default('medium'),
  sourceNoteId: text('source_note_id').references(() => intelNotes.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IntelRelationship = typeof intelRelationships.$inferSelect;

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueName: uniqueIndex('workflow_files_name_idx').on(table.name),
  }),
);

export type WorkflowFile = typeof workflowFiles.$inferSelect;
export type NewWorkflowFile = typeof workflowFiles.$inferInsert;

export type WorkflowFilePermissions = {
  read: boolean;
  write: boolean;
  append: boolean;
  delete: boolean;
};
