import { pgTable, text, jsonb, timestamp, foreignKey, boolean, uniqueIndex, serial, integer, unique, bigint, numeric, index, doublePrecision, vector } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const integrations = pgTable("integrations", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	baseUrl: text("base_url"),
	authType: text("auth_type").default('none').notNull(),
	authConfig: jsonb("auth_config").default({}),
	operations: jsonb().default([]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const workflowSchedules = pgTable("workflow_schedules", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	type: text().notNull(),
	config: jsonb().default({}).notNull(),
	enabled: boolean().default(true).notNull(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflows.id],
			name: "workflow_schedules_workflow_id_workflows_id_fk"
		}).onDelete("cascade"),
]);

export const appleHealthMetrics = pgTable("apple_health_metrics", {
	id: serial().primaryKey().notNull(),
	metricName: text("metric_name").notNull(),
	date: integer().notNull(),
	dateLocal: text("date_local").notNull(),
	value: integer(),
	minValue: integer("min_value"),
	maxValue: integer("max_value"),
	units: text().notNull(),
	syncedAt: integer("synced_at").default(sql`(EXTRACT(epoch FROM now()))`),
}, (table) => [
	uniqueIndex("idx_apple_health_metric_date").using("btree", table.metricName.asc().nullsLast().op("int4_ops"), table.date.asc().nullsLast().op("int4_ops")),
]);

export const workflowRuns = pgTable("workflow_runs", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	status: text().default('pending').notNull(),
	trigger: text().default('manual').notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	error: text(),
	healingHistory: jsonb("healing_history").default([]),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflows.id],
			name: "workflow_runs_workflow_id_workflows_id_fk"
		}),
]);

export const nodeExecutions = pgTable("node_executions", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	runId: text("run_id").notNull(),
	nodeId: text("node_id").notNull(),
	status: text().default('pending').notNull(),
	inputData: jsonb("input_data"),
	outputData: jsonb("output_data"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	error: text(),
	logs: jsonb().default([]),
}, (table) => [
	foreignKey({
			columns: [table.runId],
			foreignColumns: [workflowRuns.id],
			name: "node_executions_run_id_workflow_runs_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.nodeId],
			foreignColumns: [workflowNodes.id],
			name: "node_executions_node_id_workflow_nodes_id_fk"
		}).onDelete("cascade"),
]);

export const workflowNodes = pgTable("workflow_nodes", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	type: text().notNull(),
	position: jsonb().default({"x":0,"y":0}).notNull(),
	config: jsonb().default({}).notNull(),
	label: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflows.id],
			name: "workflow_nodes_workflow_id_workflows_id_fk"
		}).onDelete("cascade"),
]);

export const workflows = pgTable("workflows", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	trigger: jsonb().default({"type":"manual"}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const workflowEdges = pgTable("workflow_edges", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	sourceNodeId: text("source_node_id").notNull(),
	targetNodeId: text("target_node_id").notNull(),
	sourceHandle: text("source_handle"),
	targetHandle: text("target_handle"),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflows.id],
			name: "workflow_edges_workflow_id_workflows_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sourceNodeId],
			foreignColumns: [workflowNodes.id],
			name: "workflow_edges_source_node_id_workflow_nodes_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.targetNodeId],
			foreignColumns: [workflowNodes.id],
			name: "workflow_edges_target_node_id_workflow_nodes_id_fk"
		}).onDelete("cascade"),
]);

export const whatsappConfig = pgTable("whatsapp_config", {
	id: text().default('default').primaryKey().notNull(),
	enabled: boolean().default(false).notNull(),
	allowedNumbers: jsonb("allowed_numbers").default([]).notNull(),
	soulMd: text("soul_md").default(').notNull(),
	authDir: text("auth_dir").default('data/whatsapp-auth').notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const orchestratorChats = pgTable("orchestrator_chats", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	workflowId: text("workflow_id"),
	role: text().notNull(),
	content: text().notNull(),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	conversationId: text("conversation_id"),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflows.id],
			name: "orchestrator_chats_workflow_id_workflows_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [jkaiConversations.id],
			name: "orchestrator_chats_conversation_id_fkey"
		}).onDelete("cascade"),
]);

