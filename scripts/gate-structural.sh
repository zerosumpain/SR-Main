#!/usr/bin/env bash
# Fast, dependency-free repository checks shared by CI and /jkai/build.
#
# Keep this list in one place. A repo build used to run only two of these five
# checks while GitHub ran all five, so an agent could open a PR that was
# guaranteed to turn red as soon as CI saw it.
set -euo pipefail

npm run gate:public-routes
npm run gate:font-sizes
npm run gate:measure
npm run gate:schema-imports
npm run gate:boundaries
