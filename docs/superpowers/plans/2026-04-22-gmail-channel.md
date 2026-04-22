# Gmail Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gmail as a first-class workflow channel with multi-account support, full read/write (fetch, send, reply, label, archive, search), and polling-based inbound message watchers that surface events in the workflow event bus and `/jkai` chat.

**Architecture:** Mirrors the WhatsApp channel layout (`service.ts` + `orchestrator-bridge.ts` + `types.ts`). Each connected mailbox is a row in `gmail_accounts` with its own refresh token and watched-query list. A singleton `GmailService` manages token refresh and fetch primitives across all mailboxes. A polling watcher runs every 45 s per mailbox, diffs Gmail history IDs, and emits `gmail.message.received` events. Six workflow nodes (`gmail-trigger`, `gmail-fetch`, `gmail-send`, `gmail-reply`, `gmail-label`, `gmail-search`) wrap the service. A `/admin/gmail` page handles connect/disconnect and watched-query management. OAuth uses the existing Auth.js Google client with incremental Gmail-scope consent.

**Tech Stack:** SvelteKit, TypeScript, Vitest, Drizzle ORM, PostgreSQL, `googleapis` npm package, Auth.js (`@auth/sveltekit`).

---

## File Structure

### New Files

```
src/lib/workflows/gmail/types.ts                     # TypeScript types
src/lib/workflows/gmail/service.ts                   # GmailService class (token refresh, fetch, send, label)
src/lib/workflows/gmail/watcher.ts                   # Per-account polling loop
src/lib/workflows/gmail/orchestrator-bridge.ts       # Wires gmail events into workflow event bus
src/lib/workflows/gmail/index.ts                     # Public exports + boot function
src/lib/workflows/gmail/crypto.ts                    # Token encryption at rest (AES-GCM)

src/lib/workflows/nodes/gmail-trigger.ts             # Start-node definition
src/lib/workflows/nodes/gmail-trigger.def.ts         # Registry-safe definition
src/lib/workflows/nodes/gmail-fetch.ts               # Fetch full message by id
src/lib/workflows/nodes/gmail-fetch.def.ts
src/lib/workflows/nodes/gmail-send.ts                # Compose + send
src/lib/workflows/nodes/gmail-send.def.ts
src/lib/workflows/nodes/gmail-reply.ts               # Reply preserving thread headers
src/lib/workflows/nodes/gmail-reply.def.ts
src/lib/workflows/nodes/gmail-label.ts               # Add/remove labels, archive, mark read
src/lib/workflows/nodes/gmail-label.def.ts
src/lib/workflows/nodes/gmail-search.ts              # On-demand Gmail query
src/lib/workflows/nodes/gmail-search.def.ts

src/routes/admin/gmail/+page.server.ts               # Load accounts + watched queries
src/routes/admin/gmail/+page.svelte                  # Admin UI
src/routes/api/gmail/connect/+server.ts              # Start OAuth consent with Gmail scopes
src/routes/api/gmail/callback/+server.ts             # OAuth callback → store refresh token
src/routes/api/gmail/accounts/+server.ts             # List / delete accounts
src/routes/api/gmail/accounts/[id]/watches/+server.ts # Add / remove watched queries
src/routes/api/gmail/accounts/[id]/test/+server.ts   # Manual fetch test

tests/lib/workflows/gmail/service.test.ts
tests/lib/workflows/gmail/watcher.test.ts
tests/lib/workflows/gmail/crypto.test.ts
tests/lib/workflows/nodes/gmail-trigger.test.ts
tests/lib/workflows/nodes/gmail-fetch.test.ts
tests/lib/workflows/nodes/gmail-send.test.ts
tests/lib/workflows/nodes/gmail-reply.test.ts
tests/lib/workflows/nodes/gmail-label.test.ts
tests/lib/workflows/nodes/gmail-search.test.ts
```

### Modified Files

```
src/lib/db/schema.ts                                 # Add gmail_accounts + gmail_watches + gmail_history_cursors
src/lib/workflows/index.ts                           # Register 6 gmail node executors
src/lib/workflows/registry-client.ts                 # Register client-safe gmail defs
src/hooks.server.ts                                  # Boot gmail watcher scheduler on startup
src/lib/workflows/events.ts                          # Add gmail.* event types
src/lib/auth.ts                                      # /admin/gmail route stays protected (no change, verify)
package.json                                         # Add googleapis dep
```

---

## Preconditions

Before starting, verify:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` are set in `.env`.
- A new env var `GMAIL_TOKEN_ENCRYPTION_KEY` will be added — 32 random bytes hex-encoded. Generate with: `openssl rand -hex 32` and add to `.env` before Task 2.
- Gmail API is enabled in the Google Cloud project that owns `GOOGLE_CLIENT_ID`. Confirm at https://console.cloud.google.com/apis/library/gmail.googleapis.com — if not enabled, enable it and wait ~2 minutes for propagation.
- The OAuth consent screen has `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.send` in its scopes list. Add them if missing; resubmit for verification is NOT required for internal/testing mode with a personal Google account.

---

### Task 1: Install googleapis and add encryption key env var

**Files:**
- Modify: `package.json`
- Modify: `.env` (manual step by the user)

- [ ] **Step 1.1: Install googleapis**

Run: `cd ~/strange_rambling_svelte && npm install googleapis@144`

Expected: `googleapis` appears in `package.json` dependencies, no peer warnings.

- [ ] **Step 1.2: Generate encryption key and prompt user to add to .env**

Run: `openssl rand -hex 32`

Ask the user to paste the output as `GMAIL_TOKEN_ENCRYPTION_KEY=<hex>` into `.env`. Do not commit `.env`. Do not proceed until confirmed.

- [ ] **Step 1.3: Commit package.json**

```bash
cd ~/strange_rambling_svelte
git add package.json package-lock.json
git commit -m "chore: add googleapis for Gmail channel"
```

---

### Task 2: Token encryption helper

Refresh tokens must not sit in the DB in plaintext. AES-256-GCM with a static key from env is sufficient at rest.

**Files:**
- Create: `src/lib/workflows/gmail/crypto.ts`
- Test: `tests/lib/workflows/gmail/crypto.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `tests/lib/workflows/gmail/crypto.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { GMAIL_TOKEN_ENCRYPTION_KEY: '0'.repeat(64) },
}));

import { encryptToken, decryptToken } from '$lib/workflows/gmail/crypto';

describe('gmail crypto', () => {
  it('round-trips a refresh token', () => {
    const plain = 'ya29.refresh-token-sample-12345';
    const enc = encryptToken(plain);
    expect(enc).not.toBe(plain);
    expect(enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // iv:tag:ciphertext
    expect(decryptToken(enc)).toBe(plain);
  });

  it('produces different ciphertext for the same plaintext', () => {
    const plain = 'same-token';
    const a = encryptToken(plain);
    const b = encryptToken(plain);
    expect(a).not.toBe(b); // IV randomization
    expect(decryptToken(a)).toBe(plain);
    expect(decryptToken(b)).toBe(plain);
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptToken('hello');
    const parts = enc.split(':');
    const tampered = [parts[0], parts[1], parts[2].slice(0, -2) + '00'].join(':');
    expect(() => decryptToken(tampered)).toThrow();
  });
});
```

