-- UI fixtures for the one daydream feed (spec 2026-09-25, P2) on a SCRATCH
-- database. Every id is prefixed `uiseed-` so the DELETE block at the end
-- removes exactly these. Never run on production, and never on the shared dev
-- database: a disposable pgvector container is the intended target.
begin;

-- Re-runnable: a QA run rates notes, so start from the same state each time.
delete from daydream_thoughts where id like 'uiseed-n-%';
delete from heartbeat_actions where id = 'uiseed-a-think';

insert into heartbeat_actions (id, name, description, kind, cadence_seconds, status, source)
values ('uiseed-a-think', 'daydream-think', 'The think loop (seed)', 'targeted', 2700, 'active', 'system')
on conflict (name) do nothing;

insert into heartbeat_pulses (action_id, ts, outcome, summary, details)
select id, now() - interval '25 minutes', 'ok',
       'health × correlate · 5 tool calls · 1 note (1 new) · 1 sent · audit dropped 0',
       '{"channel":"health","outcome":"correlate","slot":1}'::jsonb
from heartbeat_actions where name = 'daydream-think';
insert into heartbeat_pulses (action_id, ts, outcome, summary, details)
select id, now() - interval '70 minutes', 'skipped', 'owner active in the last few minutes', null
from heartbeat_actions where name = 'daydream-think';
insert into heartbeat_pulses (action_id, ts, outcome, summary, details)
select id, now() - interval '115 minutes', 'ok',
       'money × money_analysis · 4 tool calls · 1 note (1 new) · audit dropped 0',
       '{"channel":"money","outcome":"money_analysis","slot":0}'::jsonb
from heartbeat_actions where name = 'daydream-think';

insert into daydream_thoughts
  (id, kind, title, explanation, narrative, verified, score, components, evidence, dedupe_key, status, suppressed_reason, channel, delivered_at, feedback, feedback_source, note, created_at)
