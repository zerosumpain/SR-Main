-- Sealed policy runs. Additive and repeatable.
--
-- A sealed run's free-text columns hold AES-256-GCM ciphertext under a per-run
-- key stored OUTSIDE this database, so that destroying the key makes every copy
-- of those bytes unreadable — including the fourteen nightly dumps and the
-- restic snapshots beside them, which no DELETE can reach.
--
-- NOT NULL DEFAULT false: every assessment that ran before this existed is
-- plainly an unsealed one rather than an unknown.
ALTER TABLE policy_analyses ADD COLUMN IF NOT EXISTS sealed boolean NOT NULL DEFAULT false;
