# Extracted application ownership

`docs/module-ownership.json` is generated from SR-Infra's `registry/apps.json`
and `registry/operations.json`. Consult those registries for the complete current
application and worker inventory. Edit them and regenerate the mirror with
SR-Infra's
`scripts/check-estate.mjs --checkouts <local-map.json> --write-ownership`.

Main still automatically reconciles the shared schema during deployment.
`scripts/check-extracted-schema.mjs` checks the registered physical tables before
release preparation and inside the structural gate. Removing application code
must not remove declarations required by an extracted application. Required table
sets can overlap because shared writes and references remain.

Policy authors explicit domain SQL; Main owns shared queue/settings changes.
Health and Drive currently depend on Main-authored migrations and never push
schemas. The guard checks table retention only: review column/type changes,
backfills and rollback compatibility separately. It makes no database connections
and does not replace a live schema diff or constrain arbitrary SQL scripts.

For a cross-repository review, SR-Infra's estate audit compares Health/Drive's
declared shared files with Main's actual bytes, paths and configuration. The
comparison uses supplied local checkouts; Main's build and CI remain standalone.
See [SR-Infra's consolidation guide](https://github.com/zerosumpain/SR-Infra/blob/master/docs/CONSOLIDATION.md).
