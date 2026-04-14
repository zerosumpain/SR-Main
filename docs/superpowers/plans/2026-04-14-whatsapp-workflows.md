# WhatsApp Workflows Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WhatsApp as a first-class endpoint to the workflows engine via Baileys, enabling conversational orchestrator interaction and workflow-triggered message sending.

**Architecture:** A WhatsApp singleton service manages the Baileys connection lifecycle. A WhatsApp workflow node handles outbound sends. An orchestrator bridge routes inbound WhatsApp messages to the existing orchestrator, with conversation persistence and soul.md personality grounding. All config (connection, allowlist, soul.md) is managed from the WhatsApp node's config panel in the workflows UI.

**Tech Stack:** `@whiskeysockets/baileys` (WhatsApp Web protocol), Drizzle ORM (Postgres), SvelteKit API routes, Vitest

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/workflows/whatsapp/service.ts` | Create | Baileys singleton — connection lifecycle, QR, send/receive |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Create | Routes inbound messages to orchestrator, manages conversation context |
| `src/lib/workflows/whatsapp/types.ts` | Create | WhatsApp config, conversation, and service types |
| `src/lib/workflows/nodes/whatsapp.ts` | Create | WhatsApp send node (executor + definition) |
| `src/lib/workflows/index.ts` | Modify | Register whatsapp node, boot WhatsApp service |
| `src/lib/db/schema.ts` | Modify | Add `whatsappConfig` and `whatsappConversations` tables |
| `src/routes/api/workflows/whatsapp/status/+server.ts` | Create | Connection status + QR endpoint |
| `src/routes/api/workflows/whatsapp/connect/+server.ts` | Create | Start/stop Baileys connection |
| `src/routes/api/workflows/whatsapp/config/+server.ts` | Create | GET/PUT config (enabled, allowlist, soulMd) |
| `src/routes/api/workflows/whatsapp/conversations/+server.ts` | Create | List conversation threads |
| `src/routes/api/workflows/whatsapp/conversations/[phoneNumber]/+server.ts` | Create | Get/delete conversation history |
| `tests/lib/workflows/whatsapp/service.test.ts` | Create | WhatsApp service unit tests |
| `tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts` | Create | Orchestrator bridge unit tests |
| `tests/lib/workflows/whatsapp/whatsapp-node.test.ts` | Create | WhatsApp node executor tests |

---

### Task 1: Install Baileys and Add DB Schema

**Files:**
- Modify: `package.json`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Install Baileys**

```bash
cd ~/strange_rambling_svelte && npm install @whiskeysockets/baileys
```

- [ ] **Step 2: Add WhatsApp tables to schema**

Add these two tables at the end of `src/lib/db/schema.ts`, before any final closing content:

```typescript
// ==========================================
// WhatsApp Integration
// ==========================================