export const blogPostTags = pgTable("blog_post_tags", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	tag: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [blogPosts.id],
			name: "blog_post_tags_post_id_blog_posts_id_fk"
		}).onDelete("cascade"),
]);

export const whatsappConversations = pgTable("whatsapp_conversations", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	phoneNumber: text("phone_number").notNull(),
	role: text().notNull(),
	content: text().notNull(),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const workflowDataStore = pgTable("workflow_data_store", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	key: text().notNull(),
	value: jsonb(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("workflow_data_store_workflow_key_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.key.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflows.id],
			name: "workflow_data_store_workflow_id_workflows_id_fk"
		}).onDelete("cascade"),
]);

export const homeAssistantConfig = pgTable("home_assistant_config", {
	id: text().default('default').primaryKey().notNull(),
	url: text().default('http://localhost:8123').notNull(),
	token: text().default(').notNull(),
	entityRegistry: jsonb("entity_registry").default([]).notNull(),
	deviceRegistry: jsonb("device_registry").default([]).notNull(),
	areaRegistry: jsonb("area_registry").default([]).notNull(),
	lastSynced: timestamp("last_synced", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const promptCache = pgTable("prompt_cache", {
	id: text().default('default').primaryKey().notNull(),
	compiledPrompt: text("compiled_prompt").default(').notNull(),
	fileManifest: jsonb("file_manifest").default([]).notNull(),
	lastSynced: timestamp("last_synced", { withTimezone: true, mode: 'string' }),
});

export const conversations = pgTable("conversations", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	title: text(),
	source: text().default('web').notNull(),
	whatsappPhoneNumber: text("whatsapp_phone_number"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const healthSyncState = pgTable("health_sync_state", {
	id: serial().primaryKey().notNull(),
	service: text().notNull(),
	lastSyncAt: integer("last_sync_at").notNull(),
	lastSuccessfulSyncAt: integer("last_successful_sync_at"),
	status: text().default('idle').notNull(),
	errorMessage: text("error_message"),
	recordsSynced: integer("records_synced").default(0),
}, (table) => [
	unique("health_sync_state_service_unique").on(table.service),
]);

export const jkaiConversations = pgTable("jkai_conversations", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	title: text(),
	source: text().default('web').notNull(),
	whatsappPhoneNumber: text("whatsapp_phone_number"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastMemoryReview: timestamp("last_memory_review", { withTimezone: true, mode: 'string' }),
	modelProvider: text("model_provider").default('zai').notNull(),
	modelId: text("model_id").default('glm-5.1').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	promptTokens: bigint("prompt_tokens", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	completionTokens: bigint("completion_tokens", { mode: "number" }).default(0).notNull(),
	costUsd: numeric("cost_usd", { precision: 12, scale:  6 }).default('0').notNull(),
	priceSnapshot: jsonb("price_snapshot"),
});

export const oauthTokens = pgTable("oauth_tokens", {
	id: serial().primaryKey().notNull(),
	service: text().notNull(),
	refreshToken: text("refresh_token").notNull(),
	accessToken: text("access_token"),
	expiresAt: integer("expires_at"),
	createdAt: integer("created_at").default(sql`(EXTRACT(epoch FROM now()))`),
	updatedAt: integer("updated_at").default(sql`(EXTRACT(epoch FROM now()))`),
});

export const customTools = pgTable("custom_tools", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	name: text().notNull(),
	description: text().notNull(),
	toolset: text().notNull(),
	parameters: jsonb().default({"type":"object","properties":{}}).notNull(),
	handlerCode: text("handler_code").notNull(),
	enabled: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("custom_tools_name_key").on(table.name),
]);

export const jkaiMemories = pgTable("jkai_memories", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	category: text().notNull(),
	content: text().notNull(),
	sourceConversationId: text("source_conversation_id"),
	confidence: text().default('high').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	supersededBy: text("superseded_by"),
});

export const quickAnswer = pgTable("quick_answer", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	topic: text().notNull(),
	goals: jsonb().default([]).notNull(),
	status: text().default('pending').notNull(),
	answer: text(),
	sources: jsonb().default([]).notNull(),
	queries: jsonb().default([]).notNull(),
	errorMessage: text("error_message"),
	tokensUsed: integer("tokens_used"),
	durationMs: integer("duration_ms"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
});

export const appSettings = pgTable("app_settings", {
	key: text().primaryKey().notNull(),
	value: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const stravaActivities = pgTable("strava_activities", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	type: text().notNull(),
	sportType: text("sport_type").notNull(),
	startDate: integer("start_date").notNull(),
	startDateLocal: text("start_date_local").notNull(),
	timezone: text().notNull(),
	distance: integer().notNull(),
	movingTime: integer("moving_time").notNull(),
	elapsedTime: integer("elapsed_time").notNull(),
	totalElevationGain: integer("total_elevation_gain").notNull(),
	averageSpeed: integer("average_speed").notNull(),
	maxSpeed: integer("max_speed").notNull(),
	averageHeartrate: integer("average_heartrate"),
	maxHeartrate: integer("max_heartrate"),
	calories: integer(),
	sufferScore: integer("suffer_score"),
	mapData: text("map_data"),
	startLatlng: text("start_latlng"),
	endLatlng: text("end_latlng"),
	syncedAt: integer("synced_at").default(sql`(EXTRACT(epoch FROM now()))`),
});

export const openrouterModels = pgTable("openrouter_models", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	contextLength: integer("context_length"),
	promptPrice: numeric("prompt_price", { precision: 20, scale:  12 }),
	completionPrice: numeric("completion_price", { precision: 20, scale:  12 }),
	imagePrice: numeric("image_price", { precision: 20, scale:  12 }),
	modality: text(),
	provider: text(),
	raw: jsonb().notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("openrouter_models_modality_idx").using("btree", table.modality.asc().nullsLast().op("text_ops")),
	index("openrouter_models_provider_idx").using("btree", table.provider.asc().nullsLast().op("text_ops")),
]);

export const whoopCycles = pgTable("whoop_cycles", {
	id: text().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	startDate: integer("start_date").notNull(),
	endDate: integer("end_date").notNull(),
	startDateLocal: text("start_date_local").notNull(),
	timezone: text().notNull(),
	strain: doublePrecision().notNull(),
	kilojoule: doublePrecision().notNull(),
	averageHeartrate: integer("average_heartrate").notNull(),
	maxHeartrate: integer("max_heartrate").notNull(),
	syncedAt: integer("synced_at").default(sql`(EXTRACT(epoch FROM now()))`),
});

export const whoopRecovery = pgTable("whoop_recovery", {
	id: serial().primaryKey().notNull(),
	cycleId: text("cycle_id").notNull(),
	sleepId: text("sleep_id").notNull(),
	userId: integer("user_id").notNull(),
	createdDate: integer("created_date").notNull(),
	recoveryScore: doublePrecision("recovery_score").notNull(),
	restingHeartRate: doublePrecision("resting_heart_rate").notNull(),
	hrvRmssd: doublePrecision("hrv_rmssd").notNull(),
	spo2: doublePrecision(),
	skinTemp: integer("skin_temp"),
	syncedAt: integer("synced_at").default(sql`(EXTRACT(epoch FROM now()))`),
}, (table) => [
	unique("whoop_recovery_cycle_id_unique").on(table.cycleId),
]);

export const whoopSleep = pgTable("whoop_sleep", {
	id: text().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	startDate: integer("start_date").notNull(),
	endDate: integer("end_date").notNull(),
	startDateLocal: text("start_date_local").notNull(),
	nap: boolean().notNull(),
	totalInBed: integer("total_in_bed").notNull(),
	totalAwake: integer("total_awake").notNull(),
	totalLight: integer("total_light").notNull(),
	totalSlowWave: integer("total_slow_wave").notNull(),
	totalRem: integer("total_rem").notNull(),
	sleepCycleCount: integer("sleep_cycle_count").notNull(),
	disturbanceCount: integer("disturbance_count").notNull(),
	baselineNeed: integer("baseline_need").notNull(),
	needFromDebt: integer("need_from_debt").notNull(),
	needFromStrain: integer("need_from_strain").notNull(),
	needFromNap: integer("need_from_nap").notNull(),
	respiratoryRate: doublePrecision("respiratory_rate").notNull(),
	sleepPerformance: doublePrecision("sleep_performance").notNull(),
	sleepConsistency: doublePrecision("sleep_consistency").notNull(),
	sleepEfficiency: doublePrecision("sleep_efficiency").notNull(),
	syncedAt: integer("synced_at").default(sql`(EXTRACT(epoch FROM now()))`),
});

export const whoopWorkouts = pgTable("whoop_workouts", {
	id: text().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	startDate: integer("start_date").notNull(),
	endDate: integer("end_date").notNull(),
	startDateLocal: text("start_date_local").notNull(),
	timezone: text().notNull(),
	sportId: integer("sport_id").notNull(),
	sportName: text("sport_name"),
	strain: doublePrecision().notNull(),
	averageHeartrate: integer("average_heartrate").notNull(),
	maxHeartrate: integer("max_heartrate").notNull(),
	kilojoule: doublePrecision().notNull(),
	distanceMeters: doublePrecision("distance_meters"),
	altitudeGainMeters: doublePrecision("altitude_gain_meters"),
	zoneZero: integer("zone_zero").notNull(),
	zoneOne: integer("zone_one").notNull(),
	zoneTwo: integer("zone_two").notNull(),
	zoneThree: integer("zone_three").notNull(),
	zoneFour: integer("zone_four").notNull(),
	zoneFive: integer("zone_five").notNull(),
	syncedAt: integer("synced_at").default(sql`(EXTRACT(epoch FROM now()))`),
});

export const jkaiAttachments = pgTable("jkai_attachments", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	conversationId: text("conversation_id"),
	messageId: text("message_id"),
	source: text().notNull(),
	kind: text().notNull(),
	mimeType: text("mime_type").notNull(),
	originalName: text("original_name"),
	sizeBytes: integer("size_bytes").notNull(),
	diskPath: text("disk_path").notNull(),
	duration: doublePrecision(),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("jkai_attachments_conversation_idx").using("btree", table.conversationId.asc().nullsLast().op("text_ops")),
	index("jkai_attachments_message_idx").using("btree", table.messageId.asc().nullsLast().op("text_ops")),
	index("jkai_attachments_orphan_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(message_id IS NULL)`),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [jkaiConversations.id],
			name: "jkai_attachments_conversation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [orchestratorChats.id],
			name: "jkai_attachments_message_id_fkey"
		}).onDelete("set null"),
]);

export const blogPosts = pgTable("blog_posts", {
	id: serial().primaryKey().notNull(),
	slug: text().notNull(),
	title: text().notNull(),
	excerpt: text().notNull(),
	content: text().notNull(),
	coverImageUrl: text("cover_image_url"),
	status: text().default('draft').notNull(),
	publishedAt: timestamp("published_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
	contentFormat: text("content_format").default('html').notNull(),
	previewToken: text("preview_token"),
}, (table) => [
	unique("blog_posts_slug_unique").on(table.slug),
]);

export const biomeConfig = pgTable("biome_config", {
	id: serial().primaryKey().notNull(),
	settings: text().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const researchSession = pgTable("research_session", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	topic: text().notNull(),
	goals: jsonb().default([]).notNull(),
	status: text().default('draft').notNull(),
	timeLimitMinutes: integer("time_limit_minutes"),
	config: jsonb().default({}).notNull(),
	report: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	shareToken: text("share_token"),
	parentSessionId: text("parent_session_id"),
	seedContext: jsonb("seed_context"),
}, (table) => [
	unique("research_session_share_token_unique").on(table.shareToken),
]);

export const entity = pgTable("entity", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	sessionId: text("session_id").notNull(),
	name: text().notNull(),
	type: text().notNull(),
	description: text(),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [researchSession.id],
			name: "entity_session_id_research_session_id_fk"
		}),
]);

export const source = pgTable("source", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	sessionId: text("session_id").notNull(),
	url: text().notNull(),
	title: text(),
	snippet: text(),
	domain: text(),
	category: text(),
	phase: integer().notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	credibilityScore: doublePrecision("credibility_score"),
	credibilityType: text("credibility_type"),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [researchSession.id],
			name: "source_session_id_research_session_id_fk"
		}),
]);

