# jkai PWA — Design

**Date:** 2026-05-31
**Scope:** Add an installable, offline-capable Progressive Web App scoped to `/jkai` and `/jkai/builds` inside the existing `strange_rambling_svelte` SvelteKit app.
**Primary target:** iPhone home-screen install.

## Goals

- Tap the home-screen icon → standalone window with chat, no browser chrome.
- Read recent conversations and recent builds with no network.
- Compose messages and notes offline; queue them locally; flush automatically when back online.
- Receive push notifications for jkai build completion and approval gates (in addition to existing WhatsApp continuation, not instead of it).
- Stay flexible: trivial to expand scope to other `/jkai/*` routes, add more runtime caches, add more queued action types, and add new push trigger types.

## Non-goals (v1)

- Background Sync API / Periodic Sync (iOS does not implement them; foreground sync covers the use case).
- Replacing WhatsApp continuation (parallel channels by design).
- Offline support for `/jkai/canvas`, `/jkai/channels`, `/jkai/intel`, `/jkai/prompts`, `/jkai/research` (out of scope; design leaves room to add later).
- Web Share Target, File System Access, Background Fetch.
- Native iOS app wrapper.

## Architecture

### Plugin

`@vite-pwa/sveltekit` (same plugin used by `~/offline-maps/`).

```ts
// vite.config.ts (additions)
SvelteKitPWA({
  registerType: 'autoUpdate',
  injectRegister: false,            // we register the SW manually in the jkai layout
  scope: '/jkai/',
  filename: 'jkai-sw.js',
  manifest: {
    id: '/jkai/',
    name: 'jkai',
    short_name: 'jkai',
    description: 'jkai chat hub',
    scope: '/jkai/',
    start_url: '/jkai',
    display: 'standalone',
    theme_color: '#0a0a0a',           // match SR brand mark
    background_color: '#f4ede4',      // match warm-brutalist parchment
    orientation: 'portrait',
    icons: [
      { src: '/jkai-pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/jkai-pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/jkai-pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  },
  workbox: {
    navigateFallback: '/jkai',
    navigateFallbackDenylist: [/^\/(?!jkai\/?)/],   // never intercept non-jkai navs
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/api/jkai/conversations'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'jkai-conversations-api', expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 } }
      },
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/api/jkai/builds'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'jkai-builds-api', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 } }
      },
      {
        urlPattern: ({ request }) => request.method !== 'GET',
        handler: 'NetworkOnly'           // never cache mutations
      }
    ]
  }
})
```

### Registration

SW must only register when the user is on `/jkai/*`, so visitors to the blog never install a jkai service worker.

`src/routes/jkai/+layout.svelte` adds:

```svelte
<svelte:head>
  <link rel="manifest" href="/jkai-manifest.webmanifest" />
  <meta name="theme-color" content="#0a0a0a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="jkai" />
  <link rel="apple-touch-icon" href="/jkai-pwa/icon-192.png" />
</svelte:head>
```

And `onMount` imports a tiny `registerSW` helper (`$lib/jkai/pwa/register.ts`) so the SW is only requested when actually on a jkai route. Visitors who land on `/jkai/foo` and bounce never have a long-lived SW installed beyond Workbox's first registration call.

### Display-mode detection

`$lib/jkai/pwa/displayMode.ts` exports a derived `isStandalone` based on `window.matchMedia('(display-mode: standalone)').matches` and `navigator.standalone` (iOS quirk). Used to gate push-permission prompt and to add a slightly different layout (no top nav back-link) when running standalone.

## Offline storage (IndexedDB via `idb`)

New module `src/lib/jkai/pwa/db.ts` opens a database named `jkai-pwa@1` with these stores:

| Store | Key | Value shape | Purpose |
| --- | --- | --- | --- |
| `conversations` | `id` (string) | `{ id, title, modelProvider, modelId, updatedAt, summary }` | Sidebar list |
| `messages` | `[conversationId, id]` | `{ id, conversationId, role, body, attachments, createdAt }` | Conversation transcripts |
| `builds` | `id` | `{ id, title, status, createdAt, planSummary }` | Builds sidebar |
| `buildDetail` | `id` | `{ id, plan, logs, outputs, fetchedAt }` | Full build page |
| `outbox` | `id` (uuid) | `{ id, type, payload, createdAt, attempts, lastError? }` | Queued mutations |
| `drafts` | `id` (uuid) | `{ id, body, sourceConversationId?, updatedAt }` | Local notes |
| `meta` | `key` | `{ key, value, updatedAt }` | Per-store last-sync timestamps, etc. |

