-- Synthetic Tavily ledger rows for the isolated /admin/ops/tavily preview.
-- Shaped like what $lib/deepdive/tavily-ledger writes; every id starts
-- `seed-` and every host is `seed`, so nothing here can pass for real usage.
-- Re-runnable: it clears its own rows first. NEVER apply to production.

begin;

delete from agent_actions where action_type = 'tavily_call' and input ->> 'host' = 'seed';
delete from research_session where id like 'seed-%';
delete from workflows where id like 'seed-%';

insert into workflows (id, name) values
  ('seed-wf-news', 'canvas:morning-news-digest'),
  ('seed-wf-rivals', 'canvas:competitor-watch');

insert into research_session (id, topic, status, depth, created_at) values
  ('seed-rs-heat', 'Heat pump grants in England', 'completed', 'investigation', now() - interval '12 days'),
  ('seed-rs-trusts', 'Academy trust consolidation in 2026', 'completed', 'investigation', now() - interval '3 days');

-- A row-builder, so each block below reads as what it is.
create temp table seed_rows (
  at timestamptz, kind text, purpose text, depth text, query text, urls text[], credits int,
  ok boolean, http int, err text, ms int, results int, attempt int, ambient jsonb, options jsonb
) on commit drop;

-- Workflow: morning news digest, three news searches every day at 06:00.
insert into seed_rows
select date_trunc('day', now()) - (d || ' days')::interval + interval '6 hours' + (i || ' seconds')::interval,
  'search', 'workflow.tavily-search', 'basic', q, null, 1, true, 200, null, 900 + i * 40, 5, 1,
  jsonb_build_object('workflowId', 'seed-wf-news', 'runId', 'seed-run-news-' || d, 'nodeId', 'search-' || i),
  jsonb_build_object('maxResults', 5, 'topic', 'news', 'days', 1)
from generate_series(0, 29) d,
  (values (1, 'uk education policy news'), (2, 'ofsted inspection news'), (3, 'dfe funding announcements')) as t(i, q);

-- Workflow: competitor watch, two ADVANCED searches every day at 07:30.
insert into seed_rows
select date_trunc('day', now()) - (d || ' days')::interval + interval '7 hours 30 minutes' + (i || ' seconds')::interval,
  'search', 'workflow.tavily-search', 'advanced', q, null, 2, true, 200, null, 2100 + i * 90, 10, 1,
  jsonb_build_object('workflowId', 'seed-wf-rivals', 'runId', 'seed-run-rivals-' || d, 'nodeId', 'search-' || i),
  jsonb_build_object('maxResults', 10)
from generate_series(0, 29) d,
  (values (1, 'school MIS supplier contract awards'), (2, 'edtech procurement framework 2026')) as t(i, q);

-- Research run: heat pumps, 12 days ago.
insert into seed_rows
select now() - interval '12 days' + (i * 7 || ' seconds')::interval, 'search', 'research.phase1', 'basic',
  'heat pump grant england ' || (array['eligibility','boiler upgrade scheme','installer shortage','2026 changes','rural homes','air source cost'])[1 + i % 6] || ' ' || i,
  null, 1, true, 200, null, 1100, 10, 1, jsonb_build_object('researchSessionId', 'seed-rs-heat'), jsonb_build_object('maxResults', 10)
from generate_series(1, 12) i;
insert into seed_rows
select now() - interval '12 days' + interval '3 minutes' + (i * 5 || ' seconds')::interval, 'extract', 'research.phase2.source', 'basic', null,
  array['https://example.gov.uk/heat-pumps/source-' || i], 1, true, 200, null, 2400, 1, 1, jsonb_build_object('researchSessionId', 'seed-rs-heat'), null
from generate_series(1, 25) i;
insert into seed_rows
select now() - interval '12 days' + interval '9 minutes' + (i * 6 || ' seconds')::interval, 'search', 'research.phase3', 'basic',
  'verify claim heat pump ' || i, null, 1, true, 200, null, 1000, 3, 1, jsonb_build_object('researchSessionId', 'seed-rs-heat'), jsonb_build_object('maxResults', 3)
from generate_series(1, 9) i;

-- Research run: academy trusts, 3 days ago, with people look-ups.
insert into seed_rows
select now() - interval '3 days' + (i * 7 || ' seconds')::interval, 'search', 'research.phase1', 'basic',
  'academy trust merger ' || i, null, 1, true, 200, null, 1200, 10, 1, jsonb_build_object('researchSessionId', 'seed-rs-trusts'), jsonb_build_object('maxResults', 10)