export const entityMention = pgTable("entity_mention", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	entityId: text("entity_id").notNull(),
	factId: text("fact_id").notNull(),
	context: text(),
}, (table) => [
	foreignKey({
			columns: [table.entityId],
			foreignColumns: [entity.id],
			name: "entity_mention_entity_id_entity_id_fk"
		}),
	foreignKey({
			columns: [table.factId],
			foreignColumns: [fact.id],
			name: "entity_mention_fact_id_fact_id_fk"
		}),
]);

export const fact = pgTable("fact", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	sessionId: text("session_id").notNull(),
	sourceId: text("source_id").notNull(),
	content: text().notNull(),
	eventDate: timestamp("event_date", { withTimezone: true, mode: 'string' }),
	discoveredAt: timestamp("discovered_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	confidence: doublePrecision().default(0.5).notNull(),
	isCounterfactual: boolean("is_counterfactual").default(false).notNull(),
	refutesFactId: text("refutes_fact_id"),
	tags: jsonb().default([]).notNull(),
	embedding: vector({ dimensions: 1536 }),
	noveltyScore: doublePrecision("novelty_score"),
	sourceAgreement: integer("source_agreement"),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [researchSession.id],
			name: "fact_session_id_research_session_id_fk"
		}),
	foreignKey({
			columns: [table.sourceId],
			foreignColumns: [source.id],
			name: "fact_source_id_source_id_fk"
		}),
	foreignKey({
			columns: [table.refutesFactId],
			foreignColumns: [table.id],
			name: "fact_refutes_fact_id_fact_id_fk"
		}),
]);

