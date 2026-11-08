-- Retire the cron workflows the Policy-family `seed-workflows` routes wrote
-- straight into the shared workflow tables (SR-Policy-Engine, SR-DfE-Data-Strategy,
-- SR-Data-Standard-Designer). Those apps now register the same schedules with
-- SR-Workflows (PUT /api/workflows/schedules/registered), which owns these
-- tables, under names `canvas:reg--<app>--<key>`.
--
-- Run by hand as the migration owner, AFTER each app has registered its
-- schedules; it is not part of ci-release.sh. Never run it against a shared
-- local database. Repeatable: a second run finds nothing to do.
--
-- Fails safe, per row:
--  - only the six exact names below, and only the owner's;
--  - only the thin graph the seed route built — one `trigger` node and one
--    `http-request` node calling that app's own endpoint — so a canvas the
--    owner has since edited is left alone and reported;
--  - only once that app has at least one enabled registered schedule, so
--    running this too early cannot leave an app with no schedule at all.
-- Deleting a workflow cascades to its nodes, edges, schedule, versions and run
-- history (each run was a single POST to the app's ingest endpoint).
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(2026100204, 1);

DO $$
DECLARE
  seeded record;
  wf text;
  retired integer := 0;
BEGIN
  IF to_regclass('workflows') IS NULL OR to_regclass('workflow_nodes') IS NULL
     OR to_regclass('workflow_schedules') IS NULL THEN
    RAISE NOTICE 'retire-seeded-project-schedules: workflow tables absent, nothing to do';
    RETURN;
  END IF;

  FOR seeded IN
    SELECT * FROM (VALUES
      ('canvas:pe-track-ees', 'policy-engine', '/api/policy-engine/ingest'),
      ('canvas:pe-track-neet', 'policy-engine', '/api/policy-engine/ingest'),
      ('canvas:pe-track-context', 'policy-engine', '/api/policy-engine/ingest'),
      ('canvas:pe-track-annual', 'policy-engine', '/api/policy-engine/ingest'),
      ('canvas:keystone-intel-radar', 'dfe-data-strategy', '/api/dfe-data-strategy/intel'),
      ('canvas:dsd-standards-discovery', 'data-standard-designer', '/api/data-standard-designer/ingest')
    ) AS s(name, app, path)
  LOOP
    FOR wf IN
      SELECT w.id FROM workflows w WHERE w.name = seeded.name AND w.principal_id = 'owner'
    LOOP
      IF (SELECT count(*) FROM workflow_nodes n WHERE n.workflow_id = wf) <> 2
         OR NOT EXISTS (SELECT 1 FROM workflow_nodes n
                        WHERE n.workflow_id = wf AND n.type = 'trigger')
         OR NOT EXISTS (SELECT 1 FROM workflow_nodes n
                        WHERE n.workflow_id = wf AND n.type = 'http-request'
                          AND upper(coalesce(n.config->>'method', '')) = 'POST'
                          AND right(coalesce(n.config->>'url', ''), length(seeded.path)) = seeded.path) THEN
        RAISE NOTICE 'retire-seeded-project-schedules: kept % (%): not the seeded graph any more, review by hand',
          seeded.name, wf;
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM workflows r
        JOIN workflow_schedules s ON s.workflow_id = r.id AND s.enabled
        WHERE left(r.name, length('canvas:reg--' || seeded.app || '--')) = 'canvas:reg--' || seeded.app || '--'
      ) THEN
        RAISE NOTICE 'retire-seeded-project-schedules: kept % : % has no enabled registered schedule yet',
          seeded.name, seeded.app;
        CONTINUE;
      END IF;

      DELETE FROM workflows w WHERE w.id = wf;
      retired := retired + 1;
      RAISE NOTICE 'retire-seeded-project-schedules: retired % (%)', seeded.name, wf;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'retire-seeded-project-schedules: % workflow(s) retired', retired;
END $$;

COMMIT;