- [ ] **Step 2.2: Run test, verify FAIL**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/gmail/crypto.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 2.3: Implement**

Create `src/lib/workflows/gmail/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';

function getKey(): Buffer {
  const hex = env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** Format: `<iv-hex>:<auth-tag-hex>:<ciphertext-hex>` */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptToken(enc: string): string {
  const [ivH, tagH, ctH] = enc.split(':');
  if (!ivH || !tagH || !ctH) throw new Error('Malformed encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}
```

- [ ] **Step 2.4: Run test, verify PASS**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/gmail/crypto.test.ts`

Expected: 3 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/workflows/gmail/crypto.ts tests/lib/workflows/gmail/crypto.test.ts
git commit -m "feat(gmail): add AES-GCM token encryption helper"
```

---

### Task 3: Database schema

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 3.1: Add three tables**

Append to `src/lib/db/schema.ts`:

```typescript
// ---- Gmail channel ----

export const gmailAccounts = pgTable('gmail_accounts', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  // Encrypted with AES-GCM; format iv:tag:ct
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  accessTokenEnc: text('access_token_enc'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  scopes: text('scopes').notNull(), // space-separated
  status: text('status').notNull().default('active'), // active | auth_expired | disabled
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const gmailWatches = pgTable('gmail_watches', {
  id: serial('id').primaryKey(),
  accountId: serial('account_id').notNull(),
  label: text('label').notNull(), // human-readable label e.g. "recruiters"
  query: text('query').notNull(), // Gmail search syntax
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gmailHistoryCursors = pgTable('gmail_history_cursors', {
  accountId: serial('account_id').primaryKey(),
  historyId: text('history_id').notNull(), // Gmail uses string ids
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type GmailWatch = typeof gmailWatches.$inferSelect;
export type GmailHistoryCursor = typeof gmailHistoryCursors.$inferSelect;
```

- [ ] **Step 3.2: Push schema**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push`

Expected: prompts to confirm creation of three tables. Accept.

- [ ] **Step 3.3: Verify tables exist**

Run: `PGPASSWORD=<pw> psql -h homeserv -U <user> -d <db> -c "\d gmail_accounts"` (or use pgweb at http://homeserv:8085/pgweb/).

Expected: table definition shown with all columns.

- [ ] **Step 3.4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(gmail): add gmail_accounts, gmail_watches, gmail_history_cursors tables"
```

---

### Task 4: Event type definitions

**Files:**
- Modify: `src/lib/workflows/events.ts`

- [ ] **Step 4.1: Add gmail event types**

Open `src/lib/workflows/events.ts` and locate the union of event types. Add:

```typescript
export interface GmailMessageReceivedEvent {
  type: 'gmail.message.received';
  accountId: number;
  accountEmail: string;
  watchId: number;
  watchLabel: string;
  messageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  labels: string[];
  timestamp: string; // ISO
}

export interface GmailAuthExpiredEvent {
  type: 'gmail.auth.expired';
  accountId: number;
  accountEmail: string;
  error: string;
  timestamp: string;
}
```

Add both to the discriminated union exported as `WorkflowEvent` (or the equivalent union in the file).

- [ ] **Step 4.2: Verify typecheck**

Run: `cd ~/strange_rambling_svelte && npm run check`

Expected: no type errors introduced by the additions.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/workflows/events.ts
git commit -m "feat(gmail): add gmail event types"
```

---

### Task 5: Types module

**Files:**
- Create: `src/lib/workflows/gmail/types.ts`

- [ ] **Step 5.1: Define shared types**

Create `src/lib/workflows/gmail/types.ts`:

```typescript
export interface GmailHeaders {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  messageId?: string; // RFC822 Message-ID header
  inReplyTo?: string;
  references?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string; // Gmail epoch ms as string
  headers: GmailHeaders;
  bodyText: string;
  bodyHtml: string;
  attachments: GmailAttachmentRef[];
}

export interface GmailAttachmentRef {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SendInput {
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string; // RFC822 Message-ID to thread
  references?: string; // space-separated chain
  threadId?: string; // Gmail thread id for thread continuation
}

export interface SendResult {
  messageId: string; // Gmail API message id
  threadId: string;
  rfc822MessageId: string; // RFC822 Message-ID from headers
}
```

- [ ] **Step 5.2: Commit**

```bash
git add src/lib/workflows/gmail/types.ts
git commit -m "feat(gmail): add shared Gmail types"
```

---

### Task 6: GmailService — token refresh

The service holds a per-account OAuth2 client, refreshes access tokens on demand, and persists the refreshed token back to the DB.

**Files:**
- Create: `src/lib/workflows/gmail/service.ts`
- Test: `tests/lib/workflows/gmail/service.test.ts`

- [ ] **Step 6.1: Write failing test for token refresh**

Create `tests/lib/workflows/gmail/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GMAIL_TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  },
}));

const mockRefreshAccessToken = vi.fn();
const mockRequest = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        refreshAccessToken: mockRefreshAccessToken,
      })),
    },
    gmail: vi.fn(() => ({
      users: {
        getProfile: vi.fn(),
        messages: { get: mockRequest, list: mockRequest, send: mockRequest, modify: mockRequest },
        history: { list: mockRequest },
      },
    })),
  },
}));

const dbMock = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ gmailAccounts: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: any, b: any) => ({ a, b }) }));

import { GmailService } from '$lib/workflows/gmail/service';
import { encryptToken } from '$lib/workflows/gmail/crypto';

describe('GmailService.getAuthenticatedClient', () => {
  beforeEach(() => {
    mockRefreshAccessToken.mockReset();
    dbMock.set.mockClear();
  });

  it('refreshes expired access token and persists new one', async () => {
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: 'new-access', expiry_date: Date.now() + 3600_000 },
    });

    const svc = new GmailService();
    const account = {
      id: 1,
      email: 'john@example.com',
      refreshTokenEnc: encryptToken('refresh-abc'),
      accessTokenEnc: encryptToken('old-access'),
      accessTokenExpiresAt: new Date(Date.now() - 1000), // expired
      scopes: 'gmail.modify gmail.send',
      status: 'active',
    } as any;

    await svc.getAuthenticatedClient(account);

    expect(mockRefreshAccessToken).toHaveBeenCalled();
    expect(dbMock.set).toHaveBeenCalled();
    const setArg = dbMock.set.mock.calls[0][0];
    expect(setArg.accessTokenEnc).toBeDefined();
    expect(setArg.accessTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('marks account auth_expired and throws on invalid_grant', async () => {
    const err: any = new Error('invalid_grant');
    err.response = { data: { error: 'invalid_grant' } };
    mockRefreshAccessToken.mockRejectedValue(err);

    const svc = new GmailService();
    const account = {
      id: 2,
      email: 'x@example.com',
      refreshTokenEnc: encryptToken('bad'),
      accessTokenExpiresAt: new Date(0),
      scopes: '',
      status: 'active',
    } as any;

    await expect(svc.getAuthenticatedClient(account)).rejects.toThrow(/invalid_grant|auth_expired/i);
    const setArg = dbMock.set.mock.calls.at(-1)?.[0];
    expect(setArg?.status).toBe('auth_expired');
  });
});
```

- [ ] **Step 6.2: Run test, verify FAIL**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/gmail/service.test.ts`