export const relationship = pgTable("relationship", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	sessionId: text("session_id").notNull(),
	fromEntityId: text("from_entity_id"),
	toEntityId: text("to_entity_id"),
	fromFactId: text("from_fact_id"),
	toFactId: text("to_fact_id"),
	relationshipType: text("relationship_type").notNull(),
	sentiment: text().notNull(),
	strength: doublePrecision().default(0.5).notNull(),
	sourceId: text("source_id"),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [researchSession.id],
			name: "relationship_session_id_research_session_id_fk"
		}),
	foreignKey({
			columns: [table.fromEntityId],
			foreignColumns: [entity.id],
			name: "relationship_from_entity_id_entity_id_fk"
		}),
	foreignKey({
			columns: [table.toEntityId],
			foreignColumns: [entity.id],
			name: "relationship_to_entity_id_entity_id_fk"
		}),
	foreignKey({
			columns: [table.fromFactId],
			foreignColumns: [fact.id],
			name: "relationship_from_fact_id_fact_id_fk"
		}),
	foreignKey({
			columns: [table.toFactId],
			foreignColumns: [fact.id],
			name: "relationship_to_fact_id_fact_id_fk"
		}),
	foreignKey({
			columns: [table.sourceId],
			foreignColumns: [source.id],
			name: "relationship_source_id_source_id_fk"
		}),
]);

