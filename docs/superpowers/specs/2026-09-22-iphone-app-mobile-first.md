# The iPhone app becomes an iPhone app

**Date:** 2026-09-22 · **Grade:** autonomous (full) · **Repos:** `SR-AppleApp`, `SR-Main`

## The brief

> The Apple app project is working pretty well. We've proven connectivity with
> core site functionality and now I want to better organise the app to mimic and
> extend the capability of the core site. … thoroughly overhaul the application
> UI for the iOS app in a way that suits a mobile first experience.

Three named requirements, plus "up to 10 new capabilities":

1. **Notifications** — toggle whether they arrive by WhatsApp or as native iOS
   notifications.
2. **Health** — a mobile version of `/health`'s key statistics, and a
   notification when they change, no more often than every three hours.
3. **jkai chat** — sized and shaped for mobile. "Headers titles etc aren't in
   keeping with typical mobile interfaces. Simpler clearer journeys and less
   clutter."

## What was actually wrong

The app was not badly built. It was the **website's page furniture transplanted
onto a 390pt screen**, and every individual decision that got it there was
defensible on the web:

- `SRShell` paints an ink bar carrying a URL path — `/jkai`, `/health` — because
  the site's masthead does.
- `SectionHead` opens every screen with a lettered kicker (`A / Threads`), an
  uppercase Archivo Black headline delivered as an **array of hand-broken
  lines**, and a standfirst.
- `SRFooterStrip` closes every scroll with three mono lines.
- The fourth tab was `Connect`: a QR scanner, permanently on the tab bar, for a
  job you do once.

On the thread list that furniture is the entire first screenful. A page can
afford a masthead because a page is tall and the reader arrived from somewhere
else. A phone app is opened to do one thing.

Three defects were found while reading, none of them cosmetic:

- **The transcript did not follow the stream.** It scrolled on
  `messages.count`, which stops changing the instant the assistant bubble
  exists. Every token after that appended to a bubble nothing had scrolled to,
  so a long answer wrote itself off the bottom of the screen.
- **`Font.custom(name:size:)` is a fixed size.** The whole type system ignored
  the reader's Dynamic Type setting — a property the web original had for free,
  because there the same values are `rem`.
- **There was no way to start a thread from the phone.** No create endpoint, so
  the only way into chat was a conversation somebody had opened at the desk.

## What shipped

### SR-AppleApp — the app

**Four tabs: Today · Chat · Health · News.** `Connect` moved to Settings →
Connections, beside the companion pairing it is constantly confused with.
`Today` took the slot: readiness, four figures, what the site has been trying to
tell you, the thread you were in the middle of, the top three headlines.

**Navigation is the system's.** `NavigationStack`, large titles that collapse on
scroll, `.searchable`, `.refreshable`, swipe actions, context menus, sheets.
A thread is pushed, not presented — a sheet cannot be swiped back from its left
edge, so the only way out was a bar button.

**The design system survives; the furniture does not.** `Design/SRNative.swift`
teaches UIKit the palette once through the appearance proxy, so a screen that
forgets to style itself still comes out cream. The rule: *the SR design system
supplies the paint, UIKit supplies the furniture.*

**The one screen that kept its editorial register** is Settings → Location &
battery. A reader three levels into settings weighing drain against accuracy has
asked for the argument; there, the argument is the content.

### SR-Main — the site half

- `notification_events`, `notification_routes`, `notification_watermarks`.
- `$lib/server/notify` — `notifyOwner()`: one seam, a ledger, and a routing
  table. Writes the row **before** attempting any channel, so an alert WhatsApp
  drops still exists to be read.
- `$lib/server/notify/health-watch.ts` — polls the health fingerprint every
  fifteen minutes; the three-hour floor lives on the category and is enforced
  against the ledger, so the poll costs nothing on a quiet afternoon.
- `$lib/server/native-health.ts` — `/health` sized for a phone, over the
  existing **service lane** to SR-Health. Nothing is recomputed here.
