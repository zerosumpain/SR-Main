# Darlington train request: tool-routing review

Status: reviewed the user-supplied production trace and final answer, plus reproduced independent routing defects against the deployed registry.

Production reports release `f8fd0e534fd593bb013e8bbcbd29b47c7e22c53c`, matching the source examined. The supplied trace is `46c94e48-4c8e-4337-a9df-30bc4a42bd56`, for the FOLLOW-UP “What about the Darwin integration”, not the original question. The original turn's call count and answer remain outside this trace.

## What the actual trace establishes

Six calls spanned 46.262 seconds. Their recorded execution durations total 3.174 seconds; 43.088 seconds elapsed between tool executions. This is model/orchestration time, not proven provider latency.

| Step | Call | Finding |
| --- | --- | --- |
| 1 | `api_integration_list(detail:true)` | Finds the existing verified National Rail integration among seven entries. Reasonable discovery on this follow-up. |
| 2 | `api_integration_call` with DAR, ten rows and 120-minute window | Correct saved operation returns HTTP 200, the correct station, a fresh timestamp and a notice, but no service lists. |
| 3 | `evidence_read` | Recovers exactly the same 1,079-character complete response; no hidden rows exist. Its prior tool result was not truncated. |
| 4 | `api_search` | Rediscovers an API already identified in steps 1–2 and returns unrelated UK APIs too. |
| 5 | Raw `api_call` to `GetDepartureBoard` | Guesses another operation under the arrivals-and-departures product path. It fails with HTTP 500 `messaging.runtime.RouteFailed`. This proves that request failed, not that the working saved integration was broken. |
| 6 | Repeat saved call with blank `filterType` | Removes an explicit default from the URL; the provider still returns `filterType:to`. No materially different evidence is obtained. |

The model's unsupported diagnosis was “partial Darwin integration/API-route failure”. Its refusal to invent a train was appropriate, but the explanation of missing service rows was not established.

National Rail's [LDBWS documentation](https://lite.realtime.nationalrail.co.uk/OpenLDBWS/documentation.aspx) explicitly permits absent or empty service lists. `areServicesAvailable:true` is not a count or a promise of matching rows. The flag's false state can suppress a board, for example because a station is closed. `filterType` concerns a destination/origin filter; it does not select departures versus arrivals, and defaults to `to`.

At 04:34 BST, a 120-minute window with default zero offset covers approximately 04:34–06:34. An empty early-Sunday window is a plausible normal result. The trace does not prove either the next departure time or an outage. The useful next action was a documented later-window or timetable lookup, followed by clear separation of timetable and live-running information. None of steps 3–6 checked a later time window.

The whole question cannot be declared solved in two calls when the first window is empty. Two calls suffice to discover and read this board; obtaining the actual next train can legitimately need one documented fallback.

## Reproduction

An isolated Vitest probe loaded the actual 196-tool registry and called the deployed resolver with:

> What is the next train leaving Darlington?

Its three candidates were:

1. `apple_calendar_list`
2. `datastore_list_collections`
3. `health_training_load`

Searching `train Darlington departures` returned `health_training_load`, `route_plan`, `route_target_suggest`, and `skill_view`. The answer contract was `{depth:"brief", needsReview:false}`.

This is a resolver reproduction, not a replay of the user's model turn. Other always-on tools and classifier-selected toolsets can still make API integrations available to the model.

## Confirmed findings

