# Web Scraper Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `web-scrape` workflow node that drives headless Playwright inside the existing `jkai-sandbox` container to fetch rendered HTML from websites while masking bot signals (stealth, human pacing, persistent profiles, residential IP via the homeserv host). Also add a `web-scrape-llm` extractor node that pipes the rendered DOM through an LLM for field extraction, and a credentials vault for behind-login scraping. First target: `civilservicejobs.gov.uk`.

**Architecture:** The node constructs a JSON job spec, writes it and a Python runner script into the sandbox workspace, invokes `python3 runner.py` via `execInSandbox`, reads JSON stdout back. Python runner uses `playwright` (already installed in the sandbox Dockerfile) with `playwright-stealth` patches, a persistent per-domain browser profile (`~/.openclaw/scraper-profiles/<profile>/`), human-pacing utilities (randomised delays, viewport-anchored scrolling), and optional cookie injection from the credentials vault. Emits workflow events for progress (page loaded, pagination advance, extraction complete) that surface in `/jkai` chat. Credentials for login-gated scrapes are encrypted at rest in `scraper_credentials` and decrypted only when the runner is invoked.

**Tech Stack:** SvelteKit, TypeScript, Vitest, Drizzle ORM, PostgreSQL, Python 3.12 + `playwright` + `playwright-stealth` (in sandbox), `jkai-sandbox` Docker container, AES-256-GCM for credential encryption.

---

## File Structure

### New Files

```
src/lib/workflows/scraper/types.ts                   # ScrapeJob, ExtractRule, ScrapeResult types
src/lib/workflows/scraper/crypto.ts                  # AES-GCM cred encryption
src/lib/workflows/scraper/runner.ts                  # Node→sandbox orchestration (writes job, runs python, parses stdout)
src/lib/workflows/scraper/profiles.ts                # Per-domain profile path + lifecycle helpers
src/lib/workflows/scraper/credentials.ts             # CRUD over scraper_credentials with encryption
src/lib/workflows/scraper/python/scrape.py           # The Python Playwright runner (shipped via writeFileInSandbox on each run)
src/lib/workflows/scraper/python/civilservicejobs.py # Target-specific helper for civilservicejobs.gov.uk

src/lib/workflows/nodes/web-scrape.ts                # Executor + definition
src/lib/workflows/nodes/web-scrape.def.ts
src/lib/workflows/nodes/web-scrape-llm.ts            # LLM extraction over scraped HTML/text
src/lib/workflows/nodes/web-scrape-llm.def.ts

src/routes/admin/scraper/+page.server.ts             # Credentials + profiles + run-log UI
src/routes/admin/scraper/+page.svelte
src/routes/api/scraper/credentials/+server.ts        # Add/edit/delete credentials
src/routes/api/scraper/profiles/+server.ts           # List/clear profiles
src/routes/api/scraper/test/+server.ts               # Ad-hoc scrape test endpoint

tests/lib/workflows/scraper/crypto.test.ts
tests/lib/workflows/scraper/runner.test.ts
tests/lib/workflows/scraper/profiles.test.ts
tests/lib/workflows/scraper/credentials.test.ts
tests/lib/workflows/nodes/web-scrape.test.ts
tests/lib/workflows/nodes/web-scrape-llm.test.ts
```

### Modified Files

```
docker/jkai-sandbox/Dockerfile                       # Add playwright-stealth pip + a persistent-profile volume hint
src/lib/db/schema.ts                                 # Add scraper_credentials + scraper_run_log tables
src/lib/workflows/index.ts                           # Register scrape node executors
src/lib/workflows/registry-client.ts                 # Register scrape defs
src/lib/workflows/events.ts                          # Add scraper.* event types
src/lib/jkai/sandbox.ts                              # Mount a bind volume for scraper-profiles (if not already volumed)
package.json                                         # Nothing new on the Node side
```

---

## Preconditions

- `jkai-sandbox` container exists and runs (verify with `docker ps | grep jkai-sandbox`).
- `SCRAPER_VAULT_KEY` env var will be added — 32 random bytes hex. Generate with `openssl rand -hex 32` before Task 2 and add to `.env`.
- The host path `~/.openclaw/scraper-profiles/` must be bind-mounted into the sandbox so Chromium profile data persists across sandbox rebuilds. See Task 3 for the mount change.
- Residential IP intent: the sandbox container runs on homeserv, not the VPS. Confirm production workflow runs stay on homeserv or a homeserv-bound worker, not on the VPS.

---

### Task 1: Dockerfile — add playwright-stealth

**Files:**
- Modify: `docker/jkai-sandbox/Dockerfile`

- [ ] **Step 1.1: Add playwright-stealth**

In `docker/jkai-sandbox/Dockerfile`, modify the pip install block. Change:

```dockerfile
RUN pip install --no-cache-dir \
    requests \
    pandas \
    numpy \
    matplotlib \
    beautifulsoup4 \
    httpx \
    pyyaml \
    playwright \
    lxml
```

To add `playwright-stealth` and `tenacity` (for retry wrappers):

```dockerfile
RUN pip install --no-cache-dir \
    requests \
    pandas \
    numpy \
    matplotlib \
    beautifulsoup4 \
    httpx \
    pyyaml \
    playwright \
    playwright-stealth \
    tenacity \
    lxml
```

- [ ] **Step 1.2: Rebuild image**

Run: `cd ~/strange_rambling_svelte && docker build -t jkai-sandbox:latest docker/jkai-sandbox/`

Expected: build succeeds. The `playwright install chromium` step is cached; only the pip step reruns.

- [ ] **Step 1.3: Recreate container**

```bash
docker rm -f jkai-sandbox 2>/dev/null || true
# The container will be re-created by ensureSandboxRunning() on next workflow use,
# but to avoid breaking /jkai/build in the interim, re-run it manually:
docker run -d --name jkai-sandbox --restart unless-stopped \
  -v ~/.openclaw/scraper-profiles:/home/jkai/scraper-profiles \
  jkai-sandbox:latest
```

The `-v` bind is new — see Task 3 for making `ensureSandboxRunning()` include it.

- [ ] **Step 1.4: Verify inside container**

Run: `docker exec jkai-sandbox python3 -c "from playwright_stealth import Stealth; print('ok')"`

Expected: `ok`.

- [ ] **Step 1.5: Commit**

```bash
cd ~/strange_rambling_svelte
git add docker/jkai-sandbox/Dockerfile
git commit -m "chore(sandbox): add playwright-stealth + tenacity for scraper node"
```

---

### Task 2: Credential encryption helper

Same AES-GCM pattern as the Gmail plan but keyed separately.

**Files:**
- Create: `src/lib/workflows/scraper/crypto.ts`
- Test: `tests/lib/workflows/scraper/crypto.test.ts`

- [ ] **Step 2.1: Write failing test**

```typescript
// tests/lib/workflows/scraper/crypto.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { SCRAPER_VAULT_KEY: '1'.repeat(64) },
}));

import { encryptCredential, decryptCredential } from '$lib/workflows/scraper/crypto';

describe('scraper crypto', () => {
  it('round-trips a JSON credential blob', () => {
    const cred = { username: 'user@example.com', password: 'p@ssw0rd!', totpSecret: 'ABC123' };
    const enc = encryptCredential(cred);
    expect(typeof enc).toBe('string');
    expect(enc).not.toContain('p@ssw0rd');
    const dec = decryptCredential(enc);
    expect(dec).toEqual(cred);
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptCredential({ a: 1 });
    const parts = enc.split(':');
    const tampered = [parts[0], parts[1], parts[2].slice(0, -2) + '00'].join(':');
    expect(() => decryptCredential(tampered)).toThrow();
  });
});
```

- [ ] **Step 2.2: Run test, verify FAIL**

Run: `npx vitest run tests/lib/workflows/scraper/crypto.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 2.3: Implement**

```typescript
// src/lib/workflows/scraper/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';

