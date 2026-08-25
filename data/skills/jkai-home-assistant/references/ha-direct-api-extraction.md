# When `ha_get_history` returns too much

This file used to describe bypassing the HA tools entirely: pull the bearer
token out of the `home_assistant_config` table with `docker exec … psql` from
inside `execute_code`, or over SSH to the VPS from `terminal`, then curl the
REST API directly.

**None of that works on the chat loop.** It has no shell and no code sandbox —
`terminal`, `execute_code` and `from hermes_tools import terminal` were all
Hermes-era capabilities and went with it. Following the old procedure costs a
round per attempt and returns `Unknown function` each time.

It should not come back in that form either. The procedure ended with a
long-lived Home Assistant bearer token in a variable, having read it out of the
production database and, in the SSH variant, printed the VPS address and key
path into the transcript.

## What to do instead

The truncation the old procedure existed to dodge is a **window** problem, so
narrow the window rather than change the transport:

- `ha_get_history(entity_id, start, end)` takes an ISO 8601 range and defaults to
  the last 24 hours. Ask for the hours you actually want. A day of a
  frequently-changing sensor is a large payload; an hour of it is not.
- Fetch one entity at a time. `ha_find` resolves a human name to an entity id
  first, so you are not guessing at ids and re-querying.
- For "what is it now", `ha_query_state` is the right tool and carries no
  history at all.
- For anything computed — an average, a min/max, a count over a period — push it
  into `ha_render_template` and let Home Assistant do the arithmetic. It returns
  the answer instead of the raw series, which is both smaller and correct.

If a request genuinely needs more history than the tools will return in one
call, take it in consecutive windows and combine the results. That is slower
than a single raw API call was, and it is the supported path.