from generate_series(1, 10) i;
insert into seed_rows
select now() - interval '3 days' + interval '2 minutes' + (i * 5 || ' seconds')::interval, 'extract', 'research.phase2.source', 'basic', null,
  array['https://example.org/trusts/source-' || i], 1, true, 200, null, 2600, 1, 1, jsonb_build_object('researchSessionId', 'seed-rs-trusts'), null
from generate_series(1, 18) i;
insert into seed_rows
select now() - interval '3 days' + interval '6 minutes' + (i * 9 || ' seconds')::interval, 'search', 'research.phase2.linkedin', 'basic',
  'site:linkedin.com/in/ "Example Person ' || i || '"', null, 1, true, 200, null, 800, 3, 1, jsonb_build_object('researchSessionId', 'seed-rs-trusts'), jsonb_build_object('maxResults', 3)
from generate_series(1, 4) i;
insert into seed_rows
select now() - interval '3 days' + interval '10 minutes' + (i * 6 || ' seconds')::interval, 'search', 'research.phase3', 'basic',
  'verify trust claim ' || i, null, 1, true, 200, null, 950, 3, 1, jsonb_build_object('researchSessionId', 'seed-rs-trusts'), jsonb_build_object('maxResults', 3)
from generate_series(1, 6) i;

-- Keep in Drive on the trusts run, 2 days ago.
insert into seed_rows
select now() - interval '2 days' + (i * 4 || ' seconds')::interval, 'extract', 'research.keep-in-drive', 'basic', null,
  array['https://example.org/trusts/source-' || i], 1, true, 200, null, 2000, 1, 1, jsonb_build_object('researchSessionId', 'seed-rs-trusts'), null
from generate_series(1, 14) i;

-- Opening source summaries: a route, so no surrounding context.
insert into seed_rows
select now() - (i * 37 || ' hours')::interval, 'extract', 'research.source-summary', 'basic', null,
  array['https://example.com/article-' || i], 1, true, 200, null, 1800, 1, 1, '{}'::jsonb, null
from generate_series(1, 15) i;

-- The tavily_search tool in chat.
insert into seed_rows
select now() - (i * 3 || ' days')::interval - interval '2 hours', 'search', 'tool.tavily_search', case when i = 2 then 'advanced' else 'basic' end,
  'tavily: latest on ' || (array['rail strikes','school holiday dates','ev charger grants','ofsted framework','planning reform'])[i],
  null, case when i = 2 then 2 else 1 end, true, 200, null, 1300, 8, 1,
  jsonb_build_object('conversationId', 'seed-conv-' || i, 'jobId', 'seed-job-' || i), jsonb_build_object('maxResults', 8)
from generate_series(1, 5) i;

-- A refused first attempt and its successful retry, twice.
insert into seed_rows
select now() - (d || ' days')::interval + interval '6 hours', 'search', 'workflow.tavily-search', 'basic', 'ofsted inspection news',
  null, 1, a = 2, case when a = 1 then 429 else 200 end, case when a = 1 then 'Tavily search failed: 429 rate limited' end,
  case when a = 1 then 300 else 950 end, case when a = 2 then 5 end, a,
  jsonb_build_object('workflowId', 'seed-wf-news', 'runId', 'seed-run-news-' || d, 'nodeId', 'search-2'),
  jsonb_build_object('maxResults', 5, 'topic', 'news', 'days', 1)
from (values (5), (17)) as t(d), generate_series(1, 2) a;

-- The key test on /admin/ai/keys.
insert into seed_rows values
  (now() - interval '20 days', 'search', 'admin.key-test', 'basic', 'test connection', null, 1, true, 200, null, 700, 1, 1, '{}'::jsonb, jsonb_build_object('maxResults', 1));

insert into agent_actions (action_type, provider, tool_name, session_id, duration_ms, status, error, created_at, input)
select 'tavily_call', 'tavily', kind,
  coalesce(ambient ->> 'researchSessionId', ambient ->> 'runId', ambient ->> 'jobId'),
  ms, case when ok then 'completed' else 'failed' end, case when ok then null else err end, at,
  jsonb_strip_nulls(jsonb_build_object(
    'app', case when purpose = 'workflow.tavily-search' then 'workflows' else 'main' end,
    'host', 'seed', 'purpose', purpose, 'depth', depth,
    'credits', case when ok then credits else 0 end, 'attempt', attempt,
    'query', query, 'urls', to_jsonb(urls), 'urlCount', cardinality(urls),
    'options', options, 'httpStatus', http, 'resultCount', results
  )) || ambient
from seed_rows;

commit;