function getKey(): Buffer {
  const hex = env.SCRAPER_VAULT_KEY;
  if (!hex || hex.length !== 64) throw new Error('SCRAPER_VAULT_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(hex, 'hex');
}

export function encryptCredential(value: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptCredential<T = Record<string, unknown>>(enc: string): T {
  const [ivH, tagH, ctH] = enc.split(':');
  if (!ivH || !tagH || !ctH) throw new Error('Malformed encrypted credential');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}
```

- [ ] **Step 2.4: Generate SCRAPER_VAULT_KEY, add to `.env` (user action)**

Run: `openssl rand -hex 32`. Paste result into `.env` as `SCRAPER_VAULT_KEY=<hex>`. Do not commit `.env`.

- [ ] **Step 2.5: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/scraper/crypto.test.ts`

Expected: 2 tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/workflows/scraper/crypto.ts tests/lib/workflows/scraper/crypto.test.ts
git commit -m "feat(scraper): add AES-GCM credential vault helper"
```

---

### Task 3: Sandbox — bind-mount scraper-profiles

Persistent browser profiles survive container rebuilds when the host bind-mounts the profile dir.

**Files:**
- Modify: `src/lib/jkai/sandbox.ts`

- [ ] **Step 3.1: Inspect current docker-run invocation**

Read the `ensureSandboxRunning()` function in `src/lib/jkai/sandbox.ts`. Locate the `docker run` invocation. It currently does not bind-mount `scraper-profiles`.

- [ ] **Step 3.2: Add the bind mount**

In the `docker run` invocation inside `ensureSandboxRunning()`, add a mount:

```
-v ${os.homedir()}/.openclaw/scraper-profiles:/home/jkai/scraper-profiles
```

Also: before invoking `docker run`, ensure the host path exists:

```typescript
import { mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

const SCRAPER_PROFILES_HOST = join(os.homedir(), '.openclaw', 'scraper-profiles');
mkdirSync(SCRAPER_PROFILES_HOST, { recursive: true });
```

Apply only the minimal diff — follow existing style in the file (the file likely has similar `mkdirSync` calls for workspace dirs).

- [ ] **Step 3.3: Recreate container to pick up the mount**

```bash
docker rm -f jkai-sandbox
# Let ensureSandboxRunning() re-create it on next workflow call, OR:
# Run from within the service by invoking a trivial workflow; OR run manually matching the same flags.
```

Verify the mount is present: `docker inspect jkai-sandbox | grep -A2 scraper-profiles`.

- [ ] **Step 3.4: Commit**

```bash
git add src/lib/jkai/sandbox.ts
git commit -m "feat(scraper): bind-mount ~/.openclaw/scraper-profiles into sandbox"
```

---

### Task 4: Database schema

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 4.1: Add tables**

Append to `src/lib/db/schema.ts`:

```typescript
// ---- Scraper ----

export const scraperCredentials = pgTable('scraper_credentials', {
  id: serial('id').primaryKey(),
  domain: text('domain').notNull(),      // e.g. 'civilservicejobs.gov.uk'
  label: text('label').notNull(),        // human-friendly label
  credentialEnc: text('credential_enc').notNull(), // AES-GCM, JSON blob
  loginUrl: text('login_url'),           // optional — where to POST/fill credentials
  loginStrategy: text('login_strategy').notNull().default('form'), // 'form' | 'script' | 'cookie'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const scraperRunLog = pgTable('scraper_run_log', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  profile: text('profile').notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
  success: boolean('success').notNull().default(false),
  pagesLoaded: serial('pages_loaded'), // count
  error: text('error'),
  workflowRunId: text('workflow_run_id'), // nullable — ad-hoc runs have no workflow id
});

export type ScraperCredential = typeof scraperCredentials.$inferSelect;
export type ScraperRunLogRow = typeof scraperRunLog.$inferSelect;
```

Note: `pages_loaded` using `serial` is wrong for a counter — use `integer('pages_loaded').notNull().default(0)` instead. Correct before committing.

Corrected:

```typescript
  pagesLoaded: integer('pages_loaded').notNull().default(0),
```

Import `integer` from `drizzle-orm/pg-core` (add to existing import if not already present).

- [ ] **Step 4.2: Push schema**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push`

Expected: two new tables created.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(scraper): add scraper_credentials + scraper_run_log tables"
```

---

### Task 5: Types module

**Files:**
- Create: `src/lib/workflows/scraper/types.ts`

- [ ] **Step 5.1: Define types**

```typescript
// src/lib/workflows/scraper/types.ts

export interface ExtractRule {
  /** Output field name */
  field: string;
  /** CSS selector */
  selector: string;
  /** What to pull from the matched node. Default 'text'. */
  attr?: 'text' | 'html' | 'href' | 'src' | string;
  /** If true, return all matches as an array. If false, return first match as a scalar. */
  multi?: boolean;
  /** Optional post-processing: trim (default true), regex match group 1 */
  trim?: boolean;
  regex?: string;
}

export interface ScrapeJob {
  /** Starting URL */
  url: string;
  /** Profile name — maps to ~/.openclaw/scraper-profiles/<profile>/ inside the sandbox */
  profile: string;
  /** Wait condition before extracting */
  waitFor: { type: 'networkidle' } | { type: 'selector'; selector: string; timeoutMs?: number } | { type: 'timeout'; ms: number };
  /** Extraction rules — runs once per page */
  extract: ExtractRule[];
  /** Optional pagination */
  pagination?: {
    type: 'next-link';
    nextSelector: string;
    maxPages: number;
  } | {
    type: 'url-template';
    /** e.g. "https://...&page={n}" */
    template: string;
    start: number;
    maxPages: number;
  };
  /** Credentials — looked up via scraper_credentials by id (resolved in Node, passed as a minimal cookie jar or script snippet) */
  credentialId?: number;
  /** Human-like pacing: min/max delay between actions (ms). Default 800–2500. */
  pacing?: { minMs: number; maxMs: number };
  /** Whether to run robots.txt check before scraping. Default true. */
  respectRobots?: boolean;
  /** Optional screenshot on failure. Default true. */
  screenshotOnFailure?: boolean;
  /** Optional viewport override. Default randomised. */
  viewport?: { width: number; height: number };
  /** Optional user-agent override. Default: a real recent Chrome UA. */
  userAgent?: string;
}

export interface ExtractedPage {
  url: string;
  fields: Record<string, string | string[]>;
  /** Full page HTML, only when the job sets includeHtml */
  html?: string;
  /** Text content */
  text?: string;
}

export interface ScrapeResult {
  success: boolean;
  pages: ExtractedPage[];
  error?: string;
  screenshotPathInSandbox?: string;
  robotsBlocked?: boolean;
  runLogId?: number;
}
```

- [ ] **Step 5.2: Commit**

```bash
git add src/lib/workflows/scraper/types.ts
git commit -m "feat(scraper): add shared scraper types"
```

---

### Task 6: Profiles helper

**Files:**
- Create: `src/lib/workflows/scraper/profiles.ts`
- Test: `tests/lib/workflows/scraper/profiles.test.ts`

- [ ] **Step 6.1: Write failing test**

```typescript
// tests/lib/workflows/scraper/profiles.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeProfileName, profilePathInSandbox } from '$lib/workflows/scraper/profiles';

describe('profiles', () => {
  it('normalizes profile names to safe filesystem names', () => {
    expect(normalizeProfileName('Civil Service Jobs')).toBe('civil-service-jobs');
    expect(normalizeProfileName('foo.bar/baz')).toBe('foo-bar-baz');
    expect(normalizeProfileName('')).toBe('default');
    expect(normalizeProfileName('___')).toBe('default');
  });

  it('returns the sandbox path for a profile', () => {
    expect(profilePathInSandbox('civilservicejobs-gov-uk')).toBe('/home/jkai/scraper-profiles/civilservicejobs-gov-uk');
  });
});
```

- [ ] **Step 6.2: Run test, verify FAIL**

Run: `npx vitest run tests/lib/workflows/scraper/profiles.test.ts`

Expected: FAIL.

- [ ] **Step 6.3: Implement**

```typescript
// src/lib/workflows/scraper/profiles.ts
export const SANDBOX_PROFILES_BASE = '/home/jkai/scraper-profiles';

export function normalizeProfileName(raw: string): string {
  const cleaned = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'default';
}

export function profilePathInSandbox(profile: string): string {
  return `${SANDBOX_PROFILES_BASE}/${normalizeProfileName(profile)}`;
}
```

- [ ] **Step 6.4: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/scraper/profiles.test.ts`

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/workflows/scraper/profiles.ts tests/lib/workflows/scraper/profiles.test.ts
git commit -m "feat(scraper): add profile path helper"
```

---

### Task 7: Credentials CRUD helper

**Files:**
- Create: `src/lib/workflows/scraper/credentials.ts`
- Test: `tests/lib/workflows/scraper/credentials.test.ts`

- [ ] **Step 7.1: Write failing test**

```typescript
// tests/lib/workflows/scraper/credentials.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { SCRAPER_VAULT_KEY: '2'.repeat(64) } }));

const dbStore: any[] = [];
const db: any = {
  insert: vi.fn(() => ({
    values: vi.fn((v: any) => ({
      returning: vi.fn(async () => { dbStore.push({ id: dbStore.length + 1, ...v }); return [dbStore.at(-1)]; }),
    })),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => dbStore),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(async () => ({})),
  })),
};

vi.mock('$lib/db', () => ({ db }));
vi.mock('$lib/db/schema', () => ({ scraperCredentials: { id: 'id', domain: 'domain' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: any, b: any) => ({ a, b }) }));

import { saveCredential, loadCredentialForRunner } from '$lib/workflows/scraper/credentials';

describe('credentials', () => {
  beforeEach(() => { dbStore.length = 0; });

  it('saves a credential with encrypted blob and never returns the plaintext', async () => {
    const row = await saveCredential({
      domain: 'civilservicejobs.gov.uk',
      label: 'main',
      loginStrategy: 'form',
      loginUrl: 'https://civilservicejobs.gov.uk/login',
      credential: { username: 'me', password: 'secret' },
    });
    expect(row.credentialEnc).toBeDefined();
    expect(row.credentialEnc).not.toContain('secret');
    expect((row as any).credential).toBeUndefined();
  });

  it('decrypts a credential for the runner only', async () => {
    await saveCredential({
      domain: 'x.com', label: 'l', loginStrategy: 'form',
      credential: { username: 'u', password: 'p' },
    });
    const decrypted = await loadCredentialForRunner(1);
    expect(decrypted).toEqual(expect.objectContaining({
      domain: 'x.com',
      credential: { username: 'u', password: 'p' },
    }));
  });
});
```

- [ ] **Step 7.2: Run test, verify FAIL**

Expected: module missing.

- [ ] **Step 7.3: Implement**

```typescript
// src/lib/workflows/scraper/credentials.ts
import { db } from '$lib/db';
import { scraperCredentials, type ScraperCredential } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptCredential, decryptCredential } from './crypto';

export interface SaveCredentialInput {
  domain: string;
  label: string;
  loginUrl?: string;
  loginStrategy: 'form' | 'script' | 'cookie';
  credential: Record<string, unknown>;
}

export async function saveCredential(input: SaveCredentialInput): Promise<Omit<ScraperCredential, never>> {
  const credentialEnc = encryptCredential(input.credential);
  const [row] = await db.insert(scraperCredentials).values({
    domain: input.domain,
    label: input.label,
    loginUrl: input.loginUrl,
    loginStrategy: input.loginStrategy,
    credentialEnc,
  }).returning();
  return row;
}

export interface CredentialForRunner {
  id: number;
  domain: string;
  loginUrl: string | null;
  loginStrategy: 'form' | 'script' | 'cookie';
  credential: Record<string, unknown>;
}

export async function loadCredentialForRunner(id: number): Promise<CredentialForRunner | null> {
  const rows = await db.select().from(scraperCredentials).where(eq(scraperCredentials.id, id));
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    loginUrl: row.loginUrl ?? null,
    loginStrategy: row.loginStrategy as CredentialForRunner['loginStrategy'],
    credential: decryptCredential(row.credentialEnc),
  };
}

