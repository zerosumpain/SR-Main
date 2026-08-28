# Building a new API integration, end to end

When there is no integration and no catalogued API for what the user needs,
build one. This is expected of you, not an escalation.

1. **Research** the API's docs (`web_fetch` the reference page, or a web
   search) — find the exact endpoint, the auth style, and the response shape.
2. **`api_secrets_list`** — check whether the owner already holds a credential
   bound to that host.
3. **`api_register`** the API: `name`, `baseUrl`, `docsUrl`, `capabilities`,
   `tags`, and the `auth` handle if one applies.
4. **`api_integration_save`** the exact operation, with `params` and —
   importantly — **named `outputs`**: single expressions over `json` that turn
   the response into the numbers a person actually asked for, e.g.
   `{"name":"remaining","expr":"json.data.total_credits - json.data.total_usage","unit":"USD"}`.
   Good outputs are what make the integration reusable in a workflow.
5. **`api_integration_test`** — prove it returns real data. A pass marks it
   verified and stores the evidence shown in the register. If it fails, fix the
   path/params and test again; don't record something you haven't seen work.
6. **Answer the question**, and mention in one clause that you've saved it for
   next time.

Write operations (POST/PUT/PATCH/DELETE) need `confirmWrite: true` and change
data on someone else's system — confirm with the user before running one.

## Where an integration shows up afterwards

Integrations you record appear for the owner at **/admin/ai/apis** and as a
dropdown in the **"API integration"** canvas node, so a recorded call can be
wired into a scheduled workflow with no code.

When the user asks for something like *"WhatsApp me when X drops below Y"*, the
shape is: schedule trigger → `api-integration` node → `conditional` on
`input.values.<output>` → `whatsapp` node. Make sure the integration exists and
is verified first, then build the workflow.

## Scope verification, in full

Before presenting an API-sourced figure as "the answer", verify what scope the
data covers. The most common failure: calling a **per-key** or **per-session**
endpoint and reporting the result as account-wide — then getting called out
when the user knows their actual usage is higher.

**Rule of thumb:** if there are two endpoints — a scoped one (current key /
session) and an aggregate one (account / total) — call *both* if you can.
Compare them. If they disagree, the gap is the answer. If you can only reach
the scoped one, caveat it explicitly: *"This figure covers only API key X —
your account total includes other keys and may be higher."*

When you can't verify scope:

1. Say what you know and what you don't — don't silently present a partial
   figure.
2. If the API secret is scoped to specific paths (e.g. `/api/v1/credits` but
   not `/api/v1/activity`), note the limitation openly and suggest the next
   step (management key, admin UI, tracking going forward).
3. If the user pushes back, drop into investigation mode — don't defend the
   figure. Check for other API keys, other auth handles, or account-level
   endpoints.
