# Build the SQL predicate that selects the runs Main's own deploy may touch.
#
# Sourced by the deploy drain. Emits into $QUEUE_MINE_SQL a clause to append to a
# WHERE, or an empty string when no lane is externally owned.
#
# EXTERNAL_QUEUE_TRIGGERS overrides the file, exactly as it overrides the list in
# src/lib/workflows/trigger-ownership.ts — empty string means "no lane is
# external", which is the documented rollback. The two MUST agree: if the env var
# moved only the TypeScript queue, a rollback would return a lane to Main's worker
# while this drain still refused to pause it, and Main's own in-flight runs would
# survive the restart stuck in 'running'. The mirror case is worse — handing a
# lane out by env var while the drain still pauses its rows is Main writing to a
# row another process owns.
#
# The predicate is written IS NULL OR NOT IN rather than `<> 'x'`. workflow_runs.trigger
# is NOT NULL today, so the two are equivalent; the longer form is the one that
# stays correct if that ever changes, and it matches claimableTriggerSql().
queue_triggers_clause() {
  local file="${1:?trigger list path required}"
  local list="" line raw

  if [ -n "${EXTERNAL_QUEUE_TRIGGERS+set}" ]; then
    raw="$(printf '%s' "$EXTERNAL_QUEUE_TRIGGERS" | tr ',' '\n')"
  else
    raw="$(cat "$file")"
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    # Trim the ENDS only. Stripping all whitespace would turn "policy analysis"
    # into "policyanalysis", which then passes the check below — the opposite of
    # what it is for.
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    # Same validation as externalTriggers(): a typo must not quietly hand a lane
    # back to Main while a dedicated worker is still leasing it.
    case "$line" in
      *[!a-z0-9-]* | -*) echo "queue-triggers: invalid trigger name: $line" >&2; return 1 ;;
    esac
    list="${list:+$list, }'$line'"
  done <<EOF
$raw
EOF

  if [ -z "$list" ]; then
    QUEUE_MINE_SQL=""
  else
    QUEUE_MINE_SQL="AND (trigger IS NULL OR trigger NOT IN ($list))"
  fi
}