1. **Saved integrations are absent from initial candidate ranking.** Chat passes `getTools()` to the resolver; the individual integrations stored in the database are not those registered tool definitions. The resolver sees a generic `api_integration_call`, not the train operation's name, description or parameters. Source: `src/lib/workflows/chat/general-chat.ts:993`.
2. **Substring matching creates wrong-domain candidates.** `name.includes(word)` and `text.includes(word)` equate `train` with `training`. Generic words such as `is` also remain in the query. A low positive score is sufficient for inclusion, with no minimum evidence of a domain match. Source: `src/lib/jkai/grounding/capabilities.ts:9`.
3. **Integration discovery still requires extra model work.** `api_integration_list` has no query filter and returns the entire register. Its default response gives parameter names and locations, while full specifications require `detail:true`. The initial router supplies neither a relevant integration key nor its parameter contract. Source: `src/lib/workflows/site-tools/tools/api-integrations.ts:72`.
4. **Integration parameters remain weakly validated.** Central validation checks that `params` is an object. `callIntegration` then iterates declared parameters, ignores undeclared supplied keys and uses defaults for missing declared ones. A misspelled station parameter can therefore be ignored if a default exists. This did not cause the supplied follow-up: it passed the correct `crs:DAR`. Sources: `src/lib/workflows/site-tools/tools/api-integrations.ts:251`, `src/lib/apis/integrations.ts:383`.
5. **Short live-data answers bypass the final verifier.** Review selection depends on request wording/depth, so this time-sensitive query gets no support/coverage assessment. Unknown assessments are also excluded from quality cohorts, leaving this class of failure outside that feedback signal. Sources: `src/lib/jkai/grounding/answer.ts:4`, `src/lib/jkai/grounding/quality.server.ts`.
6. **The routing tests were inadequate.** The earlier fixtures use four invented descriptions, including an `api_integration_call` description that already says PayPal. The deployed generic tool does not contain each saved integration's domain. Those tests verified the ranking function without validating the real capability inventory. Source: `src/lib/jkai/grounding/routing-eval.test.ts`.

## Additional integration-contract issue

`computeOutputs` permits an output expression to return `undefined`; JSON serialization then silently drops that named output. A successful HTTP response is marked verified even if an advertised output is missing. The trace advertises `services` but returns no `values.services`. For optional Darwin service arrays, the adapter should normalize documented absence to an empty list, expose the exact query window and classify the result as an empty window. Required-data failures should be a separate outcome. Evidence recovery should be suggested for actual clipping or pagination, not merely because a result has a recovery handle.

Source: `src/lib/apis/integrations.ts:462`, `src/lib/apis/integrations.ts:482`.

## Required correction

- Rank saved integration metadata alongside registered tools; supply the winning integration's key, full argument contract and execution tool in the first model request.
- Use token-aware matching, proper stop words and a confidence threshold. An uncertain match must remain uncertain rather than preload unrelated tools.
- Validate supplied arguments against each integration's declared parameters, with explicit errors for unknown keys and explicit reporting of applied defaults.
- For live departures, require a fresh departure-board result and validate station, date/time zone, departure versus arrival, scheduled versus expected time and cancellation status. Answer checks should follow factual risk and freshness requirements, not response length alone.
- Replay this actual trace with recorded provider responses. Verify the answer against those observations and the request timestamp, including overnight/date-boundary cases; a new live board cannot establish what was correct earlier.
- Add a real-registry regression: the Darlington request must surface the saved train integration without calendar, datastore or training detours. Target one integration call when the station identifier is known; allow one justified station-resolution step if needed.

The review above describes the baseline. The implementation now adds shared saved-operation discovery to chat, native discovery, extended MCP discovery and the build tool manifest; token-aware ranking; per-operation parameter validation and repair schemas; explicit response scope, defaults, missing/invalid/empty outputs; optional documented absent-array normalization; and review of brief live/API answers. Evidence recovery no longer creates nested evidence handles.

Tests exercise the actual tool registry and recorded response shapes across rail, billing, weather and calendar fixtures, including a provider dispatch stub. They establish deterministic routing and contract behaviour, not live-model first-call accuracy or what the historical next departure was. No Darwin endpoint or production register record is hard-coded or edited. Legacy missing outputs are conservatively classified as incomplete until their declared optionality is known. Avoiding redundant discovery, unchanged retries and guessed endpoints is enforced by the common behaviour policy, not an unconditional execution ban.

## Validation

Local full-suite run: 839 test files passed, one skipped; 10,037 tests passed, three skipped. Focused extended-discovery tests passed after the explicit lookup-failure response was added. Two real-database evidence tests passed. Structural, schema drift, import boundaries and source footprint gates passed. Type checking reported zero errors (893 pre-existing warnings); CI verifies the final committed tree and builds the release artifact before deployment.

The isolated local preview is `http://127.0.0.1:5275/jkai`. It has no production integration credentials, so provider-independent contract fixtures cover dispatch locally; a production model conversation remains necessary to measure real first-call accuracy and latency. No changes to ports, volumes, database schema or network exposure are part of this patch.
