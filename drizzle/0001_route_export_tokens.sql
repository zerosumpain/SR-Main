CREATE TABLE "route_export_token" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "file_id" text NOT NULL REFERENCES "workflow_files"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "use_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "route_export_token_hash_idx" ON "route_export_token" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "route_export_token_file_idx" ON "route_export_token" USING btree ("file_id");