export const whatsappConfig = pgTable('whatsapp_config', {
  id: text('id').primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(false),
  allowedNumbers: jsonb('allowed_numbers').notNull().default(sql`'[]'::jsonb`),
  soulMd: text('soul_md').notNull().default(''),
  authDir: text('auth_dir').notNull().default('data/whatsapp-auth'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsAppConfig = typeof whatsappConfig.$inferSelect;
export type NewWhatsAppConfig = typeof whatsappConfig.$inferInsert;

export const whatsappConversations = pgTable('whatsapp_conversations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  phoneNumber: text('phone_number').notNull(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsAppConversation = typeof whatsappConversations.$inferSelect;
export type NewWhatsAppConversation = typeof whatsappConversations.$inferInsert;
```

- [ ] **Step 3: Push schema to database**

```bash
cd ~/strange_rambling_svelte && npx drizzle-kit push
```

Expected: Tables `whatsapp_config` and `whatsapp_conversations` created.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add package.json package-lock.json src/lib/db/schema.ts
git commit -m "feat(whatsapp): install baileys and add whatsapp db tables"
```

---

### Task 2: WhatsApp Types

**Files:**
- Create: `src/lib/workflows/whatsapp/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
export type WhatsAppServiceStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected';

export interface WhatsAppServiceState {
  status: WhatsAppServiceStatus;
  qrCode: string | null;
  connectedNumber: string | null;
}

export interface WhatsAppInboundMessage {
  from: string; // E.164 phone number
  text: string;
  timestamp: number;
  messageId: string;
  isGroup: boolean;
  groupId?: string;
}

export interface WhatsAppSendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/whatsapp/types.ts
git commit -m "feat(whatsapp): add whatsapp types"
```

---

### Task 3: WhatsApp Service (Baileys Singleton)

**Files:**
- Create: `src/lib/workflows/whatsapp/service.ts`
- Create: `tests/lib/workflows/whatsapp/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/workflows/whatsapp/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock baileys before importing service
vi.mock('@whiskeysockets/baileys', () => {
  const mockSock = {
    ev: {
      on: vi.fn(),
      off: vi.fn(),
    },
    sendMessage: vi.fn().mockResolvedValue({ key: { id: 'msg-123' } }),
    logout: vi.fn().mockResolvedValue(undefined),
    end: vi.fn(),
    user: { id: '447359228511:1@s.whatsapp.net' },
  };

  return {
    default: vi.fn(() => mockSock),
    makeWASocket: vi.fn(() => mockSock),
    useMultiFileAuthState: vi.fn().mockResolvedValue({
      state: { creds: {}, keys: {} },
      saveCreds: vi.fn(),
    }),
    fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [2, 3000, 0] }),
    makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
    DisconnectReason: {
      loggedOut: 401,
      connectionClosed: 428,
      connectionLost: 408,
      timedOut: 408,
    },
  };
});

// Mock the DB
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({
  whatsappConfig: { id: 'id' },
  whatsappConversations: {},
}));

import { WhatsAppService } from '$lib/workflows/whatsapp/service';

describe('WhatsAppService', () => {
  let service: WhatsAppService;

  beforeEach(() => {
    service = new WhatsAppService();
  });

  it('starts in disconnected state', () => {
    const state = service.getState();
    expect(state.status).toBe('disconnected');
    expect(state.qrCode).toBeNull();
    expect(state.connectedNumber).toBeNull();
  });

  it('formats phone numbers to WhatsApp JID', () => {
    expect(service.toJid('+447359228511')).toBe('447359228511@s.whatsapp.net');
    expect(service.toJid('447359228511')).toBe('447359228511@s.whatsapp.net');
  });

  it('extracts phone number from JID', () => {
    expect(service.fromJid('447359228511@s.whatsapp.net')).toBe('447359228511');
    expect(service.fromJid('447359228511:1@s.whatsapp.net')).toBe('447359228511');
  });

  it('checks allowlist correctly', () => {
    service.setAllowedNumbers(['+447359228511', '+12025551234']);
    expect(service.isAllowed('447359228511')).toBe(true);
    expect(service.isAllowed('+447359228511')).toBe(true);
    expect(service.isAllowed('12025551234')).toBe(true);
    expect(service.isAllowed('9999999999')).toBe(false);
  });

  it('allows all numbers when allowlist is empty', () => {
    service.setAllowedNumbers([]);
    expect(service.isAllowed('447359228511')).toBe(true);
    expect(service.isAllowed('anything')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/service.test.ts
```

Expected: FAIL — `Cannot find module '$lib/workflows/whatsapp/service'`

- [ ] **Step 3: Write the WhatsApp service**

Create `src/lib/workflows/whatsapp/service.ts`:

```typescript
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { join } from 'path';
import { mkdirSync } from 'fs';
import type {
  WhatsAppServiceStatus,
  WhatsAppServiceState,
  WhatsAppInboundMessage,
  WhatsAppSendResult,
} from './types';

type MessageHandler = (msg: WhatsAppInboundMessage) => void;

export class WhatsAppService {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private status: WhatsAppServiceStatus = 'disconnected';
  private qrCode: string | null = null;
  private connectedNumber: string | null = null;
  private allowedNumbers: Set<string> = new Set();
  private messageHandler: MessageHandler | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private saveCreds: (() => Promise<void>) | null = null;

  getState(): WhatsAppServiceState {
    return {
      status: this.status,
      qrCode: this.qrCode,
      connectedNumber: this.connectedNumber,
    };
  }

  setAllowedNumbers(numbers: string[]): void {
    this.allowedNumbers = new Set(
      numbers.map((n) => n.replace(/^\+/, '')),
    );
  }

  isAllowed(number: string): boolean {
    if (this.allowedNumbers.size === 0) return true;
    const normalized = number.replace(/^\+/, '');
    return this.allowedNumbers.has(normalized);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  toJid(phoneNumber: string): string {
    const cleaned = phoneNumber.replace(/^\+/, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  fromJid(jid: string): string {
    return jid.split('@')[0].split(':')[0];
  }

  async connect(authDir: string): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.status = 'connecting';
    this.qrCode = null;

    mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    this.saveCreds = saveCreds;

    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
      },
      version,
      printQRInTerminal: false,
      browser: ['strange-rambling', 'workflows', '1.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sock.ev.on('creds.update', () => {
      this.saveCreds?.();
    });

    this.sock.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.status = 'qr_pending';
        this.qrCode = qr;
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.qrCode = null;
        this.reconnectAttempts = 0;
        const rawId = this.sock?.user?.id;
        this.connectedNumber = rawId ? this.fromJid(rawId) : null;
        console.log(`[whatsapp] Connected as ${this.connectedNumber}`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (isLoggedOut) {
          console.log('[whatsapp] Logged out — clearing session');
          this.status = 'disconnected';
          this.connectedNumber = null;
          this.sock = null;
        } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`[whatsapp] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this.connect(authDir), delay);
        } else {
          console.log('[whatsapp] Max reconnect attempts reached');
          this.status = 'disconnected';
          this.connectedNumber = null;
          this.sock = null;
        }
      }
    });

    this.sock.ev.on('messages.upsert', (upsert: any) => {
      if (!this.messageHandler) return;
      const { messages } = upsert;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (!text) continue;

        const from = this.fromJid(msg.key.remoteJid || '');
        const isGroup = msg.key.remoteJid?.endsWith('@g.us') || false;

        if (isGroup) continue; // Skip group messages for now

        if (!this.isAllowed(from)) {
          console.log(`[whatsapp] Blocked message from unapproved number: ${from}`);
          continue;
        }

        this.messageHandler({
          from,
          text,
          timestamp: msg.messageTimestamp as number,
          messageId: msg.key.id || '',
          isGroup,
          groupId: isGroup ? msg.key.remoteJid || undefined : undefined,
        });
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.status = 'disconnected';
    this.qrCode = null;
    this.connectedNumber = null;
    this.reconnectAttempts = 0;
  }

  async sendMessage(to: string, text: string): Promise<WhatsAppSendResult> {
    if (!this.sock || this.status !== 'connected') {
      return { sent: false, error: 'WhatsApp not connected' };
    }

    try {
      const jid = this.toJid(to);
      const result = await this.sock.sendMessage(jid, { text });
      return { sent: true, messageId: result?.key?.id || undefined };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[whatsapp] Send failed:', message);
      return { sent: false, error: message };
    }
  }
}