export const narrativeItem = pgTable("narrative_item", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	sessionId: text("session_id").notNull(),
	factId: text("fact_id"),
	sortOrder: integer("sort_order").notNull(),
	annotation: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [researchSession.id],
			name: "narrative_item_session_id_research_session_id_fk"
		}),
	foreignKey({
			columns: [table.factId],
			foreignColumns: [fact.id],
			name: "narrative_item_fact_id_fact_id_fk"
		}),
]);

export const globalEntity = pgTable("global_entity", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	canonicalName: text("canonical_name").notNull(),
	type: text().notNull(),
	description: text(),
	embedding: vector({ dimensions: 1536 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const globalEntityLink = pgTable("global_entity_link", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	globalEntityId: text("global_entity_id").notNull(),
	sessionEntityId: text("session_entity_id").notNull(),
	sessionId: text("session_id").notNull(),
	confidence: doublePrecision().default(0.8).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.globalEntityId],
			foreignColumns: [globalEntity.id],
			name: "global_entity_link_global_entity_id_global_entity_id_fk"
		}),
	foreignKey({
			columns: [table.sessionEntityId],
			foreignColumns: [entity.id],
			name: "global_entity_link_session_entity_id_entity_id_fk"
		}),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [researchSession.id],
			name: "global_entity_link_session_id_research_session_id_fk"
		}),
]);