export async function deleteCredential(id: number): Promise<void> {
  await db.delete(scraperCredentials).where(eq(scraperCredentials.id, id));
}
```

- [ ] **Step 7.4: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/scraper/credentials.test.ts`

Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/workflows/scraper/credentials.ts tests/lib/workflows/scraper/credentials.test.ts
git commit -m "feat(scraper): add credentials CRUD with encryption"
```

---

### Task 8: Python runner — the core scraping script

This is the workhorse. Written as a standalone Python script; the Node runner writes it to the sandbox and invokes it. Takes a JSON job spec on stdin, emits JSON result on stdout, progress NDJSON on stderr (so the Node side can stream events).

**Files:**
- Create: `src/lib/workflows/scraper/python/scrape.py`

- [ ] **Step 8.1: Write the Python runner**

```python
# src/lib/workflows/scraper/python/scrape.py
"""
Playwright + stealth scraper runner.

Input:  JSON ScrapeJob on stdin
Output: JSON ScrapeResult on stdout
Progress: NDJSON lines on stderr (one event per line, each a {"t":"...", ...})

Runs inside the jkai-sandbox container. Profiles persist at /home/jkai/scraper-profiles/<profile>/.
"""
from __future__ import annotations
import asyncio, json, sys, os, random, re, time, traceback
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional

try:
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout
    from playwright_stealth import Stealth
except Exception as e:
    print(json.dumps({"success": False, "pages": [], "error": f"import failed: {e}"}))
    sys.exit(1)


PROFILES_BASE = Path("/home/jkai/scraper-profiles")

REALISTIC_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

DEFAULT_VIEWPORTS = [
    {"width": 1366, "height": 768},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1920, "height": 1080},
]


def emit_progress(event: Dict[str, Any]) -> None:
    sys.stderr.write(json.dumps(event) + "\n")
    sys.stderr.flush()


async def human_delay(min_ms: int, max_ms: int) -> None:
    await asyncio.sleep(random.uniform(min_ms / 1000, max_ms / 1000))


async def human_scroll(page, pacing: Dict[str, int]) -> None:
    # Two or three small scrolls, then a pause
    for _ in range(random.randint(2, 3)):
        await page.mouse.wheel(0, random.randint(200, 600))
        await human_delay(pacing["minMs"], pacing["maxMs"])


