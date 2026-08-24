# Reusable Workflow Patterns

Battle-tested DAG topologies for common automation needs. Copy and adapt — don't reinvent.

---

## 1. Cron-Polling New-Item Detector (Cursor + Conditional Gate)

**Use when:** A cron schedule polls an external source and you need to detect genuinely *new* items (not re-process the same ones every tick). Applies to: calendar events, emails, HA state changes, web feed items, any append-only data source.

**DAG shape:**

```
trigger (cron) ──┬──→ data-source node (e.g. icloud-cal, gmail-search, http-request)
                 ├──→ HA / context fetch (if cross-referencing)
                 └──→ data-store GET cursor
                              │
                              ▼
                     code-execute (diff + enrich)
                        │           │
                        ▼           ▼
                  data-store SET   conditional (hasNew?)
                                        │ true
                                        ▼
                                     llm-call (correlate)
                                        │
                                        ▼
                                     whatsapp / email
```

**Key design decisions:**

- **Three parallel branches from trigger** feed into `code-execute`: (a) the polled data source, (b) any context needed for correlation, (c) the data-store cursor of previously-seen IDs.
- **data-store SET always fires** (not gated by conditional). This ensures the cursor advances even when there are no new items — prevents re-processing on the next tick.
- **conditional gates the expensive LLM call.** On ~95% of ticks (no new items), the workflow stops after the SET. Only genuinely new items trigger the LLM + notification chain.
- **code-execute does the diff logic** — compares incoming item IDs against the stored cursor array, produces `{ hasNew: bool, allIds: string[], newItemsText: string, contextText: string }`.
- **data-store SET uses `valuePath: "result.allIds"`** to persist the full updated ID list for the next tick.

**Cursor considerations:**
- Store IDs as a JSON array, not a single scalar — the cursor grows over time.
- For bounded sources (calendar events expire), periodically trim old IDs in the code-execute logic (e.g. drop UIDs older than 7 days) to prevent unbounded growth.
- `data-store` values are workflow-scoped — each workflow has its own independent store.

**Config for data-store GET:**
```json
{ "operation": "get", "key": "seen_item_uids" }
```

**Config for data-store SET:**
```json
{ "operation": "set", "key": "seen_item_uids", "valuePath": "result.allIds" }
```

**Existing implementations on this site:**
- Family-presence-monitor (VPS `75bd5bc5-...`) — detects presence changes via HA person entities
- icloud-event-monitor design (this session) — detects new calendar events
- nhc-cyclone-monitor (`9fcdcf2f-...`) — cron-based detector of NOAA National Hurricane Center active tropical cyclones, keeping track of "seen" storms via workflow data-store and alerting on new ones in real-time.

---

## 2. HA Batch Entity Fetch via render_template

**Use when:** You need state from multiple HA entities at once (e.g. all `person.*` entities for family location). Instead of N separate `home-assistant` → `query_state` nodes, use a single `render_template` call that outputs JSON.

**Why not N parallel query_state nodes into a merge?** The merge node uses `Object.assign` across all upstream outputs. If all N nodes output `{data: {...}, success: true}` (same keys), last-writer-wins — only the last node's data survives. The other N-1 outputs are silently lost. Use batch render_template instead.

**Array-style template (loop over a domain):**
```json
{
  "operation": "render_template",
  "template": "{% for s in states.person %}{\"id\":\"{{ s.entity_id }}\",\"name\":\"{{ s.name }}\",\"state\":\"{{ s.state }}\",\"lat\":{{ s.attributes.latitude | default('null') }},\"lon\":{{ s.attributes.longitude | default('null') }}}{% if not loop.last %},{% endif %}{% endfor %}"
}
```

**Dict-style template (named entities, often cleaner):**
```json
{
  "operation": "render_template",
  "template": "{{ { \"fintan\": { \"lat\": state_attr(\"device_tracker.life360_fintan_kelly\", \"latitude\"), \"lon\": state_attr(\"device_tracker.life360_fintan_kelly\", \"longitude\"), \"state\": states(\"device_tracker.life360_fintan_kelly\") }, \"jemima\": { \"lat\": state_attr(\"device_tracker.life360_jemima_kelly\", \"latitude\"), \"lon\": state_attr(\"device_tracker.life360_jemima_kelly\", \"longitude\"), \"state\": states(\"device_tracker.life360_jemima_kelly\") } } | tojson }}"
}
```