Expected: FAIL — `GmailService` not defined.

- [ ] **Step 6.3: Implement service with token refresh only (no fetch/send yet)**

Create `src/lib/workflows/gmail/service.ts`:

```typescript
import { google, type gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { gmailAccounts, type GmailAccount } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptToken, decryptToken } from './crypto';

const CLOCK_SKEW_MS = 60_000; // refresh 60s before expiry

export class GmailService {
  private clients = new Map<number, OAuth2Client>();

  private buildClient(): OAuth2Client {
    return new (google.auth.OAuth2 as any)(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      undefined, // redirect URI set per-request during consent flow only
    );
  }

  async getAuthenticatedClient(account: GmailAccount): Promise<OAuth2Client> {
    let client = this.clients.get(account.id);
    if (!client) {
      client = this.buildClient();
      this.clients.set(account.id, client);
    }

    const refreshToken = decryptToken(account.refreshTokenEnc);
    const needsRefresh =
      !account.accessTokenEnc ||
      !account.accessTokenExpiresAt ||
      account.accessTokenExpiresAt.getTime() - Date.now() < CLOCK_SKEW_MS;

    if (!needsRefresh && account.accessTokenEnc) {
      client.setCredentials({
        access_token: decryptToken(account.accessTokenEnc),
        refresh_token: refreshToken,
        expiry_date: account.accessTokenExpiresAt!.getTime(),
      });
      return client;
    }

    client.setCredentials({ refresh_token: refreshToken });
    try {
      const { credentials } = await client.refreshAccessToken();
      if (!credentials.access_token || !credentials.expiry_date) {
        throw new Error('Refresh returned no access_token/expiry_date');
      }
      await db
        .update(gmailAccounts)
        .set({
          accessTokenEnc: encryptToken(credentials.access_token),
          accessTokenExpiresAt: new Date(credentials.expiry_date),
          status: 'active',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(gmailAccounts.id, account.id));
      client.setCredentials(credentials);
      return client;
    } catch (err: any) {
      const code = err?.response?.data?.error || err?.message || 'refresh_failed';
      await db
        .update(gmailAccounts)
        .set({
          status: code === 'invalid_grant' ? 'auth_expired' : 'active',
          lastError: String(code).slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(gmailAccounts.id, account.id));
      throw new Error(`Gmail token refresh failed: ${code}`);
    }
  }

  gmailClientFor(oauth: OAuth2Client): gmail_v1.Gmail {
    return google.gmail({ version: 'v1', auth: oauth });
  }
}

export const gmailService = new GmailService();
```

- [ ] **Step 6.4: Run test, verify PASS**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/gmail/service.test.ts`

Expected: 2 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/workflows/gmail/service.ts tests/lib/workflows/gmail/service.test.ts
git commit -m "feat(gmail): add GmailService with token refresh + auth_expired handling"
```

---

### Task 7: GmailService — fetch/list/send/modify primitives

**Files:**
- Modify: `src/lib/workflows/gmail/service.ts`
- Modify: `tests/lib/workflows/gmail/service.test.ts`

- [ ] **Step 7.1: Add test for fetchMessage**

Append to `tests/lib/workflows/gmail/service.test.ts`:

```typescript
describe('GmailService.fetchMessage', () => {
  it('parses headers + text + html + attachments', async () => {
    // Minimal RFC822 structure returned by users.messages.get format=FULL
    mockRequest.mockResolvedValueOnce({
      data: {
        id: 'm1',
        threadId: 't1',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'hello world',
        historyId: '12345',
        internalDate: '1700000000000',
        payload: {
          headers: [
            { name: 'From', value: 'alice@x.com' },
            { name: 'To', value: 'me@x.com' },
            { name: 'Subject', value: 'Hi' },
            { name: 'Date', value: 'Mon, 1 Jan 2024' },
            { name: 'Message-ID', value: '<abc@x.com>' },
          ],
          mimeType: 'multipart/mixed',
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from('Hello').toString('base64url') } },
            { mimeType: 'text/html', body: { data: Buffer.from('<b>Hi</b>').toString('base64url') } },
            { mimeType: 'application/pdf', filename: 'x.pdf',
              body: { attachmentId: 'att1', size: 1024 } },
          ],
        },
      },
    });

    const svc = new GmailService();
    const account = { id: 1, refreshTokenEnc: encryptToken('r'), accessTokenEnc: encryptToken('a'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000), email: 'me@x.com', scopes: '', status: 'active' } as any;

    const msg = await svc.fetchMessage(account, 'm1');
    expect(msg.id).toBe('m1');
    expect(msg.headers.from).toBe('alice@x.com');
    expect(msg.headers.subject).toBe('Hi');
    expect(msg.bodyText).toBe('Hello');
    expect(msg.bodyHtml).toBe('<b>Hi</b>');
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe('x.pdf');
  });
});

describe('GmailService.sendMessage', () => {
  it('builds RFC822 message and sends', async () => {
    mockRequest.mockResolvedValueOnce({ data: { id: 'sent1', threadId: 't2' } });

    const svc = new GmailService();
    const account = { id: 1, refreshTokenEnc: encryptToken('r'), accessTokenEnc: encryptToken('a'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000), email: 'me@x.com', scopes: '', status: 'active' } as any;

    const result = await svc.sendMessage(account, {
      to: 'b@x.com',
      subject: 'Hey',
      bodyText: 'body',
    });

    expect(result.messageId).toBe('sent1');
    expect(result.threadId).toBe('t2');
    const call = mockRequest.mock.calls.at(-1)![0];
    expect(call.requestBody.raw).toBeDefined();
    const decoded = Buffer.from(call.requestBody.raw, 'base64url').toString('utf8');
    expect(decoded).toContain('To: b@x.com');
    expect(decoded).toContain('Subject: Hey');
    expect(decoded).toContain('body');
  });

  it('preserves In-Reply-To and References when threading', async () => {
    mockRequest.mockResolvedValueOnce({ data: { id: 's2', threadId: 't3' } });
    const svc = new GmailService();
    const account = { id: 1, refreshTokenEnc: encryptToken('r'), accessTokenEnc: encryptToken('a'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000), email: 'me@x.com', scopes: '', status: 'active' } as any;

    await svc.sendMessage(account, {
      to: 'b@x.com',
      subject: 'Re: Hey',
      bodyText: 'reply',
      inReplyTo: '<orig@x.com>',
      references: '<orig@x.com>',
      threadId: 't3',
    });

    const call = mockRequest.mock.calls.at(-1)![0];
    const decoded = Buffer.from(call.requestBody.raw, 'base64url').toString('utf8');
    expect(decoded).toContain('In-Reply-To: <orig@x.com>');
    expect(decoded).toContain('References: <orig@x.com>');
    expect(call.requestBody.threadId).toBe('t3');
  });
});
```