// Singleton instance
let _instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (!_instance) {
    _instance = new WhatsAppService();
  }
  return _instance;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/service.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/whatsapp/service.ts tests/lib/workflows/whatsapp/service.test.ts
git commit -m "feat(whatsapp): add WhatsApp service singleton with baileys connection"
```

---

### Task 4: Orchestrator Bridge

**Files:**
- Create: `src/lib/workflows/whatsapp/orchestrator-bridge.ts`
- Create: `tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbDelete = vi.fn();

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => mockDbSelect(),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        mockDbInsert(v);
        return { returning: vi.fn().mockResolvedValue([]) };
      },
    }),
    delete: () => ({
      where: () => mockDbDelete(),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({
  whatsappConversations: {},
  whatsappConfig: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
  and: vi.fn(),
}));

// Mock orchestrator
const mockGenerateWorkflow = vi.fn();
vi.mock('$lib/workflows/orchestrator', () => ({
  generateWorkflow: (...args: unknown[]) => mockGenerateWorkflow(...args),
}));

import { OrchestratorBridge } from '$lib/workflows/whatsapp/orchestrator-bridge';
import type { WhatsAppInboundMessage } from '$lib/workflows/whatsapp/types';

describe('OrchestratorBridge', () => {
  let bridge: OrchestratorBridge;
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendFn = vi.fn().mockResolvedValue({ sent: true });
    bridge = new OrchestratorBridge(sendFn, '');
    mockDbSelect.mockResolvedValue([]);
  });

  it('detects /clear command', () => {
    expect(bridge.isResetCommand('/clear')).toBe(true);
    expect(bridge.isResetCommand('/new')).toBe(true);
    expect(bridge.isResetCommand('/CLEAR')).toBe(true);
    expect(bridge.isResetCommand('hello')).toBe(false);
  });

  it('detects /clear as a reset and does not forward to orchestrator', async () => {
    const msg: WhatsAppInboundMessage = {
      from: '447359228511',
      text: '/clear',
      timestamp: Date.now(),
      messageId: 'msg-1',
      isGroup: false,
    };

    await bridge.handleMessage(msg);

    expect(sendFn).toHaveBeenCalledWith(
      '447359228511',
      expect.stringContaining('cleared'),
    );
    expect(mockGenerateWorkflow).not.toHaveBeenCalled();
  });

  it('forwards regular messages to orchestrator', async () => {
    mockGenerateWorkflow.mockResolvedValue({
      workflow: null,
      followUp: 'Here is my response',
      messages: [],
    });

    const msg: WhatsAppInboundMessage = {
      from: '447359228511',
      text: 'What workflows do I have?',
      timestamp: Date.now(),
      messageId: 'msg-2',
      isGroup: false,
    };

    await bridge.handleMessage(msg);

    expect(mockGenerateWorkflow).toHaveBeenCalled();
    expect(sendFn).toHaveBeenCalledWith('447359228511', 'Here is my response');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts
```

Expected: FAIL — `Cannot find module '$lib/workflows/whatsapp/orchestrator-bridge'`

- [ ] **Step 3: Write the orchestrator bridge**

Create `src/lib/workflows/whatsapp/orchestrator-bridge.ts`:

```typescript
import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { generateWorkflow } from '$lib/workflows/orchestrator';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;

export class OrchestratorBridge {
  private sendFn: SendFn;
  private soulMd: string;

  constructor(sendFn: SendFn, soulMd: string) {
    this.sendFn = sendFn;
    this.soulMd = soulMd;
  }

  setSoulMd(soulMd: string): void {
    this.soulMd = soulMd;
  }

  isResetCommand(text: string): boolean {
    const cmd = text.trim().toLowerCase();
    return cmd === '/clear' || cmd === '/new';
  }

  async handleMessage(msg: WhatsAppInboundMessage): Promise<void> {
    const { from, text } = msg;

    if (this.isResetCommand(text)) {
      await this.clearConversation(from);
      await this.sendFn(from, 'Conversation cleared. What can I help with?');
      return;
    }

    try {
      // Save user message
      await db.insert(whatsappConversations).values({
        phoneNumber: from,
        role: 'user',
        content: text,
      });

      // Load conversation history
      const history = await this.getConversationHistory(from);

      // Build orchestrator message with soul.md context
      const contextPrefix = this.soulMd
        ? `[System context — personality and style guide]\n${this.soulMd}\n\n[User conversation history]\n`
        : '';

      const conversationContext = history
        .slice(0, -1) // Exclude the message we just saved
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const fullMessage = contextPrefix + (conversationContext ? conversationContext + '\n\n' : '') + text;

      // Call orchestrator
      const result = await generateWorkflow(fullMessage, null);

      let responseText: string;

      if (result.followUp) {
        responseText = result.followUp;
      } else if (result.workflow) {
        responseText = result.workflow.explanation || 'Workflow created successfully.';
      } else {
        responseText = "I couldn't generate a workflow from that. Could you be more specific about what you'd like to automate?";
      }

      // Save assistant response
      await db.insert(whatsappConversations).values({
        phoneNumber: from,
        role: 'assistant',
        content: responseText,
      });

      await this.sendFn(from, responseText);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[whatsapp-bridge] Error handling message from ${from}:`, errMsg);
      await this.sendFn(from, 'Something went wrong. Try again in a moment.');
    }
  }

  private async getConversationHistory(
    phoneNumber: string,
  ): Promise<Array<{ role: string; content: string }>> {
    const rows = await db
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.phoneNumber, phoneNumber))
      .orderBy(asc(whatsappConversations.createdAt));

    return rows.map((r) => ({
      role: r.role,
      content: r.content,
    }));
  }

  private async clearConversation(phoneNumber: string): Promise<void> {
    await db
      .delete(whatsappConversations)
      .where(eq(whatsappConversations.phoneNumber, phoneNumber));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/whatsapp/orchestrator-bridge.ts tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts
git commit -m "feat(whatsapp): add orchestrator bridge for inbound message routing"
```

---

### Task 5: WhatsApp Node (Executor + Definition)

**Files:**
- Create: `src/lib/workflows/nodes/whatsapp.ts`
- Create: `tests/lib/workflows/whatsapp/whatsapp-node.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/workflows/whatsapp/whatsapp-node.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the WhatsApp service
const mockSendMessage = vi.fn();
const mockGetState = vi.fn();

vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: () => ({
    sendMessage: mockSendMessage,
    getState: mockGetState,
  }),
}));

import { whatsappExecutor, whatsappDef } from '$lib/workflows/nodes/whatsapp';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'run-1',
  workflowId: 'wf-1',
  workspaceDir: '/tmp',
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
  getOutgoingEdges: vi.fn().mockReturnValue([]),
  getNodeConfig: vi.fn(),
};

describe('whatsappExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ status: 'connected' });
  });

  it('sends a message with interpolated templates', async () => {
    mockSendMessage.mockResolvedValue({ sent: true, messageId: 'msg-abc' });

    const result = await whatsappExecutor.execute(
      { output: { name: 'John', summary: 'All good' } },
      { to: '+447359228511', message: 'Hi {{input.output.name}}, report: {{input.output.summary}}' },
      mockContext,
    );

    expect(mockSendMessage).toHaveBeenCalledWith(
      '+447359228511',
      'Hi John, report: All good',
    );
    expect(result.output.sent).toBe(true);
    expect(result.output.messageId).toBe('msg-abc');
  });

  it('returns error when WhatsApp is not connected', async () => {
    mockGetState.mockReturnValue({ status: 'disconnected' });
    mockSendMessage.mockResolvedValue({ sent: false, error: 'WhatsApp not connected' });

    const result = await whatsappExecutor.execute(
      {},
      { to: '+447359228511', message: 'test' },
      mockContext,
    );

    expect(result.output.sent).toBe(false);
    expect(result.output.error).toBe('WhatsApp not connected');
  });

  it('returns error when no recipient configured', async () => {
    const result = await whatsappExecutor.execute(
      {},
      { to: '', message: 'test' },
      mockContext,
    );

    expect(result.output.sent).toBe(false);
    expect(result.output.error).toContain('No recipient');
  });
});

describe('whatsappDef', () => {
  it('is an integration node', () => {
    expect(whatsappDef.type).toBe('whatsapp');
    expect(whatsappDef.category).toBe('integration');
  });

  it('has input and output ports', () => {
    expect(whatsappDef.inputs).toHaveLength(1);
    expect(whatsappDef.outputs).toHaveLength(1);
  });

  it('has basicConfig fields', () => {
    expect(whatsappDef.basicConfig).toBeDefined();
    expect(whatsappDef.basicConfig!.length).toBeGreaterThanOrEqual(2);
  });

  it('has llmDescription for the orchestrator', () => {
    expect(whatsappDef.llmDescription).toBeDefined();
    expect(whatsappDef.llmDescription!.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/whatsapp-node.test.ts
```

Expected: FAIL — `Cannot find module '$lib/workflows/nodes/whatsapp'`

- [ ] **Step 3: Write the WhatsApp node**

Create `src/lib/workflows/nodes/whatsapp.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getWhatsAppService } from '../whatsapp/service';

export const whatsappExecutor: NodeExecutor = {
  type: 'whatsapp',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const to = interpolateTemplate((config.to as string) || '', input);
    const message = interpolateTemplate((config.message as string) || '', input);

    if (!to) {
      return { output: { sent: false, error: 'No recipient (to) configured' } };
    }

    if (!message) {
      return { output: { sent: false, error: 'No message content configured' } };
    }

    const service = getWhatsAppService();
    const result = await service.sendMessage(to, message);

    return {
      output: {
        sent: result.sent,
        messageId: result.messageId || null,
        error: result.error || null,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in to/message fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        sent: { type: 'boolean' },
        messageId: { type: 'string' },
        error: { type: 'string' },
      },
    };
  },
};

export const whatsappDef: NodeDefinition = {
  type: 'whatsapp',
  label: 'WhatsApp',
  category: 'integration',
  description: 'Send a WhatsApp message. To and message fields support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient phone number (E.164 format). Supports {{input.field}} templates.' },
      message: { type: 'string', description: 'Message text. Supports {{input.field}} templates.' },
    },
    required: ['to', 'message'],
  },
  defaultConfig: { to: '', message: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'to',
      label: 'To (Phone Number)',
      type: 'text',
      placeholder: '+447359228511 or {{input.output.phone}}',
      description: 'E.164 format. Supports template interpolation.',
    },
    {
      key: 'message',
      label: 'Message',
      type: 'template-textarea',
      placeholder: 'Hi {{input.output.name}}, your report is ready.',
      description: 'Message text. Supports {{input.field}} templates.',
    },
  ],
  llmDescription: `Send a WhatsApp message to a phone number. Use this node when a workflow needs to notify someone via WhatsApp.

IMPORTANT: The output is wrapped in an \`output\` object. Downstream nodes should access \`input.output.sent\`, \`input.output.messageId\`, or \`input.output.error\`.

The \`to\` field must be an E.164 phone number (e.g., "+447359228511"). Both \`to\` and \`message\` support template interpolation with \`{{input.field}}\` syntax.

Requires an active WhatsApp connection (configured via the WhatsApp settings in the workflows UI).`,
  llmExamples: [
    { to: '+447359228511', message: 'Daily report: {{input.output.summary}}' },
    { to: '{{input.output.phone}}', message: '{{input.output.notification}}' },
  ],
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/whatsapp-node.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/nodes/whatsapp.ts tests/lib/workflows/whatsapp/whatsapp-node.test.ts
git commit -m "feat(whatsapp): add WhatsApp send node (executor + definition)"
```

---

### Task 6: Register Node and Boot Service

**Files:**
- Modify: `src/lib/workflows/index.ts`

- [ ] **Step 1: Add WhatsApp node registration**

Add the import alongside the other node imports in `src/lib/workflows/index.ts`:

```typescript
import { whatsappDef, whatsappExecutor } from './nodes/whatsapp';
```

Add registration alongside the other `registry.register()` calls:

```typescript
registry.register(whatsappDef, whatsappExecutor);
```

- [ ] **Step 2: Add WhatsApp service boot**

Add this import at the top of `src/lib/workflows/index.ts`:

```typescript
import { getWhatsAppService } from './whatsapp/service';
import { OrchestratorBridge } from './whatsapp/orchestrator-bridge';
import { db } from '$lib/db';
import { whatsappConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
```

Add this at the bottom of the file (after dynamic nodes loading, before exports):

```typescript
// Boot WhatsApp service if enabled
async function bootWhatsApp() {
  try {
    const [config] = await db
      .select()
      .from(whatsappConfig)
      .where(eq(whatsappConfig.id, 'default'))
      .limit(1);

    if (!config?.enabled) {
      console.log('[whatsapp] Not enabled — skipping boot');
      return;
    }

    const service = getWhatsAppService();
    service.setAllowedNumbers((config.allowedNumbers as string[]) || []);

    const bridge = new OrchestratorBridge(
      (to, text) => service.sendMessage(to, text),
      config.soulMd || '',
    );

    service.onMessage((msg) => bridge.handleMessage(msg));
    await service.connect(config.authDir || 'data/whatsapp-auth');

    console.log('[whatsapp] Service booted');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[whatsapp] Boot failed:', msg);
  }
}

bootWhatsApp();
```

- [ ] **Step 3: Verify build passes**

```bash
cd ~/strange_rambling_svelte && npx svelte-kit sync && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/index.ts
git commit -m "feat(whatsapp): register whatsapp node and auto-boot service"
```

---

### Task 7: WhatsApp API Routes

**Files:**
- Create: `src/routes/api/workflows/whatsapp/status/+server.ts`
- Create: `src/routes/api/workflows/whatsapp/connect/+server.ts`
- Create: `src/routes/api/workflows/whatsapp/config/+server.ts`
- Create: `src/routes/api/workflows/whatsapp/conversations/+server.ts`
- Create: `src/routes/api/workflows/whatsapp/conversations/[phoneNumber]/+server.ts`

- [ ] **Step 1: Create status endpoint**

Create `src/routes/api/workflows/whatsapp/status/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

export const GET: RequestHandler = async () => {
  const service = getWhatsAppService();
  return json(service.getState());
};
```

- [ ] **Step 2: Create connect/disconnect endpoint**

Create `src/routes/api/workflows/whatsapp/connect/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';
import { OrchestratorBridge } from '$lib/workflows/whatsapp/orchestrator-bridge';
import { db } from '$lib/db';
import { whatsappConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(whatsappConfig)
    .where(eq(whatsappConfig.id, 'default'))
    .limit(1);

  const authDir = config?.authDir || 'data/whatsapp-auth';
  const service = getWhatsAppService();

  if (config) {
    service.setAllowedNumbers((config.allowedNumbers as string[]) || []);
  }

  const bridge = new OrchestratorBridge(
    (to, text) => service.sendMessage(to, text),
    config?.soulMd || '',
  );

  service.onMessage((msg) => bridge.handleMessage(msg));
  await service.connect(authDir);

  return json({ status: 'connecting' });
};

export const DELETE: RequestHandler = async () => {
  const service = getWhatsAppService();
  await service.disconnect();
  return json({ status: 'disconnected' });
};
```

- [ ] **Step 3: Create config endpoint**

Create `src/routes/api/workflows/whatsapp/config/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { whatsappConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

export const GET: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(whatsappConfig)
    .where(eq(whatsappConfig.id, 'default'))
    .limit(1);

  if (!config) {
    return json({
      enabled: false,
      allowedNumbers: [],
      soulMd: '',
      authDir: 'data/whatsapp-auth',
    });
  }

  return json({
    enabled: config.enabled,
    allowedNumbers: config.allowedNumbers,
    soulMd: config.soulMd,
    authDir: config.authDir,
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { enabled, allowedNumbers, soulMd, authDir } = body;

  const values: Record<string, unknown> = { id: 'default', updatedAt: new Date() };
  if (typeof enabled === 'boolean') values.enabled = enabled;
  if (Array.isArray(allowedNumbers)) values.allowedNumbers = allowedNumbers;
  if (typeof soulMd === 'string') values.soulMd = soulMd;
  if (typeof authDir === 'string') values.authDir = authDir;

  await db
    .insert(whatsappConfig)
    .values(values as any)
    .onConflictDoUpdate({
      target: whatsappConfig.id,
      set: {
        ...values,
        id: undefined, // Don't update the PK
      } as any,
    });

  // Update service allowlist in real-time
  if (Array.isArray(allowedNumbers)) {
    getWhatsAppService().setAllowedNumbers(allowedNumbers);
  }

  return json({ success: true });
};
```

- [ ] **Step 4: Create conversations list endpoint**

Create `src/routes/api/workflows/whatsapp/conversations/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  // Get distinct phone numbers with their latest message
  const threads = await db.execute(sql`
    SELECT DISTINCT ON (phone_number)
      phone_number,
      content as last_message,
      role as last_role,
      created_at as last_message_at
    FROM whatsapp_conversations
    ORDER BY phone_number, created_at DESC
  `);

  return json({ conversations: threads.rows });
};
```

- [ ] **Step 5: Create per-number conversation endpoint**

Create `src/routes/api/workflows/whatsapp/conversations/[phoneNumber]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const { phoneNumber } = params;

  const messages = await db
    .select()
    .from(whatsappConversations)
    .where(eq(whatsappConversations.phoneNumber, phoneNumber))
    .orderBy(asc(whatsappConversations.createdAt));

  return json({ messages });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const { phoneNumber } = params;

  await db
    .delete(whatsappConversations)
    .where(eq(whatsappConversations.phoneNumber, phoneNumber));

  return json({ cleared: true });
};
```

- [ ] **Step 6: Verify build passes**

```bash
cd ~/strange_rambling_svelte && npx svelte-kit sync && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/whatsapp/
git commit -m "feat(whatsapp): add API routes for status, config, connect, and conversations"
```

---

### Task 8: Seed Soul.md from OpenClaw

**Files:**
- No new files — uses existing API

- [ ] **Step 1: Seed the default WhatsApp config with soul.md content**

Read the existing soul.md from OpenClaw and insert it as the default config:

```bash
cd ~/strange_rambling_svelte

# Read the soul.md content and seed it into the database
SOUL_CONTENT=$(cat ~/.openclaw/workspace/SOUL.md)

node -e "
const { db } = await import('./src/lib/db/index.js');
const { whatsappConfig } = await import('./src/lib/db/schema.js');

await db.insert(whatsappConfig).values({
  id: 'default',
  enabled: false,
  allowedNumbers: JSON.stringify(['+447359228511']),
  soulMd: \`$(cat ~/.openclaw/workspace/SOUL.md)\`,
  authDir: 'data/whatsapp-auth',
}).onConflictDoUpdate({
  target: whatsappConfig.id,
  set: {
    soulMd: \`$(cat ~/.openclaw/workspace/SOUL.md)\`,
    allowedNumbers: JSON.stringify(['+447359228511']),
  },
});

console.log('WhatsApp config seeded with soul.md');
process.exit(0);
"
```

If the above node script doesn't work due to ESM/import issues, use a direct SQL approach:

```bash
psql -d strange_rambling -c "
INSERT INTO whatsapp_config (id, enabled, allowed_numbers, soul_md, auth_dir)
VALUES (
  'default',
  false,
  '[\"447359228511\"]'::jsonb,
  E'$(sed "s/'/\\\\'/g" ~/.openclaw/workspace/SOUL.md)',
  'data/whatsapp-auth'
)
ON CONFLICT (id) DO UPDATE SET
  soul_md = EXCLUDED.soul_md,
  allowed_numbers = EXCLUDED.allowed_numbers,
  updated_at = NOW();
"
```

- [ ] **Step 2: Verify the config was seeded**

```bash
psql -d strange_rambling -c "SELECT id, enabled, allowed_numbers, length(soul_md) as soul_length FROM whatsapp_config;"
```

Expected: One row with `id=default`, `enabled=false`, `allowed_numbers` containing the phone number, `soul_length > 0`.

---

### Task 9: Manual Integration Test

- [ ] **Step 1: Start the dev server**

```bash
cd ~/strange_rambling_svelte && npm run dev
```

- [ ] **Step 2: Test the status endpoint**

```bash
curl http://homeserv:5173/api/workflows/whatsapp/status
```

Expected: `{"status":"disconnected","qrCode":null,"connectedNumber":null}`

- [ ] **Step 3: Test the config endpoint**

```bash
curl http://homeserv:5173/api/workflows/whatsapp/config
```

Expected: JSON with `enabled`, `allowedNumbers`, `soulMd`, `authDir` fields.

- [ ] **Step 4: Update config to enable WhatsApp**

```bash
curl -X PUT http://homeserv:5173/api/workflows/whatsapp/config \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true}'
```

- [ ] **Step 5: Trigger connection and verify QR code appears**

```bash
curl -X POST http://homeserv:5173/api/workflows/whatsapp/connect
```

Then poll status:

```bash
curl http://homeserv:5173/api/workflows/whatsapp/status
```

Expected: `status` transitions to `"qr_pending"` with a `qrCode` value.

- [ ] **Step 6: Link WhatsApp Business account by scanning QR**

The QR string from the status endpoint needs to be rendered. Open a browser to the workflows UI or use a QR rendering tool to scan the code with WhatsApp on the business phone.

After scanning:

```bash
curl http://homeserv:5173/api/workflows/whatsapp/status
```

Expected: `{"status":"connected","qrCode":null,"connectedNumber":"447359228511"}`

- [ ] **Step 7: Test sending a message from a workflow (via API)**

Create a test workflow with a WhatsApp send node, or test the node directly by running a simple workflow.

- [ ] **Step 8: Test inbound messaging**

Send a WhatsApp message to the business number from your personal phone. Check the conversation endpoint:

```bash
curl http://homeserv:5173/api/workflows/whatsapp/conversations
```

Expected: The conversation appears with the orchestrator's response.

- [ ] **Step 9: Test /clear command**

Send `/clear` from WhatsApp. Verify:
```bash
curl http://homeserv:5173/api/workflows/whatsapp/conversations/447359228511
```

Expected: Empty messages array.