async def apply_extract_rules(page, rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for rule in rules:
        selector = rule["selector"]
        attr = rule.get("attr", "text")
        multi = bool(rule.get("multi", False))
        trim = rule.get("trim", True)
        regex_pat = rule.get("regex")
        locator = page.locator(selector)
        count = await locator.count()
        if count == 0:
            out[rule["field"]] = [] if multi else None
            continue

        async def pull(i: int) -> str:
            el = locator.nth(i)
            if attr == "text":
                return await el.text_content() or ""
            elif attr == "html":
                return await el.inner_html() or ""
            else:
                return await el.get_attribute(attr) or ""

        values: List[str] = []
        limit = count if multi else 1
        for i in range(limit):
            v = await pull(i)
            if trim:
                v = v.strip()
            if regex_pat:
                m = re.search(regex_pat, v)
                v = m.group(1) if m and m.groups() else ""
            values.append(v)
        out[rule["field"]] = values if multi else (values[0] if values else None)
    return out


async def wait_condition(page, wait_for: Dict[str, Any]) -> None:
    t = wait_for.get("type", "networkidle")
    if t == "networkidle":
        await page.wait_for_load_state("networkidle", timeout=30000)
    elif t == "selector":
        await page.wait_for_selector(wait_for["selector"], timeout=wait_for.get("timeoutMs", 20000))
    elif t == "timeout":
        await asyncio.sleep(wait_for["ms"] / 1000)


async def do_login(page, cred: Dict[str, Any]) -> None:
    """Basic form login: navigate to loginUrl, fill #email/#password (or first visible inputs),
    submit. More complex flows should use loginStrategy='script' with a custom handler per-target."""
    strategy = cred.get("loginStrategy", "form")
    if strategy == "cookie":
        cookies = cred.get("credential", {}).get("cookies", [])
        if cookies:
            await page.context.add_cookies(cookies)
        return
    if strategy != "form":
        emit_progress({"t": "login.skipped", "reason": f"unknown strategy {strategy}"})
        return
    login_url = cred.get("loginUrl")
    if not login_url:
        return
    emit_progress({"t": "login.start", "url": login_url})
    await page.goto(login_url, wait_until="domcontentloaded")
    user = cred["credential"].get("username")
    pw = cred["credential"].get("password")
    if user and pw:
        # Try common selectors in order
        user_selectors = ['input[type="email"]', 'input[name*="user" i]', 'input[name*="email" i]',
                          'input[id*="user" i]', 'input[id*="email" i]']
        pw_selectors = ['input[type="password"]']
        for sel in user_selectors:
            if await page.locator(sel).count() > 0:
                await page.locator(sel).first.fill(user, timeout=5000)
                break
        for sel in pw_selectors:
            if await page.locator(sel).count() > 0:
                await page.locator(sel).first.fill(pw, timeout=5000)
                break
        # Submit via Enter
        await page.keyboard.press("Enter")
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except PWTimeout:
            pass
    emit_progress({"t": "login.done"})


async def run_job(job: Dict[str, Any]) -> Dict[str, Any]:
    profile = job["profile"]
    profile_dir = PROFILES_BASE / profile
    profile_dir.mkdir(parents=True, exist_ok=True)
    pacing = job.get("pacing", {"minMs": 800, "maxMs": 2500})
    viewport = job.get("viewport") or random.choice(DEFAULT_VIEWPORTS)
    user_agent = job.get("userAgent") or REALISTIC_UA

    result = {"success": False, "pages": []}

    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=True,
            viewport=viewport,
            user_agent=user_agent,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        # Apply stealth patches
        await Stealth().apply_stealth_async(context)

        page = await context.new_page()

        try:
            # Optional login
            if job.get("_credential"):
                await do_login(page, job["_credential"])

            emit_progress({"t": "nav", "url": job["url"]})
            await page.goto(job["url"], wait_until="domcontentloaded")
            await wait_condition(page, job.get("waitFor", {"type": "networkidle"}))
            await human_scroll(page, pacing)

            pages_collected = []

            # Main page
            fields = await apply_extract_rules(page, job["extract"])
            pages_collected.append({"url": page.url, "fields": fields})
            emit_progress({"t": "page.done", "url": page.url, "pageIndex": 0})

            # Pagination
            pag = job.get("pagination")
            if pag:
                max_pages = pag["maxPages"]
                if pag["type"] == "next-link":
                    for i in range(1, max_pages):
                        next_loc = page.locator(pag["nextSelector"]).first
                        if await next_loc.count() == 0:
                            break
                        await human_delay(pacing["minMs"], pacing["maxMs"])
                        await next_loc.click()
                        await wait_condition(page, job.get("waitFor", {"type": "networkidle"}))
                        await human_scroll(page, pacing)
                        fields = await apply_extract_rules(page, job["extract"])
                        pages_collected.append({"url": page.url, "fields": fields})
                        emit_progress({"t": "page.done", "url": page.url, "pageIndex": i})
                elif pag["type"] == "url-template":
                    for i in range(pag["start"] + 1, pag["start"] + max_pages):
                        target = pag["template"].replace("{n}", str(i))
                        await human_delay(pacing["minMs"], pacing["maxMs"])
                        await page.goto(target, wait_until="domcontentloaded")
                        await wait_condition(page, job.get("waitFor", {"type": "networkidle"}))
                        fields = await apply_extract_rules(page, job["extract"])
                        pages_collected.append({"url": page.url, "fields": fields})
                        emit_progress({"t": "page.done", "url": page.url, "pageIndex": i})

            result = {"success": True, "pages": pages_collected}
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            result = {"success": False, "pages": [], "error": err}
            if job.get("screenshotOnFailure", True):
                shot = f"/tmp/scraper-failure-{int(time.time())}.png"
                try:
                    await page.screenshot(path=shot, full_page=True)
                    result["screenshotPathInSandbox"] = shot
                except Exception:
                    pass
            emit_progress({"t": "error", "error": err, "trace": traceback.format_exc()[-1500:]})
        finally:
            await context.close()

    return result


def main() -> None:
    raw = sys.stdin.read()
    job = json.loads(raw)
    res = asyncio.run(run_job(job))
    sys.stdout.write(json.dumps(res))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
```

- [ ] **Step 8.2: Manual smoke test — run against a simple public page**

Write the script to the sandbox once manually and test:

```bash
docker exec -i jkai-sandbox bash -c 'cat > /tmp/scrape.py' < ~/strange_rambling_svelte/src/lib/workflows/scraper/python/scrape.py
docker exec -i jkai-sandbox bash -c '
JOB=$(cat <<EOF
{"url":"https://example.com","profile":"smoke","waitFor":{"type":"networkidle"},
 "extract":[{"field":"heading","selector":"h1"}]}
EOF
)
echo "$JOB" | python3 /tmp/scrape.py'
```

Expected stdout: JSON containing `{"success": true, "pages": [{..., "fields": {"heading": "Example Domain"}}]}`.

Expected stderr: NDJSON progress events.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/workflows/scraper/python/scrape.py
git commit -m "feat(scraper): add Python Playwright runner with stealth + human pacing"
```

---

### Task 9: Node runner — orchestrates the sandbox invocation

**Files:**
- Create: `src/lib/workflows/scraper/runner.ts`
- Test: `tests/lib/workflows/scraper/runner.test.ts`

- [ ] **Step 9.1: Write failing test**

```typescript
// tests/lib/workflows/scraper/runner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execInSandbox = vi.fn();
const writeFileInSandbox = vi.fn();
const ensureSandboxRunning = vi.fn();

vi.mock('$lib/jkai/sandbox', () => ({
  execInSandbox: (...a: any[]) => execInSandbox(...a),
  writeFileInSandbox: (...a: any[]) => writeFileInSandbox(...a),
  ensureSandboxRunning: () => ensureSandboxRunning(),
}));

const loadCredentialForRunner = vi.fn();
vi.mock('$lib/workflows/scraper/credentials', () => ({
  loadCredentialForRunner: (...a: any[]) => loadCredentialForRunner(...a),
}));

const insertRunLog = vi.fn().mockResolvedValue([{ id: 42 }]);
const updateRunLog = vi.fn().mockResolvedValue(undefined);
const db: any = {
  insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertRunLog })) })),
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateRunLog })) })),
};
vi.mock('$lib/db', () => ({ db }));
vi.mock('$lib/db/schema', () => ({ scraperRunLog: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: any, b: any) => ({ a, b }) }));

import { runScrape } from '$lib/workflows/scraper/runner';

describe('runScrape', () => {
  beforeEach(() => {
    execInSandbox.mockReset();
    writeFileInSandbox.mockReset();
    ensureSandboxRunning.mockReset();
    loadCredentialForRunner.mockReset();
  });

  it('writes the job + runner then parses JSON stdout', async () => {
    execInSandbox.mockResolvedValue({
      stdout: JSON.stringify({ success: true, pages: [{ url: 'https://x', fields: { h: 'Hi' } }] }),
      stderr: '',
      exitCode: 0,
    });

    const res = await runScrape({
      url: 'https://x',
      profile: 'test',
      waitFor: { type: 'networkidle' },
      extract: [{ field: 'h', selector: 'h1' }],
    });

    expect(ensureSandboxRunning).toHaveBeenCalled();
    expect(writeFileInSandbox).toHaveBeenCalledTimes(2); // scrape.py + job.json
    expect(res.success).toBe(true);
    expect(res.pages[0].fields.h).toBe('Hi');
    expect(res.runLogId).toBe(42);
  });

  it('marks run log as failure when runner exits non-zero', async () => {
    execInSandbox.mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 });
    const res = await runScrape({
      url: 'https://x',
      profile: 'p',
      waitFor: { type: 'networkidle' },
      extract: [],
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('boom');
  });

  it('resolves credentials when credentialId is set', async () => {
    loadCredentialForRunner.mockResolvedValue({
      id: 1, domain: 'x.com', loginUrl: 'https://x.com/login',
      loginStrategy: 'form', credential: { username: 'u', password: 'p' },
    });
    execInSandbox.mockResolvedValue({
      stdout: JSON.stringify({ success: true, pages: [] }), stderr: '', exitCode: 0,
    });
    await runScrape({
      url: 'https://x.com/jobs', profile: 'x',
      waitFor: { type: 'networkidle' }, extract: [], credentialId: 1,
    });
    const written = writeFileInSandbox.mock.calls.find((c) => c[0].endsWith('job.json'));
    expect(written).toBeDefined();
    expect(written![1]).toContain('"_credential"');
    expect(written![1]).toContain('"username":"u"');
  });
});
```

- [ ] **Step 9.2: Run test, verify FAIL**

Run: `npx vitest run tests/lib/workflows/scraper/runner.test.ts`

Expected: FAIL.

- [ ] **Step 9.3: Implement**

```typescript
// src/lib/workflows/scraper/runner.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { db } from '$lib/db';
import { scraperRunLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureSandboxRunning, execInSandbox, writeFileInSandbox } from '$lib/jkai/sandbox';
import { normalizeProfileName } from './profiles';
import { loadCredentialForRunner } from './credentials';
import type { ScrapeJob, ScrapeResult } from './types';

const RUNNER_SANDBOX_PATH = '/home/jkai/scraper-runtime/scrape.py';

function runnerSourcePath(): string {
  // Dev: relative to this file. Prod build: adjust to `dist/.../python/scrape.py`.
  const here = fileURLToPath(new URL('./python/scrape.py', import.meta.url));
  return here;
}

function readRunnerSource(): string {
  try {
    return readFileSync(runnerSourcePath(), 'utf8');
  } catch {
    // Fallback for bundled server (static/ path, set by build step if needed)
    return readFileSync(join(process.cwd(), 'src/lib/workflows/scraper/python/scrape.py'), 'utf8');
  }
}

export interface RunScrapeOptions extends ScrapeJob {
  workflowRunId?: string;
  /** Progress callback — one event per NDJSON line on stderr */
  onProgress?: (event: Record<string, unknown>) => void;
}

export async function runScrape(opts: RunScrapeOptions): Promise<ScrapeResult> {
  await ensureSandboxRunning();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = `/home/jkai/scraper-runtime/runs/${runId}`;
  await execInSandbox(`mkdir -p ${runDir} /home/jkai/scraper-runtime`);

  // Always write the latest runner source (cheap, ensures updates propagate)
  await writeFileInSandbox(RUNNER_SANDBOX_PATH, readRunnerSource());

  // Resolve credential if requested
  const { credentialId, onProgress, workflowRunId, ...job } = opts;
  const jobNormalized: Record<string, unknown> = {
    ...job,
    profile: normalizeProfileName(opts.profile),
  };
  if (credentialId) {
    const cred = await loadCredentialForRunner(credentialId);
    if (!cred) throw new Error(`credential ${credentialId} not found`);
    jobNormalized._credential = cred;
  }

  const jobPath = `${runDir}/job.json`;
  await writeFileInSandbox(jobPath, JSON.stringify(jobNormalized));

  // Insert run log row
  const [logRow] = await db.insert(scraperRunLog).values({
    url: opts.url,
    profile: opts.profile,
    workflowRunId: workflowRunId ?? null,
  }).returning();

  // Invoke runner. stdout = JSON result, stderr = NDJSON progress (ignored for now; a future
  // enhancement can stream stderr as it arrives — current execInSandbox waits for exit).
  const cmd = `cat ${jobPath} | python3 ${RUNNER_SANDBOX_PATH}`;
  const proc = await execInSandbox(cmd, 10 * 60 * 1000);

  // Parse progress events from stderr, fire callback after-the-fact
  if (onProgress && proc.stderr) {
    for (const line of proc.stderr.split('\n')) {
      if (!line.trim()) continue;
      try { onProgress(JSON.parse(line)); } catch { /* ignore malformed lines */ }
    }
  }

  let result: ScrapeResult;
  if (proc.exitCode !== 0) {
    result = {
      success: false,
      pages: [],
      error: (proc.stderr || '').slice(-1000) || `runner exited ${proc.exitCode}`,
    };
  } else {
    try {
      result = JSON.parse(proc.stdout);
    } catch (e: any) {
      result = { success: false, pages: [], error: `bad runner stdout: ${e.message}` };
    }
  }

  await db.update(scraperRunLog).set({
    endedAt: new Date(),
    success: result.success,
    pagesLoaded: result.pages.length,
    error: result.error ?? null,
  }).where(eq(scraperRunLog.id, logRow.id));

  result.runLogId = logRow.id;
  return result;
}
```

- [ ] **Step 9.4: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/scraper/runner.test.ts`

Expected: 3 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add src/lib/workflows/scraper/runner.ts tests/lib/workflows/scraper/runner.test.ts
git commit -m "feat(scraper): add Node→sandbox runner orchestration"
```

---

### Task 10: Event types for scraper

**Files:**
- Modify: `src/lib/workflows/events.ts`

- [ ] **Step 10.1: Add event types**

Add to the workflow event union:

```typescript
export interface ScraperProgressEvent {
  type: 'scraper.progress';
  runLogId: number;
  stage: 'nav' | 'page.done' | 'login.start' | 'login.done' | 'error';
  url?: string;
  pageIndex?: number;
  error?: string;
  timestamp: string;
}

export interface ScraperRunFinishedEvent {
  type: 'scraper.run.finished';
  runLogId: number;
  success: boolean;
  pagesLoaded: number;
  error?: string;
  timestamp: string;
}
```

- [ ] **Step 10.2: Verify typecheck**

Run: `npm run check`

- [ ] **Step 10.3: Commit**

```bash
git add src/lib/workflows/events.ts
git commit -m "feat(scraper): add scraper.progress + scraper.run.finished event types"
```

---

### Task 11: web-scrape node

**Files:**
- Create: `src/lib/workflows/nodes/web-scrape.def.ts`
- Create: `src/lib/workflows/nodes/web-scrape.ts`
- Test: `tests/lib/workflows/nodes/web-scrape.test.ts`

- [ ] **Step 11.1: Write failing test**

```typescript
// tests/lib/workflows/nodes/web-scrape.test.ts
import { describe, it, expect, vi } from 'vitest';

const runScrape = vi.fn();
vi.mock('$lib/workflows/scraper/runner', () => ({ runScrape: (...a: any[]) => runScrape(...a) }));

import { webScrapeExecutor } from '$lib/workflows/nodes/web-scrape';

const ctx: any = { runId: 'r', emit: vi.fn(), getNodeOutput: () => undefined };

describe('webScrapeExecutor', () => {
  it('forwards config to runScrape and returns pages', async () => {
    runScrape.mockResolvedValue({
      success: true,
      pages: [{ url: 'https://x', fields: { title: 'Hi' } }],
      runLogId: 7,
    });

    const result = await webScrapeExecutor.execute(
      {},
      {
        url: 'https://x',
        profile: 'test',
        waitFor: { type: 'networkidle' },
        extract: [{ field: 'title', selector: 'h1' }],
      },
      ctx,
    );
    expect(result.output.success).toBe(true);
    expect(result.output.pages).toHaveLength(1);
    expect(result.output.pages[0].fields.title).toBe('Hi');
    expect(result.output.runLogId).toBe(7);
  });

  it('emits scraper.progress events as runner progresses', async () => {
    runScrape.mockImplementation(async ({ onProgress }: any) => {
      onProgress({ t: 'nav', url: 'https://x' });
      onProgress({ t: 'page.done', url: 'https://x', pageIndex: 0 });
      return { success: true, pages: [], runLogId: 1 };
    });
    const emit = vi.fn();
    const ctx2: any = { ...ctx, emit };
    await webScrapeExecutor.execute({},
      { url: 'https://x', profile: 'p', waitFor: { type: 'networkidle' }, extract: [] },
      ctx2);
    const types = emit.mock.calls.map((c) => c[0].type);
    expect(types).toContain('scraper.progress');
  });

  it('interpolates url from input templates', async () => {
    runScrape.mockResolvedValue({ success: true, pages: [], runLogId: 1 });
    await webScrapeExecutor.execute(
      { jobUrl: 'https://example.com/path' },
      {
        url: '{{input.jobUrl}}',
        profile: 'p',
        waitFor: { type: 'networkidle' },
        extract: [],
      },
      ctx,
    );
    expect(runScrape).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/path' }));
  });
});
```

- [ ] **Step 11.2: Run test, verify FAIL**

Expected: module missing.

- [ ] **Step 11.3: Implement**

```typescript
// src/lib/workflows/nodes/web-scrape.def.ts
import type { NodeDefinition } from '../types';

export const webScrapeDef: NodeDefinition = {
  type: 'web-scrape',
  category: 'data',
  label: 'Web Scrape',
  description: 'Scrape a web page (or paginated set) using a stealth headless browser with a persistent profile. Residential IP via homeserv.',
  configSchema: {
    type: 'object',
    required: ['url', 'profile', 'waitFor', 'extract'],
    properties: {
      url: { type: 'string', description: 'Starting URL (supports {{input.x}} templates)' },
      profile: { type: 'string', description: 'Per-domain profile name, e.g. civilservicejobs-gov-uk' },
      waitFor: {
        oneOf: [
          { type: 'object', properties: { type: { const: 'networkidle' } } },
          { type: 'object', properties: { type: { const: 'selector' }, selector: { type: 'string' }, timeoutMs: { type: 'number' } } },
          { type: 'object', properties: { type: { const: 'timeout' }, ms: { type: 'number' } } },
        ],
      },
      extract: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            selector: { type: 'string' },
            attr: { type: 'string', default: 'text' },
            multi: { type: 'boolean' },
            trim: { type: 'boolean' },
            regex: { type: 'string' },
          },
          required: ['field', 'selector'],
        },
      },
      pagination: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { const: 'next-link' },
              nextSelector: { type: 'string' },
              maxPages: { type: 'number' },
            },
            required: ['type', 'nextSelector', 'maxPages'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'url-template' },
              template: { type: 'string', description: 'e.g. https://site?page={n}' },
              start: { type: 'number' },
              maxPages: { type: 'number' },
            },
            required: ['type', 'template', 'start', 'maxPages'],
          },
        ],
      },
      credentialId: { type: 'number', description: 'Row id in scraper_credentials' },
      pacing: {
        type: 'object',
        properties: { minMs: { type: 'number' }, maxMs: { type: 'number' } },
      },
    },
  },
};
```

```typescript
// src/lib/workflows/nodes/web-scrape.ts
import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { runScrape } from '$lib/workflows/scraper/runner';
import type { ScrapeJob } from '$lib/workflows/scraper/types';

export { webScrapeDef } from './web-scrape.def';

export const webScrapeExecutor: NodeExecutor = {
  type: 'web-scrape',

  async execute(input, config, context): Promise<NodeResult> {
    const url = interpolateTemplateStrict((config.url as string) || '', input).result;
    const profile = (config.profile as string) || 'default';
    const waitFor = config.waitFor as ScrapeJob['waitFor'];
    const extract = (config.extract as ScrapeJob['extract']) || [];
    const pagination = config.pagination as ScrapeJob['pagination'] | undefined;
    const credentialId = config.credentialId as number | undefined;
    const pacing = config.pacing as ScrapeJob['pacing'] | undefined;

    const result = await runScrape({
      url,
      profile,
      waitFor,
      extract,
      pagination,
      credentialId,
      pacing,
      workflowRunId: context.runId,
      onProgress: (ev) => {
        context.emit({
          type: 'scraper.progress',
          runLogId: 0, // filled by finished event
          stage: (ev.t as any) ?? 'page.done',
          url: ev.url as string | undefined,
          pageIndex: ev.pageIndex as number | undefined,
          error: ev.error as string | undefined,
          timestamp: new Date().toISOString(),
        } as any);
      },
    });

    context.emit({
      type: 'scraper.run.finished',
      runLogId: result.runLogId ?? 0,
      success: result.success,
      pagesLoaded: result.pages.length,
      error: result.error,
      timestamp: new Date().toISOString(),
    } as any);

    return {
      output: {
        success: result.success,
        pages: result.pages,
        pageCount: result.pages.length,
        error: result.error,
        runLogId: result.runLogId,
      },
      metadata: { _selectedHandle: 'output' },
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              fields: { type: 'object' },
            },
          },
        },
        pageCount: { type: 'number' },
        error: { type: 'string' },
        runLogId: { type: 'number' },
      },
    };
  },
};
```

- [ ] **Step 11.4: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/nodes/web-scrape.test.ts`

Expected: 3 tests pass.

- [ ] **Step 11.5: Commit**

```bash
git add src/lib/workflows/nodes/web-scrape.ts src/lib/workflows/nodes/web-scrape.def.ts tests/lib/workflows/nodes/web-scrape.test.ts
git commit -m "feat(scraper): add web-scrape workflow node"
```

---

### Task 12: web-scrape-llm node — LLM extraction over scraped pages

When selector-based extraction is too brittle (pages change, content is nested in narrative text), pipe the rendered DOM text through an LLM to extract structured fields.

**Files:**
- Create: `src/lib/workflows/nodes/web-scrape-llm.def.ts`
- Create: `src/lib/workflows/nodes/web-scrape-llm.ts`
- Test: `tests/lib/workflows/nodes/web-scrape-llm.test.ts`

- [ ] **Step 12.1: Write failing test**

```typescript
// tests/lib/workflows/nodes/web-scrape-llm.test.ts
import { describe, it, expect, vi } from 'vitest';

const completion = vi.fn();
vi.mock('$lib/workflows/nodes/llm-helpers', () => ({
  resolveLLMClient: vi.fn().mockResolvedValue({
    client: { chat: { completions: { create: (...a: any[]) => completion(...a) } } },
    model: 'test-model',
  }),
}));

import { webScrapeLlmExecutor } from '$lib/workflows/nodes/web-scrape-llm';

const ctx: any = { runId: 'r', emit: vi.fn(), getNodeOutput: () => undefined };

describe('webScrapeLlmExecutor', () => {
  it('asks the LLM to extract fields matching the supplied schema', async () => {
    completion.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ title: 'Engineer', salary: '£50k' }) } }],
    });

    const result = await webScrapeLlmExecutor.execute(
      { scraped: { pages: [{ url: 'https://x', fields: { html: '<h1>Engineer</h1><p>£50k</p>' } }] } },
      {
        sourcePath: 'input.scraped.pages[0].fields.html',
        schema: { type: 'object', properties: { title: { type: 'string' }, salary: { type: 'string' } } },
        model: 'test-model',
      },
      ctx,
    );

    expect(result.output.extracted).toEqual({ title: 'Engineer', salary: '£50k' });
  });

  it('loops over an array source and extracts for each item', async () => {
    completion.mockResolvedValueOnce({ choices: [{ message: { content: '{"name":"A"}' } }] });
    completion.mockResolvedValueOnce({ choices: [{ message: { content: '{"name":"B"}' } }] });

    const result = await webScrapeLlmExecutor.execute(
      { pages: [{ text: 'foo A bar' }, { text: 'foo B bar' }] },
      {
        sourcePath: 'input.pages',
        itemTextPath: 'text',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
        model: 'test-model',
      },
      ctx,
    );
    expect(result.output.extracted).toEqual([{ name: 'A' }, { name: 'B' }]);
  });
});
```

- [ ] **Step 12.2: Run test, verify FAIL**

Expected: module missing.

- [ ] **Step 12.3: Implement**

```typescript
// src/lib/workflows/nodes/web-scrape-llm.def.ts
import type { NodeDefinition } from '../types';