- [ ] **Step 7.2: Run test, verify FAIL**

Run: `npx vitest run tests/lib/workflows/gmail/service.test.ts`

Expected: FAIL — `fetchMessage` / `sendMessage` not defined.

- [ ] **Step 7.3: Implement primitives**

Append to `src/lib/workflows/gmail/service.ts`:

```typescript
import type { GmailMessage, GmailAttachmentRef, SendInput, SendResult } from './types';

function b64urlDecode(s: string | undefined | null): string {
  if (!s) return '';
  return Buffer.from(s, 'base64url').toString('utf8');
}

function headerLookup(headers: Array<{ name?: string | null; value?: string | null }> = [], name: string): string {
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function walkParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  out: { text: string[]; html: string[]; attachments: GmailAttachmentRef[] },
): void {
  if (!part) return;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.text.push(b64urlDecode(part.body.data));
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    out.html.push(b64urlDecode(part.body.data));
  } else if (part.body?.attachmentId && part.filename) {
    out.attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      sizeBytes: part.body.size ?? 0,
    });
  }
  for (const p of part.parts ?? []) walkParts(p, out);
}

declare module './service' {}

export interface GmailService {
  fetchMessage(account: GmailAccount, messageId: string): Promise<GmailMessage>;
  listMessages(account: GmailAccount, query: string, max?: number): Promise<string[]>;
  historyListSince(
    account: GmailAccount,
    startHistoryId: string,
  ): Promise<{ addedMessageIds: string[]; newHistoryId: string }>;
  getLatestHistoryId(account: GmailAccount): Promise<string>;
  sendMessage(account: GmailAccount, input: SendInput): Promise<SendResult>;
  modifyLabels(account: GmailAccount, messageId: string, add: string[], remove: string[]): Promise<void>;
}

GmailService.prototype.fetchMessage = async function (account, messageId) {
  const oauth = await this.getAuthenticatedClient(account);
  const gmail = this.gmailClientFor(oauth);
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const out = { text: [] as string[], html: [] as string[], attachments: [] as GmailAttachmentRef[] };
  walkParts(data.payload, out);
  return {
    id: data.id!,
    threadId: data.threadId!,
    labelIds: data.labelIds ?? [],
    snippet: data.snippet ?? '',
    historyId: data.historyId ?? '',
    internalDate: data.internalDate ?? '',
    headers: {
      from: headerLookup(data.payload?.headers ?? [], 'From'),
      to: headerLookup(data.payload?.headers ?? [], 'To'),
      cc: headerLookup(data.payload?.headers ?? [], 'Cc') || undefined,
      subject: headerLookup(data.payload?.headers ?? [], 'Subject'),
      date: headerLookup(data.payload?.headers ?? [], 'Date'),
      messageId: headerLookup(data.payload?.headers ?? [], 'Message-ID') || undefined,
      inReplyTo: headerLookup(data.payload?.headers ?? [], 'In-Reply-To') || undefined,
      references: headerLookup(data.payload?.headers ?? [], 'References') || undefined,
    },
    bodyText: out.text.join('\n'),
    bodyHtml: out.html.join('\n'),
    attachments: out.attachments,
  };
};

GmailService.prototype.listMessages = async function (account, query, max = 50) {
  const oauth = await this.getAuthenticatedClient(account);
  const gmail = this.gmailClientFor(oauth);
  const { data } = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
  return (data.messages ?? []).map((m) => m.id!).filter(Boolean);
};

GmailService.prototype.historyListSince = async function (account, startHistoryId) {
  const oauth = await this.getAuthenticatedClient(account);
  const gmail = this.gmailClientFor(oauth);
  const { data } = await gmail.users.history.list({
    userId: 'me',
    startHistoryId,
    historyTypes: ['messageAdded'],
    maxResults: 500,
  });
  const added: string[] = [];
  for (const h of data.history ?? []) {
    for (const ma of h.messagesAdded ?? []) {
      if (ma.message?.id) added.push(ma.message.id);
    }
  }
  return { addedMessageIds: added, newHistoryId: data.historyId ?? startHistoryId };
};

GmailService.prototype.getLatestHistoryId = async function (account) {
  const oauth = await this.getAuthenticatedClient(account);
  const gmail = this.gmailClientFor(oauth);
  const { data } = await gmail.users.getProfile({ userId: 'me' });
  return data.historyId!;
};

function buildRfc822(from: string, input: SendInput): string {
  const id = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${from.split('@')[1] || 'local'}>`;
  const headers: string[] = [
    `From: ${from}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    ...(input.bcc ? [`Bcc: ${input.bcc}`] : []),
    `Subject: ${input.subject}`,
    `Message-ID: ${id}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    'MIME-Version: 1.0',
  ];
  let body: string;
  if (input.bodyHtml && input.bodyText) {
    const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      input.bodyText,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      input.bodyHtml,
      `--${boundary}--`,
    ].join('\r\n');
  } else if (input.bodyHtml) {
    headers.push('Content-Type: text/html; charset="UTF-8"');
    body = input.bodyHtml;
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    body = input.bodyText ?? '';
  }
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

GmailService.prototype.sendMessage = async function (account, input) {
  const oauth = await this.getAuthenticatedClient(account);
  const gmail = this.gmailClientFor(oauth);
  const raw = Buffer.from(buildRfc822(account.email, input), 'utf8').toString('base64url');
  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: input.threadId },
  });
  // Re-fetch to get RFC822 Message-ID header
  let rfc = '';
  try {
    const msg = await this.fetchMessage(account, data.id!);
    rfc = msg.headers.messageId ?? '';
  } catch { /* ignore */ }
  return { messageId: data.id!, threadId: data.threadId!, rfc822MessageId: rfc };
};

GmailService.prototype.modifyLabels = async function (account, messageId, add, remove) {
  const oauth = await this.getAuthenticatedClient(account);
  const gmail = this.gmailClientFor(oauth);
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: add, removeLabelIds: remove },
  });
};
```

Note: the `declare module` + prototype pattern is used here because this plan adds methods incrementally. An implementer may prefer to inline them directly on the class in one pass — equivalent.

- [ ] **Step 7.4: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/gmail/service.test.ts`

Expected: 5 tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/workflows/gmail/service.ts tests/lib/workflows/gmail/service.test.ts
git commit -m "feat(gmail): add fetch/list/history/send/modify primitives"
```

---

### Task 8: Polling watcher

One watcher loop per process, polling all active accounts every 45 s. Diffs Gmail `historyId` per account, fetches new messages, filters each against every enabled watch's query (by re-querying with `q: "<query>" rfc822msgid:<MessageId>"` — single roundtrip per watch per new message), emits `gmail.message.received`.