- Five new `/api/native` endpoints: `health/summary`, `notifications`,
  `notifications/routes`, `today`, and create/patch/delete on conversations.
- `intel/notify.ts` and `run-notifications.ts` now route through `notifyOwner`
  instead of calling WhatsApp directly.

## Decision log

| # | Decision | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | How native notifications are delivered | (a) APNs push (b) local notifications pulled on background refresh (c) wait for credentials | **b** | There is no APNs auth key, and the TestFlight lane holds **one** provisioning profile, minted without `aps-environment`. Adding the entitlement fails the archive at signing. Apple-portal access is needed and was not available. | Yes — the server half is channel-agnostic; adding APNs later is a delivery adapter, not a redesign |
| 2 | Whether to hide that limitation | say nothing / say it on the settings screen | **say it** | An alert that arrives two hours late looks like a bug if you were promised push. The screen says the app collects "on the next background refresh" and that anything urgent should stay on WhatsApp | n/a |
| 3 | Tab bar contents | keep 4 as-is / 5 tabs / Today+Chat+Health+News | **Today, Chat, Health, News** | Every tab should be somewhere you go back to. Pairing is setup | Yes |
| 4 | Where health figures come from | recompute in Main / companion pilot server / SR-Health over the service lane | **SR-Health** | The scaling (×100 on steps/strain), the aggregation (MAX not SUM) and the sleep union are all decided there. Recomputing would be re-deciding them silently | Yes |
| 5 | Notification storage | datastore collection (house pattern) / real tables | **real tables** | The phone polls "native and not collected, oldest first" on a seconds-long budget; that wants an index | Yes, small |
| 6 | Rewiring existing WhatsApp senders | leave them / route intel + run outcomes / route everything | **intel + run outcomes** | Those two are the ones a person would actually want to move. Defaults keep both on WhatsApp, so behaviour is unchanged until a switch is flipped | Yes |
| 7 | Widgets / Live Activities / Watch | ship / defer | **defer** | Each needs an extension target with its own bundle id and provisioning profile. One profile exists | Yes, once a second profile is minted |
| 8 | Dark mode | adopt / keep the light lock | **keep** | The site has no dark mode and CI asserts a dark-booted simulator renders light. A dark register is a design project, not a token swap | Yes |
| 9 | Siri sending a question | send it / seed the composer | **seed** | Chat can open gates the phone cannot answer, and a turn sent from a locked phone is a turn you cannot see go wrong | Yes |
| 10 | Deleting a thread from the phone | no / swipe / long press + confirm | **long press + confirm** | It deletes on the website too. Nothing destructive on a swipe | Yes |
| 11 | Verifying Swift without a Mac | trust CI / install a Linux toolchain on porkserv for `swiftc -parse` | **both** | The macOS runner is ~20 min at a 10x billing multiplier and this change is ~4,000 lines of new Swift. Parse-only catches the brace, not the type error — half a compiler for a two-minute loop | Yes |

## Known gaps, stated rather than hidden

- **No push.** Blocked on an APNs auth key and a re-minted provisioning profile
  (decision 1).
- **No widgets, Live Activities, Watch app or share extension.** Blocked on a
  second provisioning profile (decision 7).
- **`/jkai` has no per-thread deep link,** so "open on the web" from a thread
  opens the hub. Adding `?conversation=` to the page's loader is a separate
  change in SR-Main's SPA.
- **Notification routing has no web UI.** The phone is the only place to change
  it; the API is `/api/native/notifications/routes`.

## Verification

- Swift: `./scripts/swift-parse.sh` (porkserv, `swiftc -parse` over every
  source) then the macOS CI job — `xcodegen` + `xcodebuild test` on a simulator
  booted in dark appearance, exporting screenshots as the look's real artefact.
- SR-Main: `./scripts/gate-remote.sh`, then CI, then a live check of
  `/api/native/health/summary` behind a device token.
- The UI tests were rewritten around the new information architecture and assert
  the old tabs are **gone**, not merely unused.