export const agentTasks = pgTable("agent_tasks", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	title: text().notNull(),
	description: text(),
	status: text().default('pending').notNull(),
	priority: integer().default(0),
	originChannel: text("origin_channel"),
	originSender: text("origin_sender"),
	steps: jsonb().default([]),
	currentStep: integer("current_step").default(0),
	result: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
});

export const agentActions = pgTable("agent_actions", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	taskId: text("task_id"),
	sessionId: text("session_id"),
	actionType: text("action_type").notNull(),
	toolName: text("tool_name"),
	input: jsonb(),
	output: jsonb(),
	reasoning: text(),
	durationMs: integer("duration_ms"),
	tokensInput: integer("tokens_input"),
	tokensOutput: integer("tokens_output"),
	costUsd: doublePrecision("cost_usd"),
	provider: text(),
	model: text(),
	status: text().default('completed'),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [agentTasks.id],
			name: "agent_actions_task_id_agent_tasks_id_fk"
		}).onDelete("set null"),
]);

export const agentActivity = pgTable("agent_activity", {
	id: serial().primaryKey().notNull(),
	actionId: text("action_id"),
	taskId: text("task_id"),
	eventType: text("event_type").notNull(),
	summary: text().notNull(),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.actionId],
			foreignColumns: [agentActions.id],
			name: "agent_activity_action_id_agent_actions_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [agentTasks.id],
			name: "agent_activity_task_id_agent_tasks_id_fk"
		}).onDelete("set null"),
]);

export const agentSettings = pgTable("agent_settings", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const jkaiIterations = pgTable("jkai_iterations", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	buildId: text("build_id").notNull(),
	number: integer().notNull(),
	status: text().default('running').notNull(),
	goals: text(),
	plan: text(),
	actions: jsonb().default([]).notNull(),
	messages: jsonb().default([]).notNull(),
	evaluation: text(),
	nextSteps: text("next_steps"),
	tokensUsed: integer("tokens_used").default(0).notNull(),
	durationMs: integer("duration_ms"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.buildId],
			foreignColumns: [jkaiBuilds.id],
			name: "jkai_iterations_build_id_jkai_builds_id_fk"
		}).onDelete("cascade"),
]);

export const jkaiLogs = pgTable("jkai_logs", {
	id: serial().primaryKey().notNull(),
	buildId: text("build_id").notNull(),
	iterationId: text("iteration_id"),
	type: text().notNull(),
	content: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.buildId],
			foreignColumns: [jkaiBuilds.id],
			name: "jkai_logs_build_id_jkai_builds_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.iterationId],
			foreignColumns: [jkaiIterations.id],
			name: "jkai_logs_iteration_id_jkai_iterations_id_fk"
		}).onDelete("set null"),
]);

export const jkaiBuilds = pgTable("jkai_builds", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	title: text(),
	prompt: text().notNull(),
	status: text().default('pending').notNull(),
	budgetConfig: jsonb("budget_config").default({}).notNull(),
	tokensUsed: integer("tokens_used").default(0).notNull(),
	iterationsCompleted: integer("iterations_completed").default(0).notNull(),
	activeMinutesUsed: doublePrecision("active_minutes_used").default(0).notNull(),
	serveConfig: jsonb("serve_config"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	publishedSlug: text("published_slug"),
	modelProvider: text("model_provider").default('zai').notNull(),
	modelId: text("model_id").default('glm-5.1').notNull(),
	costUsd: numeric("cost_usd", { precision: 12, scale:  6 }).default('0').notNull(),
	priceSnapshot: jsonb("price_snapshot"),
});

export const cdoPlans = pgTable("cdo_plans", {
	id: text().default((gen_random_uuid())).primaryKey().notNull(),
	sessionId: text("session_id").notNull(),
	version: integer().default(1).notNull(),
	title: text().default('First 100 Days — DfE CDO').notNull(),
	structure: jsonb(),
	previousPlanId: text("previous_plan_id"),
	changelog: jsonb(),
	status: text().default('draft').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [researchSession.id],
			name: "cdo_plans_session_id_research_session_id_fk"
		}),
]);