This produces `{"fintan": {"lat": 54.5, "lon": -1.5, "state": "not_home"}, "jemima": {...}}` — no need to loop, no array indexing, clean named keys for downstream code-execute.

**Notes:**
- **Output wrapping is `{data: {result: "<json_string>"}}`.** The engine wraps render_template output as `{data: {result: "..."}}` — the Jinja2 output is a JSON **string** inside `input.data.result`, not a parsed object. Downstream `code-execute` must do `json.loads(input["data"]["result"])` (Python) or `JSON.parse(input.data.result)` (JS) to get the actual dict/array.
- The Jinja2 template produces raw JSON — parse it in downstream `code-execute`.
- Entity domain filter (`states.person`) scopes the loop. Use `states.device_tracker` for device trackers, `states.sensor` for sensors, etc.
- `default('null')` handles entities without lat/lon gracefully — produces JSON `null`, not a Jinja error.
- This is server-side rendered in HA — no round-trips per entity. One call, one response.

**Other useful batch templates:**
- All lights and their states: `{% for s in states.light %}{{ s.entity_id }}:{{ s.state }}{% if not loop.last %},{% endif %}{% endfor %}`
- All binary sensors: `{% for s in states.binary_sensor %}{{ s.entity_id }}:{{ s.state }}{% if not loop.last %},{% endif %}{% endfor %}`

---

## 3. Apple Calendar (CalDAV) Node

**Use the `apple-calendar` node type.** It has a config panel with credential-picker and calendar resource-picker — no manual URL discovery needed.

**Credential setup (one-time):**
1. Go to `/admin/integrations` → add new credential
2. Type: `apple-calendar`, Kind: `basic`
3. Username: Apple ID email
4. Password: App-specific password (generated at appleid.apple.com → App-Specific Passwords)

**Node config:**
- **iCloud account** — credential-picker filtered to `apple-calendar` type
- **Calendar** — resource-picker, dynamically lists calendars once account is selected
- **Operation** — list / create / update / delete
- Date range (for list), event details (for create/update), event ID (for update/delete)

**List output:** `events[].id`, `events[].title`, `events[].location`, `events[].start`, `events[].end`, `events[].description`

**⚠ Event ID field is NOT templated.** The update/delete config field for Event ID (`eventId`) is a plain `<input>`, not a `TemplatedInput`. You **cannot** use `{{input.eventId}}` from upstream. To chain list → update/delete in one workflow:
- Use a `code-execute` node to extract the event ID from the list output
- Have the LLM pick the event and include the ID in its response text
- Then use a `transform` or second `code-execute` to parse the LLM response into the `eventId` config