export const webScrapeLlmDef: NodeDefinition = {
  type: 'web-scrape-llm',
  category: 'data',
  label: 'Web Scrape (LLM Extract)',
  description: 'Extracts structured fields from scraped HTML/text via an LLM. Use when CSS selectors are too brittle.',
  configSchema: {
    type: 'object',
    required: ['sourcePath', 'schema'],
    properties: {
      sourcePath: { type: 'string', description: 'Dot path in input to the string or array to process. e.g. "input.scraped.pages"' },
      itemTextPath: { type: 'string', description: 'When sourcePath is an array, the path inside each item to pull text from' },
      schema: { type: 'object', description: 'JSON Schema describing fields to extract' },
      model: { type: 'string', description: 'OpenRouter / provider model id' },
      instructions: { type: 'string', description: 'Extra instructions appended to the extraction prompt' },
    },
  },
};
```

```typescript
// src/lib/workflows/nodes/web-scrape-llm.ts
import type { NodeExecutor, NodeResult } from '../types';
import { resolveLLMClient } from './llm-helpers';

export { webScrapeLlmDef } from './web-scrape-llm.def';

function resolvePath(obj: any, path: string): unknown {
  if (!path) return obj;
  const clean = path.replace(/^input\.?/, '');
  return clean.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k.replace(/\[(\d+)\]/, '.$1').split('.').join('.')]), obj);
}

