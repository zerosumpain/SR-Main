-- Drive in the SR app (2026-10-30): give the Family role `drive:self`.
--
-- The phone's Drive (/api/native/drive, $lib/drive/app-lane) answers a member
-- only while they hold drive:self. BUILT_IN_GROUPS is seeded once and lives in
-- the catalogue byte-shared with four other repositories, so the live group is
-- widened here instead. `drive:self` means: their own folder, which nobody else
-- on the app can open, and the family's shared folder. (On the web /drive the
-- same grant shows those two folders, the shared one read-only.)
--
-- A WIDENING, so the access_group trigger only notes it ('group-widened'); it
-- revokes no phone. Idempotent. No new table: workflow_files is already granted
-- to sr_main_runtime. Apply as the owner after the release that serves the lane:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
UPDATE access_group
   SET grants = grants || '["drive:self"]'::jsonb
 WHERE id = 'family-circle'
   AND NOT grants ? 'drive:self'
   AND NOT grants ? 'drive:all'
   AND NOT grants ? 'drive:admin';
