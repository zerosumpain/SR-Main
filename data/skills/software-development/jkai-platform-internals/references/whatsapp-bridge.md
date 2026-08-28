# WhatsApp Bridge Architecture

## Topology

The web app does NOT run its own Baileys WhatsApp client. It is **delegated**:
outbound sends POST to a separate process that owns the session.

That process is `packages/jkai-wa-worker`, and since 2026-08-24 it runs on the
**VPS**, beside the web app — not on homeserv, and not inside the retired agent
gateway that used to hold the session.

```
VPS (strangeserv)
  ├─ SvelteKit WhatsApp service
  │    ├─ WHATSAPP_BRIDGE_URL=http://127.0.0.1:3110
  │    └─ Every outbound send → POST /send to the worker
  └─ jkai-wa-worker.service  (JKAI_SERVICE_ROLE=whatsapp)
       └─ owns the Baileys socket + session
```

**Why a separate process:** a deploy restarts the web app, and restarting it
drops the socket. The worker survives deploys — proven three times.

**Port 3110, not 3100.** 3100 is held on the VPS by a long-running `bun`
process, and the first deploy of the worker crash-looped on `EADDRINUSE`. The
port is set in the VPS `.env`, NOT in the unit file: `ci-apply-sidecars.sh`
reinstalls units from the repo on every deploy and would revert a unit edit.

## The worker's HTTP contract

| Route | Method | Notes |
|---|---|---|
| `/health` | GET | `{status, connectedNumber, queueLength}` |
| `/qr` | GET | `{status, qr}` — the pairing code when one is waiting |
| `/send` | POST | `{chatId, message}` |
| `/typing` | POST | `{chatId}` |
| `/send-media` | POST | **501** — deliberately not implemented |

`/send-media` refuses rather than silently accepting: the old bridge took a
`filePath` that never existed on its own filesystem, so VPS-originated media
sends have never worked. Failing loudly is the improvement.

## Session

The session belongs to a **bot** WhatsApp account, not John's personal number.
The worker sends FROM the bot number TO John's.

**Pairing lives at `/admin/connections/whatsapp`.** That page polls
`/api/admin/whatsapp/qr`, which proxies to the worker's `/qr` and renders the
code. Before the session moved onto the worker there was nowhere on the site to
scan a QR, which is fine right up until the day you need one.

## Diagnostic: "Message shows `sent: true` but didn't land"

1. **Check the worker is alive** (on the VPS):
   ```bash
   curl -s http://127.0.0.1:3110/health
   ```
   Expected: `{"status":"connected","connectedNumber":"…","queueLength":0}`

2. **A reachable worker answers 200 while LOGGED OUT.** `res.ok` is not the
   check — read `status` from the body. A dead session shows green to anything
   that only tests the HTTP status.

3. **If the status is not `connected`,** re-pair at
   `/admin/connections/whatsapp`. A logged-out session needs a QR scan; no
   restart of anything fixes it.

4. **Send a direct test through the worker:**
   ```bash
   curl -s -X POST http://127.0.0.1:3110/send \
     -H 'Content-Type: application/json' \
     -d '{"chatId":"<JOHN_WHATSAPP_MSISDN>@s.whatsapp.net","message":"test from worker"}'
   ```

5. **Check `node_executions` for the run:**
   ```bash
   ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
     "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -t -c \"
       SELECT ne.output_data->>'messageId' as msg_id,
              ne.output_data->>'sent' as sent,
              ne.output_data->>'error' as err,
              ne.output_data->>'suppressed' as suppressed
       FROM node_executions ne
       WHERE ne.run_id = '<run_id>' AND ne.node_id = '<whatsapp_node_id>';\""
   ```
   `sent: true` with a messageId means the worker accepted and acknowledged it —
   the fault is on the WhatsApp side (dropped session, wrong number, delivery
   failure).

## Delegation is ONE rule

A process must never decide it is delegated from the bridge URL alone. The
worker reads the SAME `EnvironmentFile` as the web app, so a URL-only check
makes it forward its sends **to itself**.

The rule lives in `ownsWhatsAppSession()` (`$lib/workflows/service-role`), and
`tests/lib/workflows/delegation-rule.test.ts` greps for a second site that
forgets it. That test exists because the defect WAS a second site: outbound
worked while inbound went nowhere, because one caller wired the bridge and the
other never wired the OrchestratorBridge.

## Restoring the bridge URL (if accidentally removed)

Without `WHATSAPP_BRIDGE_URL`, the web app boots its OWN Baileys client instead
of delegating. That will almost certainly log out the live session.

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38
sudo chattr -i /opt/strange-rambling-svelte/.env
echo 'WHATSAPP_BRIDGE_URL=http://127.0.0.1:3110' >> /opt/strange-rambling-svelte/.env
sudo chattr +i /opt/strange-rambling-svelte/.env
sudo systemctl restart strange-rambling-svelte
```

Verify with `journalctl -u strange-rambling-svelte --since '1 min ago' | grep
whatsapp` — it should show `Service booted (delegated → WhatsApp worker)`.

`WHATSAPP_HERMES_BRIDGE_URL` is the old name for the same variable and is still
read as a fallback, so a host that has not been updated keeps working.
