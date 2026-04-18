-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_url" text,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb,
	"operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_schedules" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "apple_health_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric_name" text NOT NULL,
	"date" integer NOT NULL,
	"date_local" text NOT NULL,
	"value" integer,
	"min_value" integer,
	"max_value" integer,
	"units" text NOT NULL,
	"synced_at" integer DEFAULT (EXTRACT(epoch FROM now()))
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"workflow_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"healing_history" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "node_executions" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"logs" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "workflow_nodes" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"position" jsonb DEFAULT '{"x":0,"y":0}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb DEFAULT '{"type":"manual"}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_edges" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"workflow_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"source_handle" text,
	"target_handle" text
);
--> statement-breakpoint
CREATE TABLE "whatsapp_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allowed_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"soul_md" text DEFAULT '' NOT NULL,
	"auth_dir" text DEFAULT 'data/whatsapp-auth' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestrator_chats" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"workflow_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" text
);
--> statement-breakpoint
CREATE TABLE "blog_post_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"phone_number" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_data_store" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"workflow_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_assistant_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"url" text DEFAULT 'http://localhost:8123' NOT NULL,
	"token" text DEFAULT '' NOT NULL,
	"entity_registry" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_registry" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"area_registry" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_cache" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"compiled_prompt" text DEFAULT '' NOT NULL,
	"file_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"title" text,
	"source" text DEFAULT 'web' NOT NULL,
	"whatsapp_phone_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"last_sync_at" integer NOT NULL,
	"last_successful_sync_at" integer,
	"status" text DEFAULT 'idle' NOT NULL,
	"error_message" text,
	"records_synced" integer DEFAULT 0,
	CONSTRAINT "health_sync_state_service_unique" UNIQUE("service")
);
--> statement-breakpoint
CREATE TABLE "jkai_conversations" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"title" text,
	"source" text DEFAULT 'web' NOT NULL,
	"whatsapp_phone_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_memory_review" timestamp with time zone,
	"model_provider" text DEFAULT 'zai' NOT NULL,
	"model_id" text DEFAULT 'glm-5.1' NOT NULL,
	"prompt_tokens" bigint DEFAULT 0 NOT NULL,
	"completion_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"price_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"expires_at" integer,
	"created_at" integer DEFAULT (EXTRACT(epoch FROM now())),
	"updated_at" integer DEFAULT (EXTRACT(epoch FROM now()))
);
--> statement-breakpoint
CREATE TABLE "custom_tools" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"toolset" text NOT NULL,
	"parameters" jsonb DEFAULT '{"type":"object","properties":{}}'::jsonb NOT NULL,
	"handler_code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "custom_tools_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "jkai_memories" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"source_conversation_id" text,
	"confidence" text DEFAULT 'high' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by" text
);
--> statement-breakpoint
CREATE TABLE "quick_answer" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"topic" text NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"tokens_used" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strava_activities" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"sport_type" text NOT NULL,
	"start_date" integer NOT NULL,
	"start_date_local" text NOT NULL,
	"timezone" text NOT NULL,
	"distance" integer NOT NULL,
	"moving_time" integer NOT NULL,
	"elapsed_time" integer NOT NULL,
	"total_elevation_gain" integer NOT NULL,
	"average_speed" integer NOT NULL,
	"max_speed" integer NOT NULL,
	"average_heartrate" integer,
	"max_heartrate" integer,
	"calories" integer,
	"suffer_score" integer,
	"map_data" text,
	"start_latlng" text,
	"end_latlng" text,
	"synced_at" integer DEFAULT (EXTRACT(epoch FROM now()))
);
--> statement-breakpoint
CREATE TABLE "openrouter_models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"context_length" integer,
	"prompt_price" numeric(20, 12),
	"completion_price" numeric(20, 12),
	"image_price" numeric(20, 12),
	"modality" text,
	"provider" text,
	"raw" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"start_date" integer NOT NULL,
	"end_date" integer NOT NULL,
	"start_date_local" text NOT NULL,
	"timezone" text NOT NULL,
	"strain" double precision NOT NULL,
	"kilojoule" double precision NOT NULL,
	"average_heartrate" integer NOT NULL,
	"max_heartrate" integer NOT NULL,
	"synced_at" integer DEFAULT (EXTRACT(epoch FROM now()))
);
--> statement-breakpoint
CREATE TABLE "whoop_recovery" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"sleep_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"created_date" integer NOT NULL,
	"recovery_score" double precision NOT NULL,
	"resting_heart_rate" double precision NOT NULL,
	"hrv_rmssd" double precision NOT NULL,
	"spo2" double precision,
	"skin_temp" integer,
	"synced_at" integer DEFAULT (EXTRACT(epoch FROM now())),
	CONSTRAINT "whoop_recovery_cycle_id_unique" UNIQUE("cycle_id")
);
--> statement-breakpoint
CREATE TABLE "whoop_sleep" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"start_date" integer NOT NULL,
	"end_date" integer NOT NULL,
	"start_date_local" text NOT NULL,
	"nap" boolean NOT NULL,
	"total_in_bed" integer NOT NULL,
	"total_awake" integer NOT NULL,
	"total_light" integer NOT NULL,
	"total_slow_wave" integer NOT NULL,
	"total_rem" integer NOT NULL,
	"sleep_cycle_count" integer NOT NULL,
	"disturbance_count" integer NOT NULL,
	"baseline_need" integer NOT NULL,
	"need_from_debt" integer NOT NULL,
	"need_from_strain" integer NOT NULL,
	"need_from_nap" integer NOT NULL,
	"respiratory_rate" double precision NOT NULL,
	"sleep_performance" double precision NOT NULL,
	"sleep_consistency" double precision NOT NULL,
	"sleep_efficiency" double precision NOT NULL,
	"synced_at" integer DEFAULT (EXTRACT(epoch FROM now()))
);
--> statement-breakpoint
CREATE TABLE "whoop_workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"start_date" integer NOT NULL,
	"end_date" integer NOT NULL,
	"start_date_local" text NOT NULL,
	"timezone" text NOT NULL,
	"sport_id" integer NOT NULL,
	"sport_name" text,
	"strain" double precision NOT NULL,
	"average_heartrate" integer NOT NULL,
	"max_heartrate" integer NOT NULL,
	"kilojoule" double precision NOT NULL,
	"distance_meters" double precision,
	"altitude_gain_meters" double precision,
	"zone_zero" integer NOT NULL,
	"zone_one" integer NOT NULL,
	"zone_two" integer NOT NULL,
	"zone_three" integer NOT NULL,
	"zone_four" integer NOT NULL,
	"zone_five" integer NOT NULL,
	"synced_at" integer DEFAULT (EXTRACT(epoch FROM now()))
);
--> statement-breakpoint
CREATE TABLE "jkai_attachments" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"original_name" text,
	"size_bytes" integer NOT NULL,
	"disk_path" text NOT NULL,
	"duration" double precision,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"content" text NOT NULL,
	"cover_image_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp,
	"content_format" text DEFAULT 'html' NOT NULL,
	"preview_token" text,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "biome_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"settings" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "research_session" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"topic" text NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"time_limit_minutes" integer,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"share_token" text,
	"parent_session_id" text,
	"seed_context" jsonb,
	CONSTRAINT "research_session_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"session_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"snippet" text,
	"domain" text,
	"category" text,
	"phase" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credibility_score" double precision,
	"credibility_type" text
);
--> statement-breakpoint
CREATE TABLE "entity_mention" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"entity_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"context" text
);
--> statement-breakpoint
CREATE TABLE "fact" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"session_id" text NOT NULL,
	"source_id" text NOT NULL,
	"content" text NOT NULL,
	"event_date" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"is_counterfactual" boolean DEFAULT false NOT NULL,
	"refutes_fact_id" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(1536),
	"novelty_score" double precision,
	"source_agreement" integer
);
--> statement-breakpoint
CREATE TABLE "relationship" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"session_id" text NOT NULL,
	"from_entity_id" text,
	"to_entity_id" text,
	"from_fact_id" text,
	"to_fact_id" text,
	"relationship_type" text NOT NULL,
	"sentiment" text NOT NULL,
	"strength" double precision DEFAULT 0.5 NOT NULL,
	"source_id" text
);
--> statement-breakpoint
CREATE TABLE "narrative_item" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"session_id" text NOT NULL,
	"fact_id" text,
	"sort_order" integer NOT NULL,
	"annotation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_entity" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"canonical_name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_entity_link" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"global_entity_id" text NOT NULL,
	"session_entity_id" text NOT NULL,
	"session_id" text NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0,
	"origin_channel" text,
	"origin_sender" text,
	"steps" jsonb DEFAULT '[]'::jsonb,
	"current_step" integer DEFAULT 0,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"task_id" text,
	"session_id" text,
	"action_type" text NOT NULL,
	"tool_name" text,
	"input" jsonb,
	"output" jsonb,
	"reasoning" text,
	"duration_ms" integer,
	"tokens_input" integer,
	"tokens_output" integer,
	"cost_usd" double precision,
	"provider" text,
	"model" text,
	"status" text DEFAULT 'completed',
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" text,
	"task_id" text,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jkai_iterations" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"build_id" text NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"goals" text,
	"plan" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evaluation" text,
	"next_steps" text,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jkai_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"iteration_id" text,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jkai_builds" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"title" text,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"budget_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"iterations_completed" integer DEFAULT 0 NOT NULL,
	"active_minutes_used" double precision DEFAULT 0 NOT NULL,
	"serve_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_slug" text,
	"model_provider" text DEFAULT 'zai' NOT NULL,
	"model_id" text DEFAULT 'glm-5.1' NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"price_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "cdo_plans" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid()) NOT NULL,
	"session_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text DEFAULT 'First 100 Days — DfE CDO' NOT NULL,
	"structure" jsonb,
	"previous_plan_id" text,
	"changelog" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_node_id_workflow_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_node_id_workflow_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_node_id_workflow_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_chats" ADD CONSTRAINT "orchestrator_chats_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_chats" ADD CONSTRAINT "orchestrator_chats_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."jkai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_tags" ADD CONSTRAINT "blog_post_tags_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_data_store" ADD CONSTRAINT "workflow_data_store_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jkai_attachments" ADD CONSTRAINT "jkai_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."jkai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jkai_attachments" ADD CONSTRAINT "jkai_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."orchestrator_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_session_id_research_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_session_id_research_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mention" ADD CONSTRAINT "entity_mention_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mention" ADD CONSTRAINT "entity_mention_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_session_id_research_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_refutes_fact_id_fact_id_fk" FOREIGN KEY ("refutes_fact_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_session_id_research_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_from_entity_id_entity_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_to_entity_id_entity_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_from_fact_id_fact_id_fk" FOREIGN KEY ("from_fact_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_to_fact_id_fact_id_fk" FOREIGN KEY ("to_fact_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_item" ADD CONSTRAINT "narrative_item_session_id_research_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_item" ADD CONSTRAINT "narrative_item_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_link" ADD CONSTRAINT "global_entity_link_global_entity_id_global_entity_id_fk" FOREIGN KEY ("global_entity_id") REFERENCES "public"."global_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_link" ADD CONSTRAINT "global_entity_link_session_entity_id_entity_id_fk" FOREIGN KEY ("session_entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_link" ADD CONSTRAINT "global_entity_link_session_id_research_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_action_id_agent_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."agent_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jkai_iterations" ADD CONSTRAINT "jkai_iterations_build_id_jkai_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."jkai_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jkai_logs" ADD CONSTRAINT "jkai_logs_build_id_jkai_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."jkai_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jkai_logs" ADD CONSTRAINT "jkai_logs_iteration_id_jkai_iterations_id_fk" FOREIGN KEY ("iteration_id") REFERENCES "public"."jkai_iterations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdo_plans" ADD CONSTRAINT "cdo_plans_session_id_research_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_apple_health_metric_date" ON "apple_health_metrics" USING btree ("metric_name" int4_ops,"date" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_data_store_workflow_key_idx" ON "workflow_data_store" USING btree ("workflow_id" text_ops,"key" text_ops);--> statement-breakpoint
CREATE INDEX "openrouter_models_modality_idx" ON "openrouter_models" USING btree ("modality" text_ops);--> statement-breakpoint
CREATE INDEX "openrouter_models_provider_idx" ON "openrouter_models" USING btree ("provider" text_ops);--> statement-breakpoint
CREATE INDEX "jkai_attachments_conversation_idx" ON "jkai_attachments" USING btree ("conversation_id" text_ops);--> statement-breakpoint
CREATE INDEX "jkai_attachments_message_idx" ON "jkai_attachments" USING btree ("message_id" text_ops);--> statement-breakpoint
CREATE INDEX "jkai_attachments_orphan_idx" ON "jkai_attachments" USING btree ("created_at" timestamptz_ops) WHERE (message_id IS NULL);
*/