function getByPath(obj: any, path: string): any {
  // handle "a.b[0].c" style
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return parts.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

async function extractOne(client: any, model: string, text: string, schema: unknown, instructions?: string): Promise<Record<string, unknown>> {
  const systemPrompt = `You extract structured data from web pages. Return JSON matching this schema and nothing else:\n${JSON.stringify(schema)}\n${instructions ?? ''}`.trim();
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text.slice(0, 200_000) },
    ],
    response_format: { type: 'json_object' },
  });
  const content = res.choices?.[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(content);
  } catch {
    // Try to locate a JSON block if the model wrapped it in prose
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

export const webScrapeLlmExecutor: NodeExecutor = {
  type: 'web-scrape-llm',

  async execute(input, config, _context): Promise<NodeResult> {
    const sourcePath = (config.sourcePath as string) || '';
    const itemTextPath = config.itemTextPath as string | undefined;
    const schema = config.schema;
    const instructions = config.instructions as string | undefined;

    const { client, model } = await resolveLLMClient(config.model as string | undefined);

    const raw = sourcePath.startsWith('input')
      ? getByPath({ input }, sourcePath)
      : getByPath(input, sourcePath);

    if (Array.isArray(raw)) {
      const out: Record<string, unknown>[] = [];
      for (const item of raw) {
        const text = itemTextPath ? String(getByPath(item, itemTextPath) ?? '') : JSON.stringify(item);
        out.push(await extractOne(client, model, text, schema, instructions));
      }
      return { output: { extracted: out }, metadata: { _selectedHandle: 'output' } };
    } else {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
      const extracted = await extractOne(client, model, text, schema, instructions);
      return { output: { extracted }, metadata: { _selectedHandle: 'output' } };
    }
  },

  getOutputSchema(config: Record<string, unknown>) {
    return {
      type: 'object',
      properties: {
        extracted: { oneOf: [
          (config.schema as any) ?? { type: 'object' },
          { type: 'array', items: (config.schema as any) ?? { type: 'object' } },
        ] },
      },
    };
  },
};
```

- [ ] **Step 12.4: Run test, verify PASS**

Run: `npx vitest run tests/lib/workflows/nodes/web-scrape-llm.test.ts`

Expected: 2 tests pass.

- [ ] **Step 12.5: Commit**

```bash
git add src/lib/workflows/nodes/web-scrape-llm.ts src/lib/workflows/nodes/web-scrape-llm.def.ts tests/lib/workflows/nodes/web-scrape-llm.test.ts
git commit -m "feat(scraper): add web-scrape-llm extraction node"
```

---

### Task 13: Register nodes in workflow registries

**Files:**
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

- [ ] **Step 13.1: Register executors + defs**

Add both executors to `index.ts` and both defs to `registry-client.ts`, following the pattern used by other data-category nodes (e.g. `http-request`, `deep-research`).

- [ ] **Step 13.2: Verify**

Run: `npm run check && npx vitest run tests/lib/workflows/scraper tests/lib/workflows/nodes/web-scrape*`

Expected: all pass.

- [ ] **Step 13.3: Commit**

```bash
git add src/lib/workflows/index.ts src/lib/workflows/registry-client.ts
git commit -m "feat(scraper): register web-scrape + web-scrape-llm nodes"
```

---

### Task 14: Admin API — credentials + profiles + test-run

**Files:**
- Create: `src/routes/api/scraper/credentials/+server.ts`
- Create: `src/routes/api/scraper/profiles/+server.ts`
- Create: `src/routes/api/scraper/test/+server.ts`

- [ ] **Step 14.1: Credentials endpoint**

```typescript
// src/routes/api/scraper/credentials/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { scraperCredentials } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { saveCredential, deleteCredential } from '$lib/workflows/scraper/credentials';

export const GET: RequestHandler = async () => {
  const rows = await db.select({
    id: scraperCredentials.id,
    domain: scraperCredentials.domain,
    label: scraperCredentials.label,
    loginStrategy: scraperCredentials.loginStrategy,
    loginUrl: scraperCredentials.loginUrl,
    createdAt: scraperCredentials.createdAt,
  }).from(scraperCredentials);
  return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const row = await saveCredential(body);
  return json({ id: row.id, domain: row.domain, label: row.label });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: 'id required' }, { status: 400 });
  await deleteCredential(id);
  return json({ ok: true });
};
```

- [ ] **Step 14.2: Profiles endpoint — list + clear**

```typescript
// src/routes/api/scraper/profiles/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { execInSandbox } from '$lib/jkai/sandbox';

