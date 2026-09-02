-- UI fixtures for the daydream rooms on a dev database. Every id and title is
-- prefixed `uiseed-` so the same file's DELETE block removes them exactly, and
-- the briefing-compose test (which reads the LIVE database) is re-run AFTER
-- the delete, never before. Never run on production.
begin;

insert into daydream_places (id, lat, lon, radius_m, label, kind, source, visit_count, distinct_days, median_dwell_mins, status, suggested_label, suggested_address)
values
  ('uiseed-p-home',   54.5204, -1.5723, 200, 'Home',            'home',  'confirmed', 122, 40, 600, 'active', null, null),
  ('uiseed-p-school', 54.5150, -1.5600, 200, 'St Aidan''s',     'school','confirmed',  38, 19,  25, 'active', null, null),
  ('uiseed-p-unk1',   54.5300, -1.5500, 200, null,              'unknown','inferred',  9,  5,  35, 'active', 'Costa', 'Costa, Northgate, Darlington'),
  ('uiseed-p-unk2',   54.5100, -1.5900, 200, null,              'unknown','inferred',  4,  4,  50, 'active', 'The Rink', 'Rink, Darlington'),
  ('uiseed-p-quiet',  54.5000, -1.6000, 200, null,              'unknown','inferred',  1,  1,  12, 'active', null, null),
  ('uiseed-p-road',   54.5400, -1.5400, 200, null,              'unknown','inferred',  6,  3,   3, 'transit', null, null);