`outbox.type` is one of `'sendMessage'` initially. The generic `{type, payload}` envelope means future offline actions (e.g. `'startBuild'`, `'promoteDraft'`) drop in without a schema migration.

Cache budget: keep the **last 50 conversations** (sorted by `updatedAt` desc) + their messages, and **last 30 builds** (sorted by `createdAt` desc) + details. Eviction runs at the end of every successful sync and removes both the parent record and its child rows (e.g. evicting a conversation also deletes its messages).

## Offline UX

### Banner
`src/lib/components/jkai/OfflineBanner.svelte` — sticky top banner inside the jkai layout. Visible when `navigator.onLine === false` or when the last sync attempt failed. Text:
- Offline: "Offline — new messages will send when you reconnect."
- Failed sync: "Couldn't reach jkai. Tap to retry." (tap triggers manual sync)

### Send-while-offline
`ChatArea.svelte` send handler delegates to `$lib/jkai/pwa/outbox.ts#enqueueMessage(conversationId, body, attachments)` whenever `!navigator.onLine` or a POST fails with a network error. The message bubble renders with a clock icon and `aria-label="queued"`; once flushed it transitions to the normal sent state in place (same id). Attachments larger than 5 MB are rejected with an explicit error and never enqueued.

### Drafts
`src/lib/components/jkai/DraftsPanel.svelte` — collapsible section in the conversation sidebar titled "Drafts (n)". Each draft row shows the first line and updated time, with "Resume", "Send", "Discard" actions. New-draft button at the top. Drafts persist across reloads via the `drafts` store and never auto-send; "Send" turns the draft into an `outbox` `sendMessage` entry against the active or a new conversation.

### Builds offline
`src/routes/jkai/builds/+page.svelte` and `[id]/+page.svelte` read from IndexedDB first via `$lib/jkai/pwa/db.ts` (synchronous-feeling: load cached, then `await` network refresh and merge). If both fail (no cache, offline), render the standard offline empty state.

## Sync manager (foreground)

`src/lib/jkai/pwa/syncManager.ts` exports:

```ts
export async function syncAll(opts?: { force?: boolean }): Promise<SyncReport>
export function startAutoSync(): () => void   // returns dispose
```

`startAutoSync` registers listeners on the `window`/`document`:
- `online` → `syncAll()`.
- `visibilitychange` → if `visible`, `syncAll()` (debounced 2 s).
- Periodic safety net: `setInterval(syncAll, 60_000)` while visible (cleared on hide).

`syncAll` is idempotent. Sequence:
1. Flush outbox in `createdAt` order. Each entry retried up to 5 attempts with exponential backoff (handled at sync-call granularity, not in a `setTimeout` loop). After 5 fails the entry is marked `lastError` and surfaced in the offline banner ("1 message stuck — open"). User can manually retry or discard.
2. Refresh `conversations` index. Diff against IndexedDB; upsert.
3. If a conversation is currently open, refresh its messages.
4. Refresh `builds` index. If a build detail is open, refresh that too.
5. Run eviction (trim to budgets).
6. Write `meta.lastSyncAt`.

Returns a `SyncReport` `{flushed, failed, refreshed, durationMs}` for telemetry / UI feedback.

## Push notifications

### Schema (Drizzle)
Add to `src/lib/server/db/schema.ts`:

```ts
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull()
});
```

Migration via `npx drizzle-kit push`.

### Server
- `src/lib/server/push.ts` exports `notifyUser(userId: string, payload: PushPayload)` which fans out to all of the user's subscriptions via `web-push`. Failures with HTTP 404/410 cause that subscription row to be deleted.
- VAPID keys come from `.env`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto string). `web-push generate-vapid-keys` produces them; document in repo README.
- Endpoints:
  - `POST /api/push/subscribe` — accepts `{endpoint, keys: {p256dh, auth}}`, upserts on `endpoint`. Requires authed session.
  - `POST /api/push/unsubscribe` — accepts `{endpoint}`, deletes the row if it belongs to the user.
  - `POST /api/push/test` — sends a "Test from jkai" notification to the calling user's subscriptions; for debugging only, gated by `NODE_ENV !== 'production'` OR `?devkey=` matching `PUSH_TEST_KEY`.