**Programmatic credential creation** (when you can't use `/admin/integrations` UI):
Credentials are stored in `integration_credentials` table, encrypted with AES-256-GCM using `INTEGRATION_CREDENTIALS_KEY` env var. To create one directly via DB:
1. Encrypt the payload JSON with the same AES-256-GCM scheme (`iv:tag:ciphertext` hex format)
2. Insert: `INSERT INTO integration_credentials (id, integration_type, label, kind, payload_enc, metadata, created_at, updated_at) VALUES (gen_random_uuid(), 'apple-calendar', 'Label', 'basic', '<encrypted>', '{}', now(), now())`
3. The `kind` for CalDAV is `basic`; payload is `{ username, password }`

**Under the hood:** `tsdav` (CalDAV client) + `ical.js` (iCal parser). The executor and adapter need specific import styles — see `jkai-node-builder` → `references/codegen-import-pitfalls.md` if regenerating.

---

## 4. Tavily Search on Cron Workflows (Date-Scoped + Domain Diversity)

**Use when:** A cron workflow uses a `tavily-search` node to fetch news/intelligence daily. Without precautions, Tavily returns the same top-ranked article every run, producing near-identical briefings.

**The problem:** Tavily ranks by relevance score, not recency. A static query like `"UK government civil service digital transformation education data strategy 2026"` will reliably surface the same high-scoring article (often a broad overview piece from Jan 2026 with score 0.87) on every daily tick. The LLM downstream then writes the same 4 bullets about GDS milestones, 2030 funding reform, workforce capability, and data sharing — repackaged with slightly different wording each day.

**Real example:** `canvas:generated-workflow` (daily 7:30am executive briefing) returned the same Global Government Forum article as the #1 result for 4+ consecutive days. The LLM output was thematically identical each day despite different wording.

**DAG shape (before and after):**

```
# BEFORE — static query, stale results
trigger (cron) → tavily-search → llm-call → whatsapp
                     ↑ static query

# AFTER — date-scoped query + dedup
trigger (cron) → tavily-search (query with date) → transform (dedup) → llm-call → whatsapp
                     ↑ dynamic date                      ↑ exclude seen URLs
```

**Fixes (layer, apply all three for daily news workflows):**

1. **Date-scope the query.** Include the current month/year in the Tavily query string so Tavily biases towards recent content. Use the Tavily `topic` parameter set to `"news"` instead of `"general"` (default) for freshness bias. If the node supports `fromDate`/`toDate` parameters, set them to the last 24–48 hours.

2. **Exclude over-dominant domains.** If one domain keeps winning (e.g. `globalgovernmentforum.com`), add it to `excludeDomains` in the Tavily config. This forces result diversity.

3. **Dedup seen article URLs in a transform/code-execute node.** Use `workflow_data_store` to persist a set of seen article URLs. Before passing results to the LLM, filter out any URLs already seen in the last 7 days.

**Tavily node config improvements for daily workflows:**
```json
{
  "query": "UK government civil service education data strategy {{date}}",
  "searchDepth": "advanced",
  "topic": "news",
  "maxResults": 8,
  "excludeDomains": ["globalgovernmentforum.com"],
  "includeAnswer": true
}
```

**Key Tavily search parameters:**
- `topic: "news"` — biases towards recent articles (much better than default `"general"` for daily workflows)
- `searchDepth: "advanced"` — broader search (already default on most configs here)
- `excludeDomains: ["..."]` — block domains that dominate results
- `days` / `fromDate` / `toDate` — time-range scoping (check current node schema for availability)
- `maxResults: 8` (or higher) — more candidates means the LLM can pick diverse topics even after dedup

**LLM prompt tip:** Tell the LLM to skip articles it's already seen or that are more than 7 days old. Include a rule like: "Skip any article published before the last 7 days. If all results are stale, say 'No new developments today' rather than rehashing old news."

---

## 5. Dedupe Node for New-Item Detection (Simpler Alternative to Pattern 1)

**Use when:** A cron workflow polls a data source and you want to detect only genuinely *new* items, but you don't need custom diff logic. The built-in `dedupe` node replaces manual `data-store GET → code-execute diff → data-store SET` with a single node.

**DAG shape:**

```
trigger (cron) → data-source node → dedupe → conditional (newCount > 0)
                                                 │ true
                                                 ▼
                                              llm-call → whatsapp / email
```

The `dedupe` node handles seen-set storage and lookup automatically. By default it uses `recordMode: 'downstream-success'`, meaning new IDs are only committed to the persistent seen-set if the *entire run* finishes successfully — so a failed send does not mark items as already-processed.

**Nodes:**

| Node | Type | Config |
|------|------|--------|
| Dedupe new items | `dedupe` | `{ "itemsPath": "<path-to-array-in-input>", "idPath": "<unique-field-per-item>", "storeKey": "<workflow-unique-key>", "maxRemembered": 2000, "recordMode": "downstream-success" }` |
| Has new items? | `conditional` | `{ "expression": "input.newCount > 0" }` |

**Dedupe node config fields:**

- `itemsPath` — dot-path to the array in `input` (e.g. `transactions`, `results.items`). Auto-detects the first top-level array if omitted.
- `idPath` — dot-path to the unique identifier within each item (e.g. `transaction_id`, `id`, `url`). Falls back to `.id` or `.url` if omitted.
- `storeKey` — workflow-scoped data-store key for the persistent seen-set. Default: `seen_ids`.
- `maxRemembered` — max IDs to retain in the seen-set (default 500, set higher for 7-day windows).
- `recordMode` — `downstream-success` (default via engine, defers commit until run completes) or `immediate` (atomic claim with row lock, for concurrent-run safety where retry-after-failure is acceptable).

**Dedupe node outputs:**

| Output | Type | Description |
|--------|------|-------------|
| `items` | array | Only the items *not* seen in a previous run |
| `newCount` | number | Length of `items` |
| `seenCount` | number | Number filtered out as already seen |
| `allItems` | array | The original, unfiltered array (passthrough) |

**Conditional gate:** Wire the conditional with `expression: "input.newCount > 0"`. Connect the `"true"` handle to the LLM/notification chain. Nothing connected to `"false"` → the workflow stops silently when there's nothing new.

**LLM prompt considerations:** The LLM receives `input.items` (not the original `input.transactions` or similar). Update your user prompt template to reference `{{input.items}}`. Example:

```
New transactions since the last report. For each, include:
• Merchant — amount — date
• Card type
• Category and a short guess

{{input.items}}
```

**When to prefer the manual data-store approach (Pattern 1) instead of dedupe:**
- You need custom dedup logic (merge by partial match, fuzzy dedup, composite keys)
- You need to trim stale IDs from the cursor on each tick
- You need the seen-set advanced even on partial-run failure (not downstream-success mode)
- You need to share the seen-set across multiple workflows

**When the dedupe node is better:**
- Simple exact-match dedup by a single field (transaction_id, article URL, event UID, etc.)
- You want automatic retry-on-fail (items not marked seen until the send succeeds)
- Fewer nodes, less config, no custom diff code

**Existing implementations on this site:**
- `canvas:daily-spend-summary` (this workflow, `1ad993d4-...`) — dedupes NatWest bank transactions by `transaction_id` across a rolling 7-day window with `downstream-success` mode.

### Dedupe node pitfalls

**1. downstream-success + empty LLM response = lost items forever.**
When the dedupe uses `recordMode: "downstream-success"` (default), new IDs are
committed to the persistent seen-set only after the entire run completes. But a
run where the LLM returns empty (model failure, not a node error) still has
status `completed` — the engine sees no thrown errors. The deferred IDs get
committed, and those items are never re-processed. The user sees no notification
and the items are gone from future runs.

Timeline of the 2026-08-02 incident:
1. First run: dedupe found 35 new transactions, downstream-success deferred
2. LLM (glm-5.1) returned `response: ""` despite 3000 completion tokens
3. WhatsApp node received empty message, `sent: false`
4. Run completed with status `completed` (no errors)
5. Engine committed all 35 IDs to the seen-set
6. Every subsequent run showed `newCount: 0` — items are lost

Fix chain: clear the dedupe store (or change storeKey) AND switch the LLM model
to a reliable one before re-running.

**2. workflow_clear_data_store refused in unattended MCP context.**
The MCP tool requires an owner browser session to confirm the destructive
action. When it's refused, workaround: change the dedupe node's `storeKey`
config to a fresh value (e.g. `append -v2`) to start with an empty seen-set.
The old key's data remains in the store but is never read again.

**3. Conditional branch with no "false" edge = silent stop.**
When the conditional `expression: "input.newCount > 0"` evaluates to false and
there is no edge from the `"false"` handle, the workflow stops silently at the
conditional node. Downstream nodes stay `pending` (never executed). This is the
desired behavior for "nothing to report, stay quiet" — but can be confusing
during debugging. Confirm by checking that the conditional node completed and
the LLM node is `pending`.

---

## 6. Financial Spend Summary (Rolling Week + Dedupe + LLM Classification)

**Use when:** You have bank transaction data via Open Banking (TrueLayer) and
want a daily WhatsApp summary of new spend, categorised with per-item details
and a guess for each transaction.

**DAG shape:**

```
trigger (cron 0 20 * * *)
  -> Get accounts (api-call: truelayer /data/v1/accounts)
  -> Get cards (api-call: truelayer /data/v1/cards)
  -> Label accounts (transform: extract json.results -> { accounts })
  -> Label cards (transform: extract json.results -> { cards })
  -> Extract IDs + dates (transform: find current account, find 2 cards,
     set from/to to rolling 7-day window)
      -> Current account txns (api-call: truelayer /data/v1/accounts/{{id}}/transactions)
      -> Card 1 txns (api-call: truelayer /data/v1/cards/{{id}}/transactions)
      -> Card 2 txns (api-call: truelayer /data/v1/cards/{{id}}/transactions)
      -> Label each txn list (3 transforms: extract -> { txnsCurrent, txnsCard1, txnsCard2 })
        -> Flatten transactions (transform: concat 3 arrays -> { transactions, count })
          -> Dedupe transactions (dedupe: by transaction_id, storeKey spend-summary-seen-v2)
            -> Has new spend? (conditional: input.newCount > 0)
              -> true: LLM (classify + format) -> WhatsApp
              -> false: silent (no edge)
```

**Key nodes:**

| Node | Type | Config highlights |
|------|------|------------------|
| Extract IDs + dates | `transform` | 7-day window: `new Date(now - 7*24*60*60*1000)` |
| Dedupe transactions | `dedupe` | `itemsPath: "transactions"`, `idPath: "transaction_id"`, `storeKey: "spend-summary-seen-v2"`, `maxRemembered: 2000`, `recordMode: "downstream-success"` |
| Has new spend? | `conditional` | `expression: "input.newCount > 0"` |
| Categorise & format | `llm-call` | `model: "deepseek/deepseek-v4-flash"` (not default glm), NO maxTokens |

**LLM prompt (system):**
```
You produce terse WhatsApp financial summaries for John. These are NEW
transactions since the last report (unseen before).

For EACH transaction, include:
. Merchant name - amount (pound sign) - date
. Card type (Current/MASTERCARD *8936/MASTERCARD *6878)
. Category: (emoji) Essential / (emoji) Optional / (emoji) Less necessary / (emoji) Transfer
. A short guess of what it was for (e.g. "weekly shop", "Netflix sub", "petrol")

Classification rules: Essential = bill, loan repayment, insurance,
supermarket/grocery, energy, council tax, mobile/broadband, transport.
Optional = eating out, coffee, Amazon/shopping, subscriptions (AI tools,
streaming, gaming), travel, entertainment.
Less necessary = PayPal spend, eBay, competitions/lottery, non-sterling fees,
bike parts.
Transfers = money moved between John's own accounts or to family.

Skip duplicate card-payment entries (a 'Direct Debit Payment' or 'NATWEST'
line in the current account that just pays the credit card balance).

Format:
(new emoji) New spend - {Day} {date}
(green emoji) Essential (pound sign)X
  . Tesco (pound sign)42.50 - weekly shop
  . British Gas (pound sign)85 - direct debit
(yellow emoji) Optional (pound sign)X
  . Amazon (pound sign)27.99 - Claude sub
(white emoji) Transfers (pound sign)X
  . Monzo (pound sign)200 - pocket money

Ignore incoming credits (money in). Keep it under 15 lines, terse, no intro/outro.
```

**LLM prompt (user):**
```
New transactions since the last report (deduped by transaction_id).
Classify, add a guess for each, and format as WhatsApp:

{{input.items}}
```

**Reference:** The prompt above is saved at `references/financial-spend-prompt.md`
in this skill for easy copy-paste into new canvases.

**Model selection:** Use `deepseek/deepseek-v4-flash` explicitly. The OpenRouter
default (`z-ai/glm-5.1`) returns empty responses on long-context structured
prompts (observed: 9310 prompt tokens, 3000 completion tokens, `response: ""`).

**Credential setup:** TrueLayer OAuth credentials stored in the JKai secret
vault as `truelayer-oauth` (vault entry with client_id, client_secret,
refresh_token) with a companion `truelayer` (ref source, bearer injection for
api.truelayer.com). If missing, register via the `/admin/ai/apis` UI or seed
the `api_secrets` table directly with an AES-256-GCM encrypted payload.