export const GET: RequestHandler = async () => {
  const res = await execInSandbox('ls -1 /home/jkai/scraper-profiles 2>/dev/null || true');
  const names = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return json(names);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const name = url.searchParams.get('name');
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    return json({ error: 'invalid profile name' }, { status: 400 });
  }
  await execInSandbox(`rm -rf /home/jkai/scraper-profiles/${name}`);
  return json({ ok: true });
};
```

- [ ] **Step 14.3: Test endpoint**

```typescript
// src/routes/api/scraper/test/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { runScrape } from '$lib/workflows/scraper/runner';

export const POST: RequestHandler = async ({ request }) => {
  const job = await request.json();
  const result = await runScrape(job);
  return json(result);
};
```

- [ ] **Step 14.4: Commit**

```bash
git add src/routes/api/scraper/
git commit -m "feat(scraper): add admin API for credentials, profiles, and ad-hoc test runs"
```

---

### Task 15: Admin UI

**Files:**
- Create: `src/routes/admin/scraper/+page.server.ts`
- Create: `src/routes/admin/scraper/+page.svelte`

- [ ] **Step 15.1: Loader**

```typescript
// src/routes/admin/scraper/+page.server.ts
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { scraperCredentials, scraperRunLog } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const creds = await db.select().from(scraperCredentials);
  const recent = await db.select().from(scraperRunLog).orderBy(desc(scraperRunLog.id)).limit(50);
  return {
    credentials: creds.map((c) => ({ ...c, credentialEnc: undefined })),
    recentRuns: recent,
  };
};
```

- [ ] **Step 15.2: UI**

Follow the conventions in `/admin/gmail` (or whatever admin pages exist — `src/routes/admin/blog/+page.svelte`). Sections:

- Credentials table (domain, label, strategy, delete)
- "Add credential" form (domain, label, loginUrl, loginStrategy select, credential JSON textarea)
- Profiles list (fetched from `/api/scraper/profiles`) with clear buttons
- Recent runs table (url, profile, started/ended, success, pages, error preview)
- "Ad-hoc test" panel — JSON textarea for a `ScrapeJob`, run button, result panel

- [ ] **Step 15.3: Commit**

```bash
git add src/routes/admin/scraper/
git commit -m "feat(scraper): add admin UI"
```

---

### Task 16: Civil Service Jobs target-specific helper

Real-world proof: a template scraping config for civilservicejobs.gov.uk + smoke-test script.

**Files:**
- Create: `src/lib/workflows/scraper/python/civilservicejobs.py` (optional — only if generic scraper isn't sufficient)
- Create: `docs/scraper-targets/civilservicejobs.md` (documentation of the known selectors)

- [ ] **Step 16.1: Manually explore civilservicejobs.gov.uk**

From a browser, go to https://www.civilservicejobs.service.gov.uk/csr/index.cgi, run a search. Open devtools, inspect the results list. Identify CSS selectors for:
- Individual result card: `div.search_result`
- Title link: `div.search_result h3 a`
- Department: `div.search_result .search-result-dept`
- Location: `div.search_result .location`
- Salary: `div.search_result .salary`
- Next page link: `a.pagination_next` or similar

(Exact selectors must be verified on the live site — they will differ from this plan if the site has been redesigned.)

- [ ] **Step 16.2: Create target docs**

```markdown
# civilservicejobs.gov.uk — scraping notes