### Triggers (v1)
Wire `notifyUser` into:
- jkai-builder sidecar completion event → `{title: 'Build complete', body: <build title>, url: '/jkai/builds/<id>'}` on success; `{title: 'Build failed', body: <error>, url: '/jkai/builds/<id>'}` on failure.
- jkai job approval gate (plan-before-execute, confirmation gate) → `{title: 'Approval needed', body: <gate label>, url: '/jkai?c=<convId>'}`.

WhatsApp bridge calls remain in place. Both channels emit in parallel.

### Client
- `src/lib/jkai/pwa/push-client.ts` exports `subscribeToPush()` and `unsubscribeFromPush()`. Permission prompt is initiated only after detecting `isStandalone === true` AND `Notification.permission === 'default'`, surfaced via `PushOptInCard.svelte` shown once at the top of the jkai sidebar (dismissible; dismissal persisted in `localStorage` key `jkai.pushOptInDismissed`).
- Service worker handles `push` event with `self.registration.showNotification(title, {body, data: {url}, icon: '/jkai-pwa/icon-192.png', badge: '/jkai-pwa/icon-192.png'})`. Click handler focuses an existing client at `data.url` or opens one.

### iOS quirks acknowledged
- Push only works after "Add to Home Screen" and only from inside the standalone window.
- iOS requires the `Notification.requestPermission()` call to be made from a user gesture inside the standalone PWA — `PushOptInCard` ensures this.
- No silent push.

## Auth

Existing Google OAuth via Auth.js. No changes required:
- Session cookie is `httpOnly`, `secure`, `sameSite=lax` — same-origin standalone PWA gets it for free.
- Service worker uses `fetch` defaults; same-origin → credentials sent.
- 401 from the sync manager → if standalone PWA, show a sign-in prompt in the offline banner that opens `/auth/signin` in the standalone window. Queued outbox entries persist across re-auth.

## Component map

New components in `src/lib/components/jkai/`:
- `OfflineBanner.svelte` — connectivity / stuck-queue banner.
- `DraftsPanel.svelte` — sidebar drafts section.
- `PushOptInCard.svelte` — one-time permission prompt card.
- `QueuedMessageBadge.svelte` — small clock badge for queued message bubbles (used inside existing `MessageBubble.svelte`).

Modified:
- `src/routes/jkai/+layout.svelte` — manifest link, SW register, mount banner, mount opt-in card.
- `src/routes/jkai/+page.svelte` — add DraftsPanel to sidebar, route send through outbox helper.
- `src/routes/jkai/builds/+page.svelte` and `[id]/+page.svelte` — IndexedDB-first read.
- `src/lib/components/jkai/ChatArea.svelte` — queued state rendering, send helper change.

## Data flow

```
[user types message]
        │
        ▼
ChatArea.send()
        │  online?
        ├── yes ──> POST /api/jkai/messages ──> on success, update IndexedDB messages store
        └── no ───> outbox.enqueueMessage()  ──> render as queued bubble

[visibilitychange | online | interval]
        │
        ▼
syncManager.syncAll()
        ├── flush outbox (POST each)
        ├── refresh conversations index
        ├── refresh open conversation messages
        ├── refresh builds index
        ├── refresh open build detail
        └── evict to budgets
```

## Flexibility hooks (explicit, per requirement)

- `scope` and `runtimeCaching` are configuration arrays — add more `/jkai/*` routes or `/api/jkai/*` endpoints by appending entries.
- `outbox.type` is an open enum; new offline-only actions (e.g. `'startBuild'`, `'promoteDraft'`, `'archiveConversation'`) plug in via a new branch in the `flushEntry` switch — no schema change.
- `notifyUser` is the single push entry point; new trigger types are one-line callsite additions.
- Cache budgets (`50`, `30`) are constants in `db.ts` for easy tuning.
- Display-mode-aware layout already in place, so a future "phone vs desktop PWA" split has a hook.

## Testing

### Unit (Vitest)
- `db.ts` — open, upsert, eviction.
- `outbox.ts` — enqueue, dequeue, retry policy.
- `syncManager.ts` — orchestration, idempotency, failure surfacing. Network mocked via `vi.fn`.
- `push-client.ts` — happy path subscribe/unsubscribe; permission denied path.

### Integration (Vitest + jsdom)
- `OfflineBanner.svelte` behavior under `navigator.onLine` flips.
- `DraftsPanel.svelte` create / resume / discard.

