-- Additive private policy analysis schema, generated from the canonical Drizzle definitions.
BEGIN;
CREATE TABLE IF NOT EXISTS "policy_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"title" text NOT NULL,
	"jurisdiction" text,
	"policy_area" text,
	"context" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "policy_artefacts" (
	"id" text NOT NULL,
	"analysis_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"statement" text NOT NULL,
	"origin" text NOT NULL,
	"confidence" double precision,
	"source_id" text,
	"source_quote" text,
	"page" integer,
	"section" text,
	"start_offset" integer,
	"end_offset" integer,
	"url" text,
	"from_id" text,
	"to_id" text,
	"relation" text,
	"temporal" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_artefacts_analysis_id_id_pk" PRIMARY KEY("analysis_id","id"),
	CONSTRAINT "policy_confidence_range" CHECK ("policy_artefacts"."confidence" IS NULL OR ("policy_artefacts"."confidence" >= 0 AND "policy_artefacts"."confidence" <= 1))
);

CREATE TABLE IF NOT EXISTS "policy_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" text NOT NULL,
	"extracted_text" text,
	"metadata" jsonb
);

CREATE TABLE IF NOT EXISTS "policy_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text
);

CREATE TABLE IF NOT EXISTS "policy_model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"call_key" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"provider" text,
	"model" text,
	"usage" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text
);

CREATE TABLE IF NOT EXISTS "policy_provenance" (
	"analysis_id" uuid NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"relation" text DEFAULT 'derived_from' NOT NULL,
	CONSTRAINT "policy_provenance_analysis_id_from_id_to_id_pk" PRIMARY KEY("analysis_id","from_id","to_id")
);

CREATE TABLE IF NOT EXISTS "policy_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"run_id" text,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output" jsonb
);

DO $$ BEGIN ALTER TABLE "policy_artefacts" ADD CONSTRAINT "policy_artefacts_analysis_id_policy_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."policy_analyses"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_analysis_id_policy_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."policy_analyses"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_executions" ADD CONSTRAINT "policy_executions_stage_id_policy_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."policy_stages"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_executions" ADD CONSTRAINT "policy_executions_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_model_calls" ADD CONSTRAINT "policy_model_calls_execution_id_policy_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."policy_executions"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_provenance" ADD CONSTRAINT "policy_provenance_analysis_id_policy_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."policy_analyses"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_provenance" ADD CONSTRAINT "policy_provenance_from_fk" FOREIGN KEY ("analysis_id","from_id") REFERENCES "public"."policy_artefacts"("analysis_id","id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_provenance" ADD CONSTRAINT "policy_provenance_to_fk" FOREIGN KEY ("analysis_id","to_id") REFERENCES "public"."policy_artefacts"("analysis_id","id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_stages" ADD CONSTRAINT "policy_stages_analysis_id_policy_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."policy_analyses"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "policy_stages" ADD CONSTRAINT "policy_stages_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "policy_analyses_owner_idx" ON "policy_analyses" USING btree ("owner","created_at");

CREATE INDEX IF NOT EXISTS "policy_artefacts_kind_idx" ON "policy_artefacts" USING btree ("analysis_id","kind");

CREATE INDEX IF NOT EXISTS "policy_artefacts_graph_idx" ON "policy_artefacts" USING btree ("analysis_id","from_id","to_id");

CREATE UNIQUE INDEX IF NOT EXISTS "policy_documents_analysis_idx" ON "policy_documents" USING btree ("analysis_id");

CREATE INDEX IF NOT EXISTS "policy_executions_stage_idx" ON "policy_executions" USING btree ("stage_id");

CREATE INDEX IF NOT EXISTS "policy_model_calls_execution_idx" ON "policy_model_calls" USING btree ("execution_id");

CREATE UNIQUE INDEX IF NOT EXISTS "policy_stages_order_idx" ON "policy_stages" USING btree ("analysis_id","ordinal");
COMMIT;
