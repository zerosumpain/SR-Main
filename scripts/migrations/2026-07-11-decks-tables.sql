-- sr. decks — presentation capability (phase 1 schema).
-- Applied manually via psql because non-interactive `drizzle-kit push` is
-- blocked by an unrelated pre-existing prompt (jkai_conversations unique
-- constraint drift). Matches src/lib/db/schema.ts exactly. Idempotent.

CREATE TABLE IF NOT EXISTS "decks" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "theme" text NOT NULL DEFAULT 'editorial',
  "is_public" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "decks_slug_idx" ON "decks" ("slug");

CREATE TABLE IF NOT EXISTS "deck_slides" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "deck_id" text NOT NULL REFERENCES "decks"("id") ON DELETE CASCADE,
  "parent_slide_id" text,
  "position" integer NOT NULL DEFAULT 0,
  "title" text,
  "layout" text NOT NULL DEFAULT 'default',
  "blocks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  "version" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "deck_slides_deck_idx" ON "deck_slides" ("deck_id","parent_slide_id","position");

CREATE TABLE IF NOT EXISTS "deck_share" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "deck_id" text NOT NULL REFERENCES "decks"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "label" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "use_count" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "deck_share_token_hash_idx" ON "deck_share" ("token_hash");
CREATE INDEX IF NOT EXISTS "deck_share_deck_idx" ON "deck_share" ("deck_id");