### E2E (Playwright)
- Loading `/` (homepage) does NOT register a jkai service worker; `navigator.serviceWorker.getRegistrations()` empty after page idle.
- Loading `/jkai` registers the service worker scoped to `/jkai/`.
- Manifest link present on `/jkai` and on `/jkai/builds`, absent on `/`.
- Offline simulation: messages queued show clock icon; back online flushes within 5 s.

### Manual on-device (iPhone)
Documented checklist in spec § Acceptance below; cannot be automated.

## Acceptance criteria

1. From iPhone Safari on `https://strangeramblings.com/jkai`, "Add to Home Screen" produces an icon labelled `jkai` with the SR monogram.
2. Tapping the icon opens jkai in a standalone window (no Safari chrome).
3. Switching the iPhone to airplane mode, opening jkai, then:
   - Recent conversation list still renders.
   - Tapping a recent conversation still shows its messages.
   - Tapping `/jkai/builds` still shows the last 30 builds.
   - Typing a message and sending it shows a queued state with a clock icon.
   - Creating a draft from the sidebar persists across PWA reopen.
4. Re-enabling network and reopening (or moving the app to foreground) flushes the queued message within 5 s of being visible.
5. After granting notification permission inside the standalone PWA, a server-fired `notifyUser` push lands on the lock screen and, when tapped, opens the standalone PWA on the linked URL.
6. Visiting `https://strangeramblings.com/` (root) in Safari does NOT register a service worker — verified by checking `navigator.serviceWorker.getRegistrations()` returns an empty array.

## Files to create / modify

**Create:**
- `static/jkai-pwa/icon-192.png`
- `static/jkai-pwa/icon-512.png`
- `static/jkai-pwa/icon-maskable-512.png`
- `src/lib/jkai/pwa/db.ts`
- `src/lib/jkai/pwa/outbox.ts`
- `src/lib/jkai/pwa/syncManager.ts`
- `src/lib/jkai/pwa/displayMode.ts`
- `src/lib/jkai/pwa/register.ts`
- `src/lib/jkai/pwa/push-client.ts`
- `src/lib/server/push.ts`
- `src/lib/components/jkai/OfflineBanner.svelte`
- `src/lib/components/jkai/DraftsPanel.svelte`
- `src/lib/components/jkai/PushOptInCard.svelte`
- `src/lib/components/jkai/QueuedMessageBadge.svelte`
- `src/routes/api/push/subscribe/+server.ts`
- `src/routes/api/push/unsubscribe/+server.ts`
- `src/routes/api/push/test/+server.ts`
- Vitest tests in `src/lib/jkai/pwa/__tests__/`
- Playwright spec in `tests/e2e/jkai-pwa.spec.ts`

**Modify:**
- `vite.config.ts` — add `SvelteKitPWA(...)`. Note `manifestFilename` / `filename` option names vary between `@vite-pwa/sveltekit` releases; confirm against the installed version before wiring.
- `package.json` — add `@vite-pwa/sveltekit`, `vite-plugin-pwa`, `workbox-window`, `idb`, `web-push`, `@types/web-push`.
- `.env` (and `.env.example`) — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_TEST_KEY`.
- `src/lib/server/db/schema.ts` — `pushSubscriptions` table.
- `src/routes/jkai/+layout.svelte` — manifest, SW register, banner, opt-in card.
- `src/routes/jkai/+page.svelte` — DraftsPanel, outbox-aware send.
- `src/routes/jkai/builds/+page.svelte` and `[id]/+page.svelte` — IndexedDB-first read.
- `src/lib/components/jkai/ChatArea.svelte` / `MessageBubble.svelte` — queued state rendering.
- Wire `notifyUser` into:
  - jkai-builder completion handler (sidecar event handler in main app).
  - Orchestrator approval-gate emit path.

## Open considerations (call out, not blockers)

- **Auth-cookie SW expiry race:** If the SW serves a cached `/jkai` shell while the user's session has expired, the shell loads but the first API call 401s. Sync manager handles this by surfacing the sign-in prompt in the banner. Acceptable.
- **Multi-tab interference:** Standalone PWA + open browser tab on `/jkai` will both run sync. Sync is idempotent so this is safe but does double network. Not addressing in v1; if it bites, a `BroadcastChannel` leader election can be added.
- **`registerType: 'autoUpdate'`** means updates ship silently on the next navigation after a deploy. If a user is mid-conversation when a deploy lands they may see a short flash on next nav. Acceptable per existing offline-maps behaviour.