values
  ('uiseed-n-01', 'think_correlate',
   'Late chats cost you about 19 minutes of deep sleep',
   'Read 3 cards: health_series({"metric":"deep_sleep","days":30}) · chat_threads({"days":30}) · correlate({"a":"last_chat_hour","b":"deep_sleep"})',
   E'On the 9 nights your last jkai thread was after 23:30, deep sleep averaged 52 minutes against 71 on the other 21 (Spearman r = -0.48, n = 30, p = 0.007).\n\nNext: stop chatting at 23:00 for a week and see whether the gap closes.',
   true, 1, '{"audited":1,"raw":1,"kindWeight":1}',
   '[{"kind":"think-card","id":"health_series:[[\"metric\",\"deep_sleep\"]]@2026-09-25"},{"kind":"think-card","id":"chat_threads:[]@2026-09-25"},{"kind":"think-question","id":"health","note":"health × correlate"}]',
   'think:correlate:uiseed-late-chats', 'delivered', null, 'push', now() - interval '25 minutes', null, null, null, now() - interval '25 minutes'),
  ('uiseed-n-02', 'think_money_analysis',
   'Canva renewed at £119.99, up from £109.99 last year',
   'Read 2 cards: spend({"merchant":"canva","days":400}) · mail_facts({"sender":"canva"})',
   E'The annual Canva Pro charge on 24 September was £119.99; the same line on 24 September 2025 was £109.99, a 9% rise with no notice in the mail facts.\n\nNext: check whether you still use Pro features, or drop to the free plan before next September.',
   true, 1, '{"audited":1,"raw":1,"kindWeight":1}',
   '[{"kind":"think-card","id":"spend:[[\"merchant\",\"canva\"]]@2026-09-25"},{"kind":"think-card","id":"mail_facts:[[\"sender\",\"canva\"]]@2026-09-25"},{"kind":"think-question","id":"money","note":"money × money_analysis"}]',
   'think:money_analysis:uiseed-canva', 'actioned', null, 'push', now() - interval '115 minutes', 'useful', 'explicit',
   'Right, and I barely use it now — cancel before renewal.', now() - interval '115 minutes'),
  ('uiseed-n-03', 'think_quality_of_life',
   'The hall thermostat reaches 21°C an hour after you get up',
   'Read 2 cards: ha_get_history({"entity":"climate.hall","days":14}) · health_series({"metric":"wake_time"})',
   'On 11 of the last 14 weekdays the hall reached its 21°C setpoint at about 07:40, while you were up by 06:45. The schedule starts heating at 07:00.',
   true, 1, '{"audited":1,"raw":1,"kindWeight":1}',
   '[{"kind":"think-card","id":"ha_get_history:[[\"entity\",\"climate.hall\"]]@2026-09-25"},{"kind":"think-card","id":"health_series:[[\"metric\",\"wake_time\"]]@2026-09-25"},{"kind":"think-question","id":"home","note":"home × quality_of_life"}]',
   'think:quality_of_life:uiseed-hall', 'suppressed', 'feed_only: daily cap', 'silent', null, null, null, null, now() - interval '5 hours'),
  ('uiseed-n-04', 'think_health_plan',
   'An easier week: two short nights and HRV 12% under its baseline',
   'Read 2 cards: health_hub({"section":"tripwires"}) · health_series({"metric":"hrv","days":28})',
   E'HRV has sat 12% below its 28-day baseline for three days and /health''s sleep tripwire is lit. Mon rest, Tue 30 min zone 2, Wed rest, Thu intervals only if HRV is back within 5%, Fri–Sun easy.\n\nNext: move Thursday''s intervals to Saturday if the tripwire is still lit on Wednesday night.',
   true, 1, '{"audited":1,"raw":1,"kindWeight":1}',
   '[{"kind":"think-card","id":"health_hub:[[\"section\",\"tripwires\"]]@2026-09-24"},{"kind":"think-question","id":"health","note":"health × health_plan"}]',
   'think:health_plan:uiseed-easier-week', 'delivered', null, 'push', now() - interval '1 day 3 hours', null, null, null, now() - interval '1 day 3 hours'),
  ('uiseed-n-05', 'think_suggest',
   'A long essay on Roman water engineering, since you noted the aqueducts',
   'Read 2 cards: research_web_search({"q":"Roman aqueduct engineering gradient"}) · fetch_url({"url":"https://example.org/aqueducts"})',
   'Your notebook has "Roman aqueducts" from August. A new long read explains how the Pont du Gard kept a 1-in-3,000 gradient over 50 km, with survey drawings.',
   true, 1, '{"audited":1,"raw":1,"kindWeight":1}',
   '[{"kind":"think-card","id":"research_web_search:[[\"q\",\"Roman aqueduct engineering gradient\"]]@2026-09-24"},{"kind":"think-question","id":"research","note":"research × suggest"}]',
   'think:suggest:uiseed-aqueducts', 'dismissed', null, 'push', now() - interval '1 day 6 hours', 'not_useful', 'explicit', null, now() - interval '1 day 6 hours'),
  ('uiseed-n-06', 'think_efficiency',
   'Three calendar reminders repeat what the school newsletter already sends',
   'Read 2 cards: diary({"days":14}) · mail_facts({"sender":"school"})',
   'PE-kit, reading-log and dinner-money reminders sit in your diary every Monday, and the school newsletter carries the same three items each Friday.',
   true, 1, '{"audited":1,"raw":1,"kindWeight":1}',
   '[{"kind":"think-card","id":"diary:[[\"days\",14]]@2026-09-23"},{"kind":"think-card","id":"mail_facts:[[\"sender\",\"school\"]]@2026-09-23"}]',
   'think:efficiency:uiseed-reminders', 'suppressed', 'notify: routed to feed', 'silent', null, null, null, null, now() - interval '2 days 4 hours'),
  -- Never on the feed: refuted by the owner's rulings.
  ('uiseed-n-07', 'think_money_analysis', 'Two Canva charges in one week (echo)', 'Read 1 card', 'An echo of a settled claim.',
   true, 1, '{}', '[]', 'think:money_analysis:uiseed-echo', 'suppressed', 'already_refuted (Two Canva charges)', null, null, null, null, null, now() - interval '3 hours');

commit;

-- ── Remove ──────────────────────────────────────────────────────────────────
-- delete from daydream_thoughts where id like 'uiseed-n-%';
-- delete from heartbeat_actions where id = 'uiseed-a-think';
