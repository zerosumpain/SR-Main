-- Research share links: move the remaining plaintext tokens to their sha256.
--
-- Optional and idempotent. The application already compares by hash and
-- upgrades a legacy plaintext link the first time it is used or re-issued
-- ($lib/deepdive/share), so every issued link keeps working whether or not this
-- has run. Running it removes the plaintext that is still at rest for links
-- nobody has opened since.
--
-- Run AFTER the release whose drizzle push adds research_session.share_token_hash
-- (with its unique constraint); before then it does nothing. Not wired into
-- ci-release.sh: apply by hand with the migration credential.
--
-- The hash matches node's createHash('sha256').update(token).digest('hex'):
-- sha256 of the token's UTF-8 bytes, lower-case hex. Requires PostgreSQL 11+.
-- share_token is NOT dropped; the column stays declared in schema.ts.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'research_session' AND column_name = 'share_token_hash'
  ) THEN
    RAISE NOTICE 'research_session.share_token_hash does not exist yet; nothing to do';
    RETURN;
  END IF;

  UPDATE research_session AS r
  SET share_token_hash = encode(sha256(convert_to(r.share_token, 'UTF8')), 'hex'),
      share_token = NULL
  WHERE r.share_token IS NOT NULL
    AND r.share_token_hash IS NULL
    -- Never collide with a hash already held by another run.
    AND NOT EXISTS (
      SELECT 1 FROM research_session o
      WHERE o.share_token_hash = encode(sha256(convert_to(r.share_token, 'UTF8')), 'hex')
    );
END
$$;
COMMIT;
