---
name: jkai-money
description: "PayPal, transactions, receipts, payments, invoices, subscriptions, refunds, statements, bank and card charges — look a payment up on the payment rail via api_integration_call, never by searching email."
version: 0.1.0
metadata:
  routing:
    tags: [jkai, money, paypal, truelayer, bank, card, transactions, receipts, payments, invoices, subscriptions, refunds, billing]
    related_skills:
      - jkai-general
      - financial-planning
---

# jkai Money

## Identity

You route **"what was that payment?"** questions to the **payment rail**, not to
the inbox. That is the whole job of this skill.

For anything beyond a lookup — spend analysis, subscription audits, merchant
mappings, UK tax, SIPP/ISA planning, deploying a monthly finance workflow —
load `financial-planning`, which carries the endpoints, response shapes and
quirks.

## The rule

> A named merchant, a card charge, a subscription, a refund or a mystery
> payment is answered from **transaction data**. Email is the fallback, used
> only when the purchase was made on a rail that is not connected.

**Start with `api_integration_list`.** It is an essential tool — directly
visible, no `jkai_extended` round-trip — and it tells you what is already
recorded and callable. Then `api_integration_call` with the key it gives you.

Known rails (confirm with `api_integration_list`; keys drift, this list does not
update itself):

- **`paypal-transactions`** — PayPal Transaction Search.
- **TrueLayer** (UK Open Banking) — bank accounts and cards; see
  `financial-planning` for the account/card split and the NatWest caveat.

`api_secrets_list` shows which credentials you are allowed to use without ever
seeing them. If a rail is missing a credential, `request_credential` opens the
secure form — **never ask John to paste a key into the chat.**

## Why this skill exists

On **2026-08-16** John asked which VPN company he had paid through PayPal.
The turn opened by loading the Gmail skill and ran **fourteen Gmail searches**
across three turns, producing one confidently wrong answer (ExpressVPN, from a
2018 receipt) and one "there is no such transaction". He then said *"i said
check paypal"* — and a single `api_integration_call({ key:
"paypal-transactions" })` returned the answer: **Mullvad VPN AB, €5.00, 14
August**.

The transaction was reachable in one call the entire time. The failure was
routing, not capability.

## Shape of a lookup

1. `api_integration_list({ detail: true })` — what rails exist.
2. `api_integration_call({ key: "paypal-transactions", params: { start_date, end_date, … } })`.
   PayPal caps a query at a **31-day window** — split a longer range rather
   than letting the call fail.
3. Answer with the merchant, amount, date and rail. **Name the source**, so a
   null result means something: "nothing on PayPal in that window" is a
   different statement from "nothing anywhere".

New transactions can take up to ~3 hours to appear on PayPal. If John says he
paid minutes ago and nothing shows, say that rather than concluding it does not
exist.

## When to yield

- Spend analysis, budgets, tax, pensions, renewals → `financial-planning`.
- A receipt that genuinely only exists as an email (a purchase on an
  unconnected rail) → `jkai-gmail`, *after* the rails have come back empty, and
  say that is what you are doing.
- Recurring finance reporting → `jkai-scheduled` or a canvas workflow.

## Common pitfalls

- **Searching email first.** It is the reflex this skill exists to break. Email
  holds receipts a merchant chose to send; the rail holds every payment.
- **Concluding "no transaction" from a mailbox.** A Gmail search proves
  something about Gmail. Say which source you checked.
- **Guessing a merchant from an old receipt.** A recurring charge from 2018 is
  not evidence about a purchase made three days ago. Check the date before
  offering a name.
- **Asking for a key in chat.** Use `request_credential` / `update_credential`.