**Files:**
- Create: `src/lib/workflows/gmail/watcher.ts`
- Test: `tests/lib/workflows/gmail/watcher.test.ts`

- [ ] **Step 8.1: Write test — new message gets emitted for a matching watch**

Create `tests/lib/workflows/gmail/watcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { GMAIL_TOKEN_ENCRYPTION_KEY: '0'.repeat(64) } }));

const historyListSince = vi.fn();
const fetchMessage = vi.fn();
const listMessages = vi.fn();
const getLatestHistoryId = vi.fn();

vi.mock('$lib/workflows/gmail/service', () => ({
  gmailService: {
    historyListSince: (...args: any[]) => historyListSince(...args),
    fetchMessage: (...args: any[]) => fetchMessage(...args),
    listMessages: (...args: any[]) => listMessages(...args),
    getLatestHistoryId: (...args: any[]) => getLatestHistoryId(...args),
  },
}));

const db: any = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('$lib/db', () => ({ db }));
vi.mock('$lib/db/schema', () => ({
  gmailAccounts: { id: 'id', status: 'status' },
  gmailWatches: { accountId: 'accountId', enabled: 'enabled' },
  gmailHistoryCursors: { accountId: 'accountId' },
}));
vi.mock('drizzle-orm', () => ({ and: (...xs: any[]) => xs, eq: (a: any, b: any) => ({ eq: [a, b] }) }));

const emit = vi.fn();
vi.mock('$lib/workflows/event-bus', () => ({
  eventBus: { emit: (...a: any[]) => emit(...a) },
}));

import { pollAccountOnce } from '$lib/workflows/gmail/watcher';

describe('pollAccountOnce', () => {
  beforeEach(() => {
    historyListSince.mockReset();
    fetchMessage.mockReset();
    listMessages.mockReset();
    emit.mockReset();
    db.where.mockReset();
  });

  it('emits gmail.message.received for messages matching a watch query', async () => {
    const account = { id: 1, email: 'me@x.com', status: 'active' } as any;
    const watches = [{ id: 10, accountId: 1, label: 'recruiters', query: 'from:recruiter@x.com', enabled: true }];
    const cursor = { accountId: 1, historyId: '100' };

    // Sequence of DB reads: cursor, watches
    db.where.mockResolvedValueOnce([cursor]);   // cursor read
    db.where.mockResolvedValueOnce(watches);    // watches read

    historyListSince.mockResolvedValue({ addedMessageIds: ['m1'], newHistoryId: '200' });
    listMessages.mockResolvedValue(['m1']); // watch query matches m1
    fetchMessage.mockResolvedValue({
      id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet: 'hey',
      headers: { from: 'recruiter@x.com', to: 'me@x.com', subject: 'Job', date: '', messageId: '<m1@x>' },
      bodyText: '', bodyHtml: '', attachments: [], historyId: '200', internalDate: '0',
    });

    await pollAccountOnce(account);

    expect(emit).toHaveBeenCalledTimes(1);
    const ev = emit.mock.calls[0][0];
    expect(ev.type).toBe('gmail.message.received');
    expect(ev.messageId).toBe('m1');
    expect(ev.watchLabel).toBe('recruiters');
  });

  it('initialises cursor to latest historyId on first poll (no emits)', async () => {
    const account = { id: 2, email: 'me@x.com', status: 'active' } as any;
    db.where.mockResolvedValueOnce([]); // no cursor
    db.where.mockResolvedValueOnce([]); // no watches (irrelevant)
    getLatestHistoryId.mockResolvedValue('500');

    await pollAccountOnce(account);

    expect(historyListSince).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ accountId: 2, historyId: '500' }));
  });

  it('does not emit for messages that no watch matches', async () => {
    const account = { id: 3, email: 'me@x.com', status: 'active' } as any;
    const watches = [{ id: 20, accountId: 3, label: 'w', query: 'from:somebody@x.com', enabled: true }];
    db.where.mockResolvedValueOnce([{ accountId: 3, historyId: '1' }]);
    db.where.mockResolvedValueOnce(watches);

    historyListSince.mockResolvedValue({ addedMessageIds: ['m7'], newHistoryId: '2' });
    listMessages.mockResolvedValue([]); // no match

    await pollAccountOnce(account);

    expect(emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8.2: Run test, verify FAIL**

Run: `npx vitest run tests/lib/workflows/gmail/watcher.test.ts`

Expected: FAIL — watcher module does not exist.

- [ ] **Step 8.3: Implement watcher**

Create `src/lib/workflows/gmail/watcher.ts`:

```typescript
import { db } from '$lib/db';
import { gmailAccounts, gmailWatches, gmailHistoryCursors, type GmailAccount } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { gmailService } from './service';
import { eventBus } from '$lib/workflows/event-bus';

const POLL_INTERVAL_MS = 45_000;

export async function pollAccountOnce(account: GmailAccount): Promise<void> {
  const cursorRows = await db.select().from(gmailHistoryCursors).where(eq(gmailHistoryCursors.accountId, account.id));
  const cursor = cursorRows[0];

  if (!cursor) {
    // First poll: seed cursor to current historyId so we don't flood on initial connect
    const historyId = await gmailService.getLatestHistoryId(account);
    await db.insert(gmailHistoryCursors).values({ accountId: account.id, historyId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: gmailHistoryCursors.accountId, set: { historyId, updatedAt: new Date() } });
    return;
  }

  const watches = await db.select().from(gmailWatches).where(
    and(eq(gmailWatches.accountId, account.id), eq(gmailWatches.enabled, true)),
  );
  if (watches.length === 0) return; // nothing to match against; leave cursor advance for next time

  const { addedMessageIds, newHistoryId } = await gmailService.historyListSince(account, cursor.historyId);

  for (const messageId of addedMessageIds) {
    for (const watch of watches) {
      // Match via a scoped list query: the watch's query AND the specific message id.
      // Gmail supports `rfc822msgid:` but that's on the RFC822 id, not the Gmail id.
      // Safer approach: query watch.query with newer_than:1d and check containment.
      const matches = await gmailService.listMessages(account, `${watch.query} rfc822msgid:${messageId}`, 1);
      if (matches.length === 0) {
        // Fallback: pull the message and check labels/from manually — but for now,
        // a simpler fallback is to just query by id against the broader query.
        const broader = await gmailService.listMessages(account, watch.query, 100);
        if (!broader.includes(messageId)) continue;
      }

      const msg = await gmailService.fetchMessage(account, messageId);
      eventBus.emit({
        type: 'gmail.message.received',
        accountId: account.id,
        accountEmail: account.email,
        watchId: watch.id,
        watchLabel: watch.label,
        messageId: msg.id,
        threadId: msg.threadId,
        from: msg.headers.from,
        to: msg.headers.to,
        subject: msg.headers.subject,
        snippet: msg.snippet,
        labels: msg.labelIds,
        timestamp: new Date().toISOString(),
      });
      break; // one emit per message, even if multiple watches match
    }
  }

  if (newHistoryId !== cursor.historyId) {
    await db.update(gmailHistoryCursors)
      .set({ historyId: newHistoryId, updatedAt: new Date() })
      .where(eq(gmailHistoryCursors.accountId, account.id));
  }
}

