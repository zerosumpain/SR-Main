# Build the SQL predicate that selects the runs Main's own deploy may touch.
#
# Sourced by the deploy drain. Emits into $QUEUE_MINE_SQL a clause to append to a
# WHERE, or an empty string when no lane is externally owned.
#
# IS NULL OR NOT IN, never `<> 'x'`: in SQL a comparison against NULL is NULL,
# not true, so `trigger <> 'policy-analysis'` silently excluded every run with no
# trigger at all. Those runs were then neither paused by the drain nor, until
# recently, reaped as stale — they simply stayed 'running' forever.
queue_triggers_clause() {
  local file="${1:?trigger list path required}"
  local list="" line
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [ -z "$line" ] && continue
    list="${list:+$list, }'$line'"
  done < "$file"

  if [ -z "$list" ]; then
    QUEUE_MINE_SQL=""
  else
    QUEUE_MINE_SQL="AND (trigger IS NULL OR trigger NOT IN ($list))"
  fi
}
