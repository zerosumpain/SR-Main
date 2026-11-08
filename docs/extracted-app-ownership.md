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

## Application-owned schemas

A table that only one extracted application uses can leave `public` for that
application's own Postgres schema; the registry records it as `ownedSchema` /
`ownedTables`, and no application lists it in `requiredTables`. Drive (`drive`:
rag tables), Policy Engine (`policy`), DfE Data Strategy (`dfe`) and Data Standard
Designer (`dsd`) moved theirs with `scripts/migrations/2026-10-02-app-owned-schemas.sql`,
which `ci-release.sh` applies before `drizzle-kit push` (rollback:
`2026-10-02-app-owned-schemas.rollback.sql`, by hand, after the apps roll back).

`drizzle.config.ts` pins `schemaFilter: ['public']`: push neither creates nor
alters anything in an application schema. Main still declares the moved tables
with `pgSchema(...)` for one release so that their removal is a no-op, and the
migration's `public` compatibility views are excluded in `tablesFilter` because
push drops undeclared views. `check-extracted-schema.mjs` fails if an owned table
is declared in `public`, in the wrong schema, or the schema filter hands an
application schema to Main. A later release drops the views, the `tablesFilter`
lines and the declarations together, once every application reads its own schema.

For a cross-repository review, SR-Infra's estate audit compares Health/Drive's
declared shared files with Main's actual bytes, paths and configuration. The
comparison uses supplied local checkouts; Main's build and CI remain standalone.
See [SR-Infra's consolidation guide](https://github.com/zerosumpain/SR-Infra/blob/master/docs/CONSOLIDATION.md).

## Model plumbing

Drive, Health, Policy Engine, DfE Data Strategy and Data Standard Designer no
longer read `app_settings` or `openrouter_models`, or write `agent_actions`.

- `GET /api/platform/models/config` serves the allow-listed model-selection
  settings, Main's resolution of the default and each workload, `codex.enabled`
  and the OpenRouter catalogue reduced to prices, completion caps, modalities and
  supported parameters. It never serves a credential: `openrouter.api_key` stays
  Main's, and each application sets its own `OPENROUTER_API_KEY`.
- `POST /api/platform/models/usage` accepts up to 100 usage events and writes each
  as the `agent_actions` row `$lib/llm/usage-log` builds (`llmCallRow`), keyed by
  the event id (`ON CONFLICT DO NOTHING`), dated when the call finished, with
  `input.app` taken from the credential. A null cost stays null.
- Each application has its own credential, `MODEL_SERVICE_TOKEN_<APP>` here and
  `MODEL_SERVICE_TOKEN` there ($lib/server/model-service-auth).
- `src/lib/llm/model-service-contract.ts` and `model-service-client.ts` are shared
  byte for byte with the five applications (`shared-with-extracted.json`). The
  shared `pricing`, `usage-capture` and `usage-log` read the catalogue and write
  usage through `$lib/llm/model-source`, which is deliberately NOT shared: Main's
  copy uses its database, each application's copy uses the client.

`hooks.server.ts` must let both paths through the session gate for a request
carrying a valid model-service credential, the way it names the
`/api/platform/tools/*` lane; each handler re-checks the credential itself.
