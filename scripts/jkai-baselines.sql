-- The jkai overhaul's five baselines (plan 2026-10-28, principle 13).
--
-- READ-ONLY: everything runs inside BEGIN READ ONLY … ROLLBACK and uses
-- count(*), never n_live_tup. Re-run before each slice's next platform
-- primitive starts and compare with the previous run.
--
--   psql "$DATABASE_URL" -f scripts/jkai-baselines.sql
--   # production, from a workstation:
--   ssh <vps> 'docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling' < scripts/jkai-baselines.sql
--
-- Windows: since 2026-10-03 (the plan's reference date), the last 14 days, and
-- a weekly series. Definitions are fixed here so every re-measure is the same:
--
-- 1. Weekly owner messages: user rows in the owner's threads, excluding
--    heartbeat and scheduled synthetic turns.
-- 2. Discovery share: chat-trace steps spent finding tools (activate_toolset,
--    tool_search, tool_describe, jkai_help, skills_list) over all steps.
-- 3. Tool error rate: chat-trace steps with status 'error' over all steps.
--    (Traces cover chat-route turns only; service turns write none.)
-- 4. Unrated daydream notes: daydream_thoughts with no feedback, all notes
--    and delivered notes, since 2026-10-14 (the plan's 91.5% figure).
-- 5. Chat builds that did work: jkai_builds started from chat (origin 'chat',
--    or a conversation_id, since build_create stored origin 'manual') with
--    tokens_used > 0.

BEGIN READ ONLY;

\echo '== 1. Weekly owner messages (last 10 weeks) =='
SELECT date_trunc('week', o.created_at)::date AS week,
       count(*) AS owner_messages,
       count(*) FILTER (WHERE c.source LIKE 'whatsapp%') AS via_whatsapp
FROM orchestrator_chats o
JOIN jkai_conversations c ON c.id = o.conversation_id
WHERE o.role = 'user'
  AND c.principal_id = 'owner'
  AND o.created_at >= date_trunc('week', now()) - interval '9 weeks'
  AND NOT (coalesce(o.metadata, '{}'::jsonb) ? 'heartbeat')
  AND NOT (coalesce(o.metadata, '{}'::jsonb) ? 'scheduledCallback')
  AND o.content NOT LIKE '[heartbeat]%'
GROUP BY 1 ORDER BY 1;

\echo '== 2 and 3. Discovery share and tool error rate (chat traces) =='
WITH steps AS (
  SELECT t.created_at AS at, s ->> 'tool' AS tool, s ->> 'status' AS status
  FROM jkai_tool_traces t, LATERAL jsonb_array_elements(t.steps -> 'steps') s
)
SELECT w.label AS window,
       count(*) AS steps,
       count(*) FILTER (WHERE tool IN ('activate_toolset', 'tool_search', 'tool_describe', 'jkai_help', 'skills_list')) AS discovery_steps,
       round(100.0 * count(*) FILTER (WHERE tool IN ('activate_toolset', 'tool_search', 'tool_describe', 'jkai_help', 'skills_list')) / nullif(count(*), 0), 1) AS discovery_pct,
       count(*) FILTER (WHERE status = 'error') AS error_steps,
       round(100.0 * count(*) FILTER (WHERE status = 'error') / nullif(count(*), 0), 1) AS error_pct
FROM (VALUES ('since 2026-10-03', timestamptz '2026-10-03 00:00+00'), ('last 14 days', now() - interval '14 days')) AS w(label, since)
JOIN steps ON steps.at >= w.since
GROUP BY w.label ORDER BY w.label DESC;

WITH steps AS (
  SELECT t.created_at AS at, s ->> 'tool' AS tool, s ->> 'status' AS status
  FROM jkai_tool_traces t, LATERAL jsonb_array_elements(t.steps -> 'steps') s
  WHERE t.created_at >= timestamptz '2026-10-03 00:00+00'
)
SELECT date_trunc('week', at)::date AS week, count(*) AS steps,
       round(100.0 * count(*) FILTER (WHERE tool IN ('activate_toolset', 'tool_search', 'tool_describe', 'jkai_help', 'skills_list')) / nullif(count(*), 0), 1) AS discovery_pct,
       round(100.0 * count(*) FILTER (WHERE status = 'error') / nullif(count(*), 0), 1) AS error_pct
FROM steps GROUP BY 1 ORDER BY 1;

\echo '== 4. Unrated daydream notes =='
SELECT w.label AS window,
       count(*) AS notes,
       count(*) FILTER (WHERE d.feedback IS NULL) AS unrated,
       round(100.0 * count(*) FILTER (WHERE d.feedback IS NULL) / nullif(count(*), 0), 1) AS unrated_pct,
       count(*) FILTER (WHERE d.delivered_at IS NOT NULL) AS delivered,
       round(100.0 * count(*) FILTER (WHERE d.delivered_at IS NOT NULL AND d.feedback IS NULL)
             / nullif(count(*) FILTER (WHERE d.delivered_at IS NOT NULL), 0), 1) AS delivered_unrated_pct
FROM (VALUES ('since 2026-10-14', timestamptz '2026-10-14 00:00+00'), ('last 14 days', now() - interval '14 days')) AS w(label, since)
JOIN daydream_thoughts d ON d.created_at >= w.since
GROUP BY w.label ORDER BY w.label DESC;

\echo '== 5. Chat builds with tokens_used > 0 =='
SELECT w.label AS window,
       count(*) AS chat_builds,
       count(*) FILTER (WHERE b.tokens_used > 0) AS with_tokens,
       count(*) FILTER (WHERE b.origin = 'chat') AS origin_chat
FROM (VALUES ('since 2026-10-03', timestamptz '2026-10-03 00:00+00'), ('last 14 days', now() - interval '14 days')) AS w(label, since)
JOIN jkai_builds b ON b.created_at >= w.since AND (b.origin = 'chat' OR b.conversation_id IS NOT NULL)
GROUP BY w.label ORDER BY w.label DESC;

ROLLBACK;
