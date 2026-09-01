#!/usr/bin/env bash
# Place a build that arrived in the prebuild artifact into releases/<sha> on the
# VPS.
#
# Runs in the `release` job. It deliberately builds and verifies NOTHING: the
# build happens on porkserv and this job has no node_modules. ci-prebuild.sh
# does the verification, on the machine that can actually import the bundle.
#
# Expects: cwd = repo root, with build/ restored from the release artifact.
set -euo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SHA="$(git rev-parse HEAD)"
RELEASE_DIR="$VPS_DIR/releases/$SHA"

[ -d build ] || { echo "no build/ directory — did the artifact download step run?" >&2; exit 1; }
[ -f build/handler.js ] || { echo "build/handler.js missing from the artifact — the adapter did not package a server bundle" >&2; exit 1; }

# The stamp is written by ci-prebuild.sh on the build machine, so its absence
# means this build never went through it. It is also a hidden file, which
# upload-artifact drops unless include-hidden-files is set — this is what makes
# that silent omission loud.
[ -f build/.deploy-sha ] || { echo "build/.deploy-sha missing — the artifact was not stamped by prebuild, or hidden files were dropped on upload" >&2; exit 1; }

# Refuse an artifact built from a different commit than this checkout. The
# release log and the staged directory are both keyed on SHA, so a mismatch
# would ship one commit's code under another commit's name.
STAMPED="$(sed -n 's/^sha=//p' build/.deploy-sha | head -1)"
[ "$STAMPED" = "$SHA" ] || { echo "artifact was built from $STAMPED but this checkout is $SHA" >&2; exit 1; }
STAMPED_TREE="$(sed -n 's/^tree=//p' build/.deploy-sha | head -1)"
TREE="$(git rev-parse 'HEAD^{tree}')"
[ "$STAMPED_TREE" = "$TREE" ] || { echo "artifact tree is $STAMPED_TREE but this checkout tree is $TREE" >&2; exit 1; }

# Copy to .partial and rename. A release directory either exists complete or
# does not exist — a half-copied one must never be mistaken for shippable, and
# ci-release.sh's only precondition is that the directory is there.
echo "==> Staging release $SHA..."
mkdir -p "$VPS_DIR/releases"
rm -rf "$RELEASE_DIR.partial"
rsync -a build/ "$RELEASE_DIR.partial/"
rm -rf "$RELEASE_DIR"
mv -T "$RELEASE_DIR.partial" "$RELEASE_DIR"

echo "==> Staged $(du -sh "$RELEASE_DIR" | cut -f1) at $RELEASE_DIR"
echo "==> Not live yet — ci-release.sh flips the symlink."
