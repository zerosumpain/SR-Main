#!/usr/bin/env bash
# Fast, dependency-free repository checks shared by CI and /jkai/build.
#
# Keep this list in one place. A repo build used to run only two of these five
# checks while GitHub ran all five, so an agent could open a PR that was
# guaranteed to turn red as soon as CI saw it.
#
# `gate:schema-drift` is the one member that CAN use a database, and it stays
# inside the dependency-free rule by checking for DATABASE_URL and returning
# BEFORE it imports `pg`. In the CI lint job — which runs with no `npm ci` and
# no node_modules — it prints that it skipped and passes. It earns its place
# here because `npm run gate` on a dev box does have a database, and that is
# exactly where the drift it looks for accumulates.
set -euo pipefail

npm run gate:public-routes
npm run gate:font-sizes
npm run gate:measure
npm run gate:source-footprint
npm run gate:schema-imports
npm run gate:schema-drift
npm run gate:boundaries