insert into daydream_thoughts (id, kind, title, explanation, narrative, verified, score, components, evidence, dedupe_key, status, suppressed_reason, channel, delivered_at, feedback, feedback_source, relevance, review_verdict, review_likelihood, review_reasoning, place_id, recurrence_count, created_at)
values
  -- musings
  ('uiseed-t-01','musing_health','uiseed Recovery is the stronger signal today','Recovery 44 against a 7-day mean of 61 while strain stayed flat.','Your recovery has dropped well below its recent average while strain held steady — worth an easy day.',true,0.78,'{"raw":0.78,"kindWeight":1.0}','[{"kind":"features","id":"recovery7"},{"kind":"whoop-recovery","id":"2026-09-01"}]','musing:uiseed-01','delivered',null,'whatsapp',now()-interval '3 hours',null,null,null,'verified',0.91,'Both cited rows exist and say what the musing says.',null,1,now()-interval '3 hours'),
  ('uiseed-t-02','musing_money','uiseed Two Canva charges in one week','Two spend rows name Canva within four days.','Canva appears to have charged twice this week.',true,0.71,'{"raw":0.71,"kindWeight":1.0}','[{"kind":"spend","id":"uiseed-s1"},{"kind":"spend","id":"uiseed-s2"}]','musing:uiseed-02','suppressed','refuted_by_review',null,null,null,null,null,'refuted',0.05,'The two rows are one PayPal payment and its email receipt on the same date.',null,3,now()-interval '1 day'),
  ('uiseed-t-03','musing_family','uiseed A clear window before school resumes','No diary entries Thursday afternoon and everyone home.',null,null,0.63,'{"raw":0.63,"kindWeight":1.0}','[{"kind":"calendar","id":"uiseed-c1"},{"kind":"family","id":"katie"}]','musing:uiseed-03','new',null,null,null,null,null,4,null,null,null,null,1,now()-interval '5 hours'),
  ('uiseed-t-04','musing_plans','uiseed Family commitments cluster at the end of August','Four events in three days, none on the other twelve.',null,null,0.66,'{"raw":0.66,"kindWeight":1.0}','[{"kind":"calendar","id":"uiseed-c2"}]','musing:uiseed-04','suppressed','below_threshold (0.66 < 0.686)',null,null,null,null,null,'uncertain',0.5,'The cited events could not be retrieved.',null,1,now()-interval '2 days'),
  ('uiseed-t-05','musing_health','uiseed Sleep debt after late outings','Three nights under six hours followed three late returns home.',null,null,0.7,'{"raw":0.7,"kindWeight":1.1}','[{"kind":"features","id":"sleep7"},{"kind":"memory-theme","id":"uiseed-m1"}]','musing:uiseed-05','archived',null,null,null,'useful','explicit',5,'verified',0.88,'Trail and sleep rows agree.',null,1,now()-interval '4 days'),
  -- mail
  ('uiseed-t-06','mail_security','uiseed Six account-security mails from four senders','Burst: 6 mails, 4 senders, 48 hours.',null,null,0.8,'{"raw":0.8,"kindWeight":1.0}','[{"kind":"intel-note","id":"uiseed-n1"},{"kind":"intel-note","id":"uiseed-n2"}]','mail:burst:security:uiseed','delivered',null,'whatsapp',now()-interval '20 hours','useful','explicit',null,'verified',0.93,'All six retrievable and security-classified.',null,6,now()-interval '20 hours'),
  ('uiseed-t-07','mail_official','uiseed A letter from HMRC','One official sender, subject mentions self assessment.',null,null,0.6,'{"raw":0.6,"kindWeight":1.0}','[{"kind":"intel-note","id":"uiseed-n3"}]','mail:uiseed-n3','suppressed','feed_only',null,null,null,null,null,null,null,null,null,12,now()-interval '6 hours'),
  ('uiseed-t-08','mail_money_admin','uiseed Payment failed at SecondSim','Same notice on four days from one sender.',null,null,0.55,'{"raw":0.55,"kindWeight":1.0}','[{"kind":"intel-note","id":"uiseed-n4"}]','mail:uiseed-n4','suppressed','feed_only',null,null,null,null,null,null,null,null,null,4,now()-interval '3 days'),
  -- places
  ('uiseed-t-09','unknown_place','What is this place you keep going to?','5 visits over 5 days, usually mid-morning, 35 minutes.',null,null,0.72,'{"raw":0.72,"kindWeight":1.0}','[{"kind":"place","id":"uiseed-p-unk1"}]','unknown_place:uiseed-p-unk1','new',null,null,null,null,null,null,null,null,null,'uiseed-p-unk1',5,now()-interval '8 hours'),
  ('uiseed-t-10','unknown_place','What is this place you keep going to?','4 visits over 4 days, evenings, 50 minutes.',null,null,0.69,'{"raw":0.69,"kindWeight":1.0}','[{"kind":"place","id":"uiseed-p-unk2"}]','unknown_place:uiseed-p-unk2','new',null,null,null,null,null,null,null,null,null,'uiseed-p-unk2',4,now()-interval '9 hours'),
  ('uiseed-t-11','unknown_place','What is this place you keep going to?','19 visits, weekday afternoons.',null,null,0.8,'{"raw":0.8,"kindWeight":1.0}','[{"kind":"place","id":"uiseed-p-school"}]','unknown_place:uiseed-p-school','actioned',null,'chat',now()-interval '10 days',null,'action',null,null,null,null,'uiseed-p-school',19,now()-interval '10 days'),
  -- graph
  ('uiseed-t-12','intel_missing_link','uiseed Card *6878 and NatWest credit card ending 6878 are probably connected','Two entities share an identifier suffix.',null,null,0.61,'{"raw":0.61,"kindWeight":1.0}','[{"kind":"intel-entity","id":"uiseed-e1"},{"kind":"intel-entity","id":"uiseed-e2"}]','intel:uiseed-1','new',null,null,null,null,null,null,'verified',0.9,'Same account.',null,1,now()-interval '30 hours'),
  ('uiseed-t-13','intel_unlikely_relation','uiseed Unexpected: Family Presence Monitor ↔ York','A workflow and a place co-occur in one note.',null,null,0.58,'{"raw":0.58,"kindWeight":1.0}','[{"kind":"intel-entity","id":"uiseed-e3"}]','intel:uiseed-2','delivered',null,'whatsapp',now()-interval '2 days','not_useful','explicit',1,null,null,null,null,1,now()-interval '2 days'),
  -- patterns
  ('uiseed-t-14','free_window','uiseed A free Thursday afternoon','No events 13:00–17:00 and nobody out.',null,null,0.7,'{"raw":0.7,"kindWeight":1.0}','[{"kind":"calendar","id":"uiseed-c3"}]','free_window:2026-09-04','new',null,null,null,null,null,null,null,null,null,null,2,now()-interval '1 hour'),
  ('uiseed-t-15','pattern_break','uiseed Not at the school run today','Usually there at 15:20 on a Tuesday; not today.',null,null,0.74,'{"raw":0.74,"kindWeight":1.0}','[{"kind":"place","id":"uiseed-p-school"},{"kind":"trail","id":"uiseed-tr1"}]','pattern_break:uiseed-p-school:2026-09-02','delivered',null,'whatsapp',now()-interval '26 hours',null,null,null,'verified',0.86,'Trail confirms.',
   'uiseed-p-school',1,now()-interval '26 hours'),
  ('uiseed-t-16','context_meets_health','uiseed Short sleep before a long diary day','Sleep 5h10 before a day with four meetings.',null,null,0.52,'{"raw":0.52,"kindWeight":0.9}','[{"kind":"features","id":"sleep1"},{"kind":"calendar","id":"uiseed-c4"}]','context_meets_health:sleep:2026-09-01','suppressed','kind_cooldown',null,null,null,null,null,null,null,null,null,1,now()-interval '30 hours'),
  ('uiseed-t-17','correlation_probe','uiseed More steps on days at the office','Steps 11k vs 6k across 12 matched days.',null,null,0.6,'{"raw":0.6,"kindWeight":1.0}','[{"kind":"features","id":"steps30"}]','correlation_probe:uiseed:2026-W36','dismissed',null,'chat',now()-interval '6 days','not_useful','explicit',2,null,null,null,null,1,now()-interval '6 days'),
  -- rules
  ('uiseed-t-18','rule_driven','uiseed Rule: out late, low recovery next day','Fired on 2 of the last 7 days.',null,null,0.65,'{"raw":0.65,"kindWeight":1.0}','[{"kind":"features","id":"recovery1"}]','rule:uiseed:2026-09-01','suppressed','min_gap',null,null,null,null,null,null,null,null,null,2,now()-interval '18 hours');

commit;

-- DELETE block — run after the screenshots, then re-run the gate.
-- delete from daydream_thoughts where id like 'uiseed-%';
-- delete from daydream_places where id like 'uiseed-%';