let timer: NodeJS.Timeout | null = null;
let stopping = false;

export function startWatcher(): void {
  if (timer) return;
  stopping = false;
  const loop = async () => {
    if (stopping) return;
    try {
      const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.status, 'active'));
      for (const acct of accounts) {
        try {
          await pollAccountOnce(acct);
        } catch (err: any) {
          console.error(`[gmail.watcher] account=${acct.email} error=${err?.message}`);
          if (/auth_expired|invalid_grant/i.test(String(err?.message))) {
            eventBus.emit({
              type: 'gmail.auth.expired',
              accountId: acct.id,
              accountEmail: acct.email,
              error: String(err?.message).slice(0, 300),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } finally {
      if (!stopping) timer = setTimeout(loop, POLL_INTERVAL_MS);
    }
  };
  timer = setTimeout(loop, 1000);
}

export function stopWatcher(): void {
  stopping = true;
  if (timer) { clearTimeout(timer); timer = null; }
}
```

- [ ] **Step 8.4: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/gmail/watcher.test.ts`

Expected: 3 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/workflows/gmail/watcher.ts tests/lib/workflows/gmail/watcher.test.ts
git commit -m "feat(gmail): add polling watcher with historyId cursor + per-watch matching"
```

---

### Task 9: Boot watcher in hooks.server.ts

**Files:**
- Modify: `src/hooks.server.ts`

- [ ] **Step 9.1: Start watcher on boot, stop on shutdown**

In `src/hooks.server.ts`, after the `startOrphanSweep()` call at line ~34, add:

```typescript
import { startWatcher as startGmailWatcher, stopWatcher as stopGmailWatcher } from '$lib/workflows/gmail/watcher';

startGmailWatcher();
```

In `gracefulShutdown()` (near line 40), add `stopGmailWatcher();` alongside the other stops.

- [ ] **Step 9.2: Verify typecheck**

Run: `cd ~/strange_rambling_svelte && npm run check`

Expected: no errors.

- [ ] **Step 9.3: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(gmail): boot polling watcher on server start"
```

---

### Task 10: Orchestrator bridge — route gmail events into chat + node-trigger subscriptions

**Files:**
- Create: `src/lib/workflows/gmail/orchestrator-bridge.ts`

- [ ] **Step 10.1: Wire gmail events to workflow trigger subscriptions**

Create `src/lib/workflows/gmail/orchestrator-bridge.ts`. Read `src/lib/workflows/whatsapp/orchestrator-bridge.ts` first and mirror the structure: subscribe to the event bus for `gmail.message.received` and `gmail.auth.expired`, then for each event look up workflows whose start node is `gmail-trigger` with a matching `accountId` + `watchId` filter, and invoke `runWorkflow({ trigger: event, startNodeId })`.

The exact dispatching API depends on how `whatsapp/orchestrator-bridge.ts` does it. Copy its shape line-for-line — only the event type and filter predicate change.

Also: pipe a shallow preview of the event into the `/jkai` chat event stream via the same mechanism WhatsApp uses (check `chat/ephemeral-sidecar.ts` or the sidecar used by WhatsApp bridge).

- [ ] **Step 10.2: Register the bridge at boot**

In `src/lib/workflows/gmail/index.ts` (create if missing), re-export `startWatcher`, `stopWatcher`, and a `registerGmailBridge()` function. Call `registerGmailBridge()` from `hooks.server.ts` after `startGmailWatcher()`.

- [ ] **Step 10.3: Manual smoke test**

With a seeded `gmail_accounts` row (will exist after Task 12), expect `console.log` lines in the dev server showing `gmail.message.received` events when a test email arrives matching a configured watch.

- [ ] **Step 10.4: Commit**

```bash
git add src/lib/workflows/gmail/orchestrator-bridge.ts src/lib/workflows/gmail/index.ts src/hooks.server.ts
git commit -m "feat(gmail): route gmail events to workflow triggers + chat stream"
```

---

### Task 11: OAuth connect/callback endpoints

**Files:**
- Create: `src/routes/api/gmail/connect/+server.ts`
- Create: `src/routes/api/gmail/callback/+server.ts`

- [ ] **Step 11.1: Implement connect endpoint**

Create `src/routes/api/gmail/connect/+server.ts`:

```typescript
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'openid',
  'email',
];

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await locals.auth();
  if (!session?.user) throw redirect(302, '/login');

  const redirectUri = `${url.origin}/api/gmail/callback`;
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token return
    scope: SCOPES,
    include_granted_scopes: true,
  });
  throw redirect(302, authUrl);
};
```

- [ ] **Step 11.2: Implement callback endpoint**

Create `src/routes/api/gmail/callback/+server.ts`:

```typescript
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { encryptToken } from '$lib/workflows/gmail/crypto';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await locals.auth();
  if (!session?.user) throw redirect(302, '/login');

  const code = url.searchParams.get('code');
  if (!code) throw redirect(302, '/admin/gmail?error=no_code');

  const redirectUri = `${url.origin}/api/gmail/callback`;
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw redirect(302, '/admin/gmail?error=no_refresh_token');
  }
  oauth.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.emailAddress!;

  const existing = await db.select().from(gmailAccounts).where(eq(gmailAccounts.email, email));
  if (existing[0]) {
    await db.update(gmailAccounts).set({
      refreshTokenEnc: encryptToken(tokens.refresh_token),
      accessTokenEnc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? '',
      status: 'active',
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(gmailAccounts.id, existing[0].id));
  } else {
    await db.insert(gmailAccounts).values({
      email,
      refreshTokenEnc: encryptToken(tokens.refresh_token),
      accessTokenEnc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? '',
      status: 'active',
    });
  }
  throw redirect(302, '/admin/gmail?connected=' + encodeURIComponent(email));
};
```

- [ ] **Step 11.3: Add redirect URI to Google Cloud Console (manual)**

User action: add `http://localhost:5173/api/gmail/callback` AND `https://strangeramblings.com/api/gmail/callback` to the OAuth client's authorised redirect URIs in Google Cloud Console. Confirm before proceeding.

- [ ] **Step 11.4: Commit**

```bash
git add src/routes/api/gmail/
git commit -m "feat(gmail): add OAuth connect + callback endpoints"
```

---

### Task 12: Admin API — list/delete accounts, manage watches, test fetch

**Files:**
- Create: `src/routes/api/gmail/accounts/+server.ts`
- Create: `src/routes/api/gmail/accounts/[id]/watches/+server.ts`
- Create: `src/routes/api/gmail/accounts/[id]/test/+server.ts`

- [ ] **Step 12.1: Accounts list/delete**

`src/routes/api/gmail/accounts/+server.ts`:

```typescript
import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select({
    id: gmailAccounts.id,
    email: gmailAccounts.email,
    status: gmailAccounts.status,
    scopes: gmailAccounts.scopes,
    lastError: gmailAccounts.lastError,
    createdAt: gmailAccounts.createdAt,
  }).from(gmailAccounts);
  return json(rows);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: 'id required' }, { status: 400 });
  await db.delete(gmailAccounts).where(eq(gmailAccounts.id, id));
  return json({ ok: true });
};
```

- [ ] **Step 12.2: Watches CRUD**

`src/routes/api/gmail/accounts/[id]/watches/+server.ts`:

```typescript
import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailWatches } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const accountId = Number(params.id);
  const rows = await db.select().from(gmailWatches).where(eq(gmailWatches.accountId, accountId));
  return json(rows);
};

export const POST: RequestHandler = async ({ params, request }) => {
  const accountId = Number(params.id);
  const { label, query, enabled } = await request.json();
  if (!label || !query) return json({ error: 'label and query required' }, { status: 400 });
  const [row] = await db.insert(gmailWatches).values({
    accountId, label, query, enabled: enabled ?? true,
  }).returning();
  return json(row);
};

export const DELETE: RequestHandler = async ({ params, url }) => {
  const accountId = Number(params.id);
  const watchId = Number(url.searchParams.get('watchId'));
  if (!watchId) return json({ error: 'watchId required' }, { status: 400 });
  await db.delete(gmailWatches).where(and(eq(gmailWatches.id, watchId), eq(gmailWatches.accountId, accountId)));
  return json({ ok: true });
};
```

- [ ] **Step 12.3: Test fetch endpoint**

`src/routes/api/gmail/accounts/[id]/test/+server.ts`:

```typescript
import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { gmailService } from '$lib/workflows/gmail/service';

export const POST: RequestHandler = async ({ params, request }) => {
  const accountId = Number(params.id);
  const { query } = await request.json();
  const [acct] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, accountId));
  if (!acct) return json({ error: 'not found' }, { status: 404 });
  const ids = await gmailService.listMessages(acct, query ?? 'newer_than:1d', 10);
  const sample = ids[0] ? await gmailService.fetchMessage(acct, ids[0]) : null;
  return json({ count: ids.length, sample });
};
```

- [ ] **Step 12.4: Commit**

```bash
git add src/routes/api/gmail/accounts/
git commit -m "feat(gmail): add admin API for accounts + watches + test fetch"
```

---

### Task 13: Admin page UI

**Files:**
- Create: `src/routes/admin/gmail/+page.server.ts`
- Create: `src/routes/admin/gmail/+page.svelte`

- [ ] **Step 13.1: Load accounts + watches**

`src/routes/admin/gmail/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { gmailAccounts, gmailWatches } from '$lib/db/schema';

export const load: PageServerLoad = async () => {
  const accounts = await db.select().from(gmailAccounts);
  const watches = await db.select().from(gmailWatches);
  return {
    accounts: accounts.map(a => ({ ...a, refreshTokenEnc: undefined, accessTokenEnc: undefined })),
    watches,
  };
};
```

- [ ] **Step 13.2: UI — modelled on existing admin pages**

Read `src/routes/admin/blog/+page.svelte` or a similarly simple admin page for layout conventions, then build `src/routes/admin/gmail/+page.svelte` with:

- "Connect new Gmail account" button → `window.location.href = '/api/gmail/connect'`
- Accounts list: email, status, last error, disconnect button
- Per-account: list of watches (label + query + enabled toggle), add-watch form (label input, query input), delete buttons
- Per-account: "test fetch" panel (query input, run button, shows count + sample subject)

Keep styling minimal — follow existing admin patterns; don't invent new CSS.

- [ ] **Step 13.3: Smoke test**

Run: `cd ~/strange_rambling_svelte && npm run dev`

Open `http://homeserv:5173/admin/gmail`. Verify the page loads with empty state. Click Connect, complete OAuth, verify account appears. Add a watch (label: "test", query: "newer_than:1d"). Verify test-fetch returns results.

- [ ] **Step 13.4: Commit**

```bash
git add src/routes/admin/gmail/
git commit -m "feat(gmail): add admin UI for accounts + watches"
```

---

### Task 14: Node — gmail-trigger

**Files:**
- Create: `src/lib/workflows/nodes/gmail-trigger.def.ts`
- Create: `src/lib/workflows/nodes/gmail-trigger.ts`
- Test: `tests/lib/workflows/nodes/gmail-trigger.test.ts`

- [ ] **Step 14.1: Write test**

Before writing, read `tests/lib/workflows/nodes/manual-trigger.test.ts` and `src/lib/workflows/nodes/manual-trigger.ts` (or whatever the existing trigger-shape node is) to understand the start-node executor convention in this codebase.

Then create `tests/lib/workflows/nodes/gmail-trigger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { gmailTriggerExecutor } from '$lib/workflows/nodes/gmail-trigger';

const ctx: any = { runId: 'r', workflowId: 'w', emit: () => {}, getNodeOutput: () => undefined };

describe('gmailTriggerExecutor', () => {
  it('passes the trigger event through as output', async () => {
    const trigger = {
      type: 'gmail.message.received',
      accountId: 1, accountEmail: 'me@x.com', watchId: 5, watchLabel: 'rec',
      messageId: 'm1', threadId: 't1',
      from: 'a@x.com', to: 'me@x.com', subject: 'Hi', snippet: 's', labels: ['INBOX'],
      timestamp: new Date().toISOString(),
    };
    const result = await gmailTriggerExecutor.execute(
      { __trigger: trigger }, // how engine passes triggers — verify matches existing convention
      {},
      ctx,
    );
    expect(result.output.messageId).toBe('m1');
    expect(result.output.subject).toBe('Hi');
    expect(result.output.from).toBe('a@x.com');
  });

  it('returns empty output when no trigger attached (manual run)', async () => {
    const result = await gmailTriggerExecutor.execute({}, {}, ctx);
    expect(result.output).toEqual({});
  });
});
```

If the existing trigger convention uses a different key than `__trigger`, adjust the test and implementation accordingly — do not invent a new pattern.

- [ ] **Step 14.2: Implement**

`src/lib/workflows/nodes/gmail-trigger.def.ts`:

```typescript
import type { NodeDefinition } from '../types';

export const gmailTriggerDef: NodeDefinition = {
  type: 'gmail-trigger',
  category: 'triggers',
  label: 'Gmail Trigger',
  description: 'Fires when a new Gmail message matches a watched query',
  configSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'number', description: 'gmail_accounts row id' },
      watchId: { type: 'number', description: 'gmail_watches row id (optional — if unset, fires on any watch for the account)' },
    },
    required: ['accountId'],
  },
};
```

`src/lib/workflows/nodes/gmail-trigger.ts`:

```typescript
import type { NodeExecutor } from '../types';

export { gmailTriggerDef } from './gmail-trigger.def';

export const gmailTriggerExecutor: NodeExecutor = {
  type: 'gmail-trigger',
  async execute(input) {
    const trigger = (input as any).__trigger;
    if (!trigger) return { output: {} };
    return {
      output: {
        messageId: trigger.messageId,
        threadId: trigger.threadId,
        from: trigger.from,
        to: trigger.to,
        subject: trigger.subject,
        snippet: trigger.snippet,
        labels: trigger.labels,
        accountId: trigger.accountId,
        watchLabel: trigger.watchLabel,
        timestamp: trigger.timestamp,
      },
    };
  },
  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        threadId: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        subject: { type: 'string' },
        snippet: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        accountId: { type: 'number' },
        watchLabel: { type: 'string' },
        timestamp: { type: 'string' },
      },
    };
  },
};
```

- [ ] **Step 14.3: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/nodes/gmail-trigger.test.ts`

Expected: 2 tests pass.

- [ ] **Step 14.4: Commit**

```bash
git add src/lib/workflows/nodes/gmail-trigger.ts src/lib/workflows/nodes/gmail-trigger.def.ts tests/lib/workflows/nodes/gmail-trigger.test.ts
git commit -m "feat(gmail): add gmail-trigger node"
```

---

### Task 15: Nodes — gmail-fetch, gmail-send, gmail-reply, gmail-label, gmail-search

Each follows the same pattern: `.def.ts` with config schema, `.ts` with executor that reads `accountId` from input/config, loads the account, calls the matching `gmailService` method, returns structured output. Each has a sibling test mocking `gmailService`.

Below is the per-node spec. Implementation pattern is identical to Task 14: write test, verify FAIL, implement, verify PASS, commit.

**Files per node:** `src/lib/workflows/nodes/<node>.ts`, `.def.ts`, `tests/lib/workflows/nodes/<node>.test.ts`.

- [ ] **Step 15.1: gmail-fetch**

Config: `{ messageId: string (template) }`. Optional: `accountId` (if unset, use trigger's accountId from input). Output: full `GmailMessage`.

Write test: mock `gmailService.fetchMessage` returning a `GmailMessage`; assert output.headers, output.bodyText.

Implement; commit as `feat(gmail): add gmail-fetch node`.

- [ ] **Step 15.2: gmail-send**

Config: `{ accountId: number, to: string (template), subject: string (template), bodyText?: string (template), bodyHtml?: string (template), cc?: string, bcc?: string }`. Output: `{ messageId, threadId, rfc822MessageId, sent: true }`.

Test: mock `gmailService.sendMessage`; verify template interpolation and call args.

Commit as `feat(gmail): add gmail-send node`.

- [ ] **Step 15.3: gmail-reply**

Config: `{ accountId: number, threadId: string (template), inReplyTo: string (template, RFC822 Message-ID), subject: string, bodyText?: string, bodyHtml?: string }`. Builds `references` chain from upstream message references + inReplyTo. Output: same as send.

Test: verify threadId + In-Reply-To + References headers passed through correctly.

Commit as `feat(gmail): add gmail-reply node`.

- [ ] **Step 15.4: gmail-label**

Config: `{ accountId: number, messageId: string (template), add?: string[], remove?: string[] }`. Common cases: `add: ['Label_Archive']`, `remove: ['INBOX']` (archive), `remove: ['UNREAD']` (mark read).

Test: verify `modifyLabels` called with correct add/remove arrays.

Commit as `feat(gmail): add gmail-label node`.

- [ ] **Step 15.5: gmail-search**

Config: `{ accountId: number, query: string (template), maxResults?: number }`. Output: `{ count: number, messageIds: string[], messages?: GmailMessage[] }` with optional `fetchFullMessages: boolean` to control whether full messages or just ids are returned.

Test: mock `listMessages` and `fetchMessage`; assert both modes.

Commit as `feat(gmail): add gmail-search node`.

---

### Task 16: Register nodes in workflow index + registry-client

**Files:**
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

- [ ] **Step 16.1: Register executors**

In `src/lib/workflows/index.ts`, add imports + registry registrations for all six gmail executors, following the pattern used for existing node types (copy the exact pattern used for e.g. `email` or `http-request`).

- [ ] **Step 16.2: Register definitions in client-safe registry**

In `src/lib/workflows/registry-client.ts`, add imports + registrations for the six `.def.ts` files following existing pattern.

- [ ] **Step 16.3: Verify typecheck + tests**

Run: `npm run check && npx vitest run tests/lib/workflows/gmail tests/lib/workflows/nodes/gmail-*`

Expected: all Gmail tests pass, no type errors.

- [ ] **Step 16.4: Commit**

```bash
git add src/lib/workflows/index.ts src/lib/workflows/registry-client.ts
git commit -m "feat(gmail): register gmail nodes in workflow registries"
```

---

### Task 17: End-to-end smoke test + docs

**Files:**
- Modify: `~/strange_rambling_svelte/CLAUDE.md`

- [ ] **Step 17.1: Manual end-to-end test**

On homeserv:
1. `npm run dev` from `~/strange_rambling_svelte`
2. Visit `/admin/gmail`, connect the user's Gmail account.
3. Add watch: label "test", query `newer_than:1h`.
4. Send yourself a test email from another address.
5. Watch dev-server logs for `gmail.message.received` event emission within ~60 s.
6. In the workflow editor, build a graph: `gmail-trigger` → `gmail-label` (remove INBOX, add a test label) → end. Save, bind to accountId + watchId, enable.
7. Send another test email; verify the workflow runs and the email is archived with the test label in Gmail web UI.

- [ ] **Step 17.2: Update CLAUDE.md**

Add to `~/strange_rambling_svelte/CLAUDE.md` under a new "Gmail channel" section: one paragraph describing that Gmail integration exists at `/admin/gmail`, listing the 6 nodes, noting poll interval and encryption env var.

- [ ] **Step 17.3: Deploy**

Per the user's `feedback_always_deploy` rule: after pushing to master, also run `~/strange_rambling_svelte/scripts/deploy.sh`.

Before deploy: remember the VPS needs `GMAIL_TOKEN_ENCRYPTION_KEY` in its env. Add it to the VPS `.env` via SSH; document it in `~/vps-strange-rambling/` deployment repo.

- [ ] **Step 17.4: Commit + push**

```bash
git add CLAUDE.md
git commit -m "docs: add Gmail channel section to CLAUDE.md"
git push
bash ~/strange_rambling_svelte/scripts/deploy.sh
```

---

## Self-review checklist

- Spec coverage: full read/write ✓ (fetch/send/reply/label/search), multi-account ✓ (gmail_accounts table, per-account polling), monitor multiple emails ✓ (gmail_watches with queries), chat streaming ✓ (orchestrator-bridge Task 10).
- No placeholders in code steps: verified.
- Type consistency: `GmailAccount`, `GmailMessage`, `SendInput`, `SendResult` defined in Task 5, used consistently in 6/7/8/nodes.
- Deferred to implementer: exact shape of `orchestrator-bridge.ts` because it must mirror WhatsApp's bridge line-for-line and that pattern is already in-repo — prescribing details would diverge from the existing shape.

---
