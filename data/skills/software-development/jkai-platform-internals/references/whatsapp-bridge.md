# WhatsApp Bridge Architecture

## Topology

The VPS does NOT run its own Baileys WhatsApp client. WhatsApp outbound from VPS
workflows is **delegated** to a Hermes bridge running on **homeserv** over
Tailscale:

```
VPS (strangeserv)
  └─ SvelteKit WhatsApp service
       ├─ WHATSAPP_HERMES_BRIDGE_URL=http://homeserv.tail668b8c.ts.net:3000
       └─ Every outbound send → POST /send to homeserv bridge
```

The bridge on homeserv runs as a standalone Node process:

```
/home/john/hermes-agent/scripts/whatsapp-bridge/bridge.js
  --port 3000
  --session /home/john/.hermes-jkai/whatsapp/session
  --mode bot
```

## Bridge Session

The bridge maintains its own WhatsApp session, separate from John's personal
number. As of 2026-08-07:

| Field | Value |
|-------|-------|
| `me.id` | `447353522861:6@s.whatsapp.net` |
| `registered` | `false` |

The registered number `447353522861` is a **bot WhatsApp account**, not John's
personal number `<JOHN_WHATSAPP_MSISDN>`. The bridge sends messages FROM this bot number
TO John's number. The `registered: false` flag means pairing was done via a
code rather than QR registration — this is normal for bot-mode Baileys
sessions.

## Diagnostic: "Message shows `sent: true` but didn't land"

1. **Check the bridge is alive on homeserv:**
   ```bash
   curl -s http://localhost:3000/health
   ```
   Expected: `{"status":"connected","queueLength":0,"uptime":...}`

2. **Check Tailscale reachability from the VPS:**
   ```bash
   ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
     "curl -s --connect-timeout 3 http://homeserv.tail668b8c.ts.net:3000/health"
   ```

3. **Check the bridge session number:**
   ```bash
   python3 -c "import json; d=json.load(open('/home/john/.hermes-jkai/whatsapp/session/creds.json')); print('me:', d.get('me',{}).get('id','unknown')); print('registered:', d.get('registered','unknown'))"
   ```
   If the `me.id` is not a bot number you recognise, or the `registered` flag
   is false with no known reason, the session may need re-pairing.

4. **Send a direct test message through the bridge:**
   ```bash
   curl -s -X POST http://localhost:3000/send \
     -H 'Content-Type: application/json' \
     -d '{"chatId":"<JOHN_WHATSAPP_MSISDN>@s.whatsapp.net","message":"test from bridge"}'
   ```
   If this returns `{"success":true,"messageId":"..."}` but the user doesn't
   receive it, the WhatsApp session on homeserv is either disconnected or
   logged out — `curl /health` will still say `"connected"` if the Node
   process is running, even if the underlying Baileys socket has dropped.

5. **Check node_executions for the run** (needs VPS SSH):
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
   If `sent: true` with a messageId but the user didn't see it, the bridge
   accepted and acknowledged the message — the issue is on the bridge side
   (disconnected session, wrong number, or WhatsApp delivery failure).

## Restoring the Bridge URL (if accidentally removed)

If `WHATSAPP_HERMES_BRIDGE_URL` is removed from the VPS `.env`, the SvelteKit
WhatsApp service boots its OWN Baileys client instead of delegating to
homeserv. This will:

1. Attempt to connect using the VPS's local auth data at
   `data/whatsapp-auth/` (last updated May 2026).
2. Almost certainly **log out the stale session** — the VPS auth data is
   months old and the Baileys credentials have likely expired.
3. Clear the session files and require a fresh QR pairing.

**To restore the bridge URL after removal:**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38
sudo chattr -i /opt/strange-rambling-svelte/.env
echo 'WHATSAPP_HERMES_BRIDGE_URL=http://homeserv.tail668b8c.ts.net:3000' >> /opt/strange-rambling-svelte/.env
sudo chattr +i /opt/strange-rambling-svelte/.env
sudo systemctl restart strange-rambling-svelte
```

Verify with `journalctl -u strange-rambling-svelte --since '1 min ago' | grep
whatsapp` — should show `Service booted (delegated → Hermes bridge)`.

## MCP Tool Inconsistency with VPS Workflows

**Observed behaviour (2026-08-07):** `workflow_list` returns VPS production
workflows (including their cron schedules and descriptions), but
`workflow_inspect` and `workflow_run` on the same workflow IDs return
`"Workflow not found"`.

This means the MCP bridge (`https://strangeramblings.com/api/mcp`) returns
different results for different tools — `list` apparently queries a superset
(or caches differently) than `inspect` and `run`.

**Workaround:** For VPS workflow modifications (node configs, edges,
schedules), use SSH + SQL directly:

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -t -c \"SELECT ...\""
```

For triggering runs, the MCP `workflow_run` tool does NOT work either —
update the `next_run_at` in `workflow_schedules` (to a valid cron match time),
restart the service, and wait for the scheduler tick.