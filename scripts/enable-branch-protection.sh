#!/usr/bin/env bash
# Enable real, server-side branch protection on master.
#
# Blocked as of 2026-07-25: SR-Main is a PRIVATE repo on GitHub Free, and both
# the branch-protection API and the rulesets API return:
#   403 "Upgrade to GitHub Pro or make this repository public to enable this
#        feature."
# Until the account is on Pro, .githooks/pre-push is the client-side stand-in.
# Run this the moment that changes — it is the real enforcement.
#
# Settings and why:
#   required_approving_review_count: 0
#     GitHub does not let you approve your own PR. On a solo repo, requiring 1
#     approval would make every PR unmergeable. 0 still forces the branch -> PR
#     -> merge flow (and the diff/audit trail); it just does not require a
#     second human who does not exist.
#   enforce_admins: true
#     Without this the rule is cosmetic. Agents push using the owner's
#     credentials — i.e. as an admin — so admin bypass would exempt exactly the
#     actor this is meant to constrain.
#   required_status_checks: null
#     Set this once the CI workflow exists (step 2). Requiring a check that
#     never reports would make every PR permanently unmergeable.
set -euo pipefail

REPO="${REPO:-zerosumpain/SR-Main}"
BRANCH="${BRANCH:-master}"

echo "==> Enabling branch protection on ${REPO}@${BRANCH}..."

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

if gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" --input "$tmp" >/dev/null; then
  echo "==> Protected. Verifying..."
  gh api "repos/${REPO}/branches/${BRANCH}/protection" \
    --jq '{pr_required: (.required_pull_request_reviews != null),
           enforce_admins: .enforce_admins.enabled,
           force_pushes: .allow_force_pushes.enabled,
           deletions: .allow_deletions.enabled}'
  echo "==> Done. .githooks/pre-push is now belt-and-braces; keep it."
else
  echo "==> FAILED. If this is still the Free-plan 403, the account needs GitHub Pro." >&2
  exit 1
fi
