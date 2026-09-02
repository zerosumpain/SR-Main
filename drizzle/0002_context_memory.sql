CREATE TABLE IF NOT EXISTS "jkai_context_proposals" (
  "id" text PRIMARY KEY NOT NULL,
  "fingerprint" text NOT NULL UNIQUE,
  "kind" text NOT NULL,
  "content" text NOT NULL,
  "category" text,
  "confidence" numeric(4,3) NOT NULL,
  "provisional" boolean DEFAULT true NOT NULL,
  "temporal_scope" text DEFAULT 'ongoing' NOT NULL,
  "provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