**Base search URL:** `https://www.civilservicejobs.service.gov.uk/csr/index.cgi`

**Strategy:** Public search is available without login. For saved-search notifications or application tracking, login is required.

**Known selectors (verified YYYY-MM-DD):**
- Card: `div.search_result`
- Title: `div.search_result h3 a` — text + href
- Department: `div.search_result .search-result-dept`
- Location: `div.search_result .location`
- Salary: `div.search_result .salary`
- Closing date: `div.search_result .closing_date`
- Next page: `a.pagination_next`

**Pacing:** 2.5–5s between page loads. Do not exceed 1 req/sec sustained.

**Example ScrapeJob:**

\`\`\`json
{
  "url": "https://www.civilservicejobs.service.gov.uk/csr/index.cgi?SID=c2VhcmNoc29ydD1jbG9zaW5n",
  "profile": "civilservicejobs-gov-uk",
  "waitFor": { "type": "selector", "selector": "div.search_result", "timeoutMs": 15000 },
  "extract": [
    { "field": "title", "selector": "div.search_result h3 a", "multi": true },
    { "field": "titleUrl", "selector": "div.search_result h3 a", "attr": "href", "multi": true },
    { "field": "dept", "selector": "div.search_result .search-result-dept", "multi": true },
    { "field": "location", "selector": "div.search_result .location", "multi": true },
    { "field": "salary", "selector": "div.search_result .salary", "multi": true }
  ],
  "pagination": { "type": "next-link", "nextSelector": "a.pagination_next", "maxPages": 5 },
  "pacing": { "minMs": 2500, "maxMs": 5000 }
}
\`\`\`
```

- [ ] **Step 16.3: Smoke test via admin UI**

Go to `/admin/scraper` → ad-hoc test panel → paste the ScrapeJob above → Run.

Expected: `success: true`, pages: 1–5 with arrays of titles/depts/locations/salaries populated.

- [ ] **Step 16.4: Commit docs**

```bash
mkdir -p ~/strange_rambling_svelte/docs/scraper-targets
git add docs/scraper-targets/civilservicejobs.md
git commit -m "docs(scraper): add civilservicejobs.gov.uk scraping notes + sample job"
```

---

### Task 17: End-to-end workflow smoke test

Build a workflow using the new nodes to prove the integration end-to-end.

**Files:** none (runtime only)

- [ ] **Step 17.1: Compose a workflow**

In the workflow editor (`/workflows/<new>`) build:

1. `manual-trigger` → `web-scrape` (civilservicejobs config) → `web-scrape-llm` (extract structured job from each title+dept combo into `{ role, band, closing }` objects) → `data-store` (save to `intel` or another store) → `gmail-send` (summary email to the user).

(If `data-store` / `intel-write` isn't suited to the output, just pipe directly into `gmail-send` with a template.)

- [ ] **Step 17.2: Run it**

Trigger manually. Verify:
- scraper.progress events stream to `/jkai` chat
- web-scrape completes with N job cards
- web-scrape-llm extracts structured data from each (may take 30–90s depending on count)
- gmail-send delivers the summary

- [ ] **Step 17.3: Update CLAUDE.md**

Add a "Web scraper" section documenting the two nodes, the admin UI, the sandbox dependency, the `SCRAPER_VAULT_KEY` env var, and the profile bind-mount.

- [ ] **Step 17.4: Deploy**

Commit, push, deploy via `~/strange_rambling_svelte/scripts/deploy.sh`. Ensure the VPS has `SCRAPER_VAULT_KEY` in its env — this scraper *should not actually run on the VPS* (the residential IP is on homeserv), but the env var is still needed for decryption of any test credentials shown in the admin UI. Consider adding a runtime check that refuses to start a scrape when running on VPS hostname. Add it to the scraper runner:

```typescript
import os from 'os';
// Near top of runScrape:
if (os.hostname() !== 'homeserv' && process.env.NODE_ENV === 'production') {
  throw new Error('Scraper refuses to run outside homeserv — residential IP required');
}
```

(Guard is worth it because scraping from a Hetzner VPS IP defeats the stealth goal entirely.)

- [ ] **Step 17.5: Commit docs + guard**

```bash
git add CLAUDE.md src/lib/workflows/scraper/runner.ts
git commit -m "docs(scraper): document scraper channel; refuse to run off-homeserv"
git push
bash ~/strange_rambling_svelte/scripts/deploy.sh
```

---

## Self-review checklist

- **Spec coverage**: scrape arbitrary sites ✓ (web-scrape), AI-masking via stealth + persistent profiles + human pacing ✓ (Task 1 + Task 8), local IP via homeserv sandbox ✓ (Task 3 bind mount + Task 17 guard), civilservicejobs.gov.uk target ✓ (Task 16), LLM-based extraction ✓ (web-scrape-llm Task 12), behind-login scraping ✓ (credentials + loginStrategy form/cookie).
- **Placeholder scan**: the only deferred-to-implementer items are (a) the exact shape of orchestrator-bridge registration conventions in `registry-client.ts` (must mirror existing nodes) and (b) the civilservicejobs selectors which can only be verified live — both are explicitly called out and the test-run panel proves the final config works.
- **Type consistency**: `ScrapeJob`, `ExtractRule`, `ExtractedPage`, `ScrapeResult` defined in Task 5, used consistently in runner (Task 9), web-scrape node (Task 11), and Python runner JSON contract (Task 8).
- **TDD discipline**: each Task with non-trivial logic (crypto, profiles, credentials, runner, both nodes) writes the test first, runs it to verify FAIL, implements, reruns for PASS, commits. Infrastructure tasks (Dockerfile, schema, UI pages) are commit-only since they produce no testable unit logic in isolation.

---
