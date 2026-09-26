# Access groups P1 (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `member` role with permissions from a code catalogue, granted to users through editable groups plus one-off extras, with intel as the first (and, in P1, only) area opened.

**Architecture:** A pure catalogue (`$lib/access/catalogue.ts`) defines areas, levels, built-in groups and the route-id → permission map. `$lib/server/access/grants.ts` resolves a user's effective permissions from `allowed_user.groups/grants` + `access_group`. `viewerOf` carries them; the hook's `grantMayReach` opens a route when a member holds the permission the catalogue requires. Intel's `resolveRequestScope` reads the level.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Drizzle (Postgres 16), vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-access-groups-design.md`

## Global Constraints

- Route permissions are keyed on SvelteKit **route ids** + verbs, never pathnames; HEAD follows GET.
- A route absent from the catalogue stays owner-only.
- Owner (`AUTH_ALLOWED_EMAILS`) is decided without a DB read and satisfies everything; never offered in UI.
- Unknown permission strings and unknown group ids are ignored on read (fail closed).
- Legacy `allowed_user.role = 'member'` ⇒ `jkai.intel:self`.
- Schema: additive only (new table, two new array columns with defaults). No `.unique()`, no renames.
- Integration tests touch only rows they create, tagged per run; no cleanup/purge path runs (HARD RULE: shared dev DB).

---

### Task 1: The catalogue

**Files:** Create `src/lib/access/catalogue.ts`, `src/lib/access/catalogue.test.ts`. Modify `src/lib/auth.ts` (MEMBER_ROUTES → catalogue; keep `isMemberAllowedRoute`/`memberRouteIds` as wrappers so `route-scope.test` and `auth.test` stay meaningful).

**Produces:**
```ts
export const LEVELS = ['self', 'all', 'admin'] as const; export type Level = (typeof LEVELS)[number];
export const AREA_IDS = ['news','research','drive','home','jkai.chat','jkai.notes','jkai.intel','jkai.knowledge'] as const;
export type AreaId = (typeof AREA_IDS)[number];
export const FAMILY_PERMISSIONS = ['family:circle', 'family:admin'] as const;
export type Permission = `${AreaId}:${Level}` | (typeof FAMILY_PERMISSIONS)[number];
export interface AreaInfo { id: AreaId; label: string; blurb: string; open: boolean; levels: Record<Level, string> }
export const AREAS: readonly AreaInfo[];
export const FAMILY: readonly { id: Permission; label: string; blurb: string; open: boolean }[];
export const BUILT_IN_GROUPS: readonly { id: string; label: string; description: string; grants: Permission[] }[];
export function isPermission(s: unknown): s is Permission;
export function parsePermissions(values: readonly unknown[]): Permission[];   // filters + dedupes
export function levelOf(grants: Iterable<Permission>, area: AreaId): Level | null; // highest held
export function satisfies(grants: Iterable<Permission>, required: Permission): boolean; // ordering
export function requiredFor(routeId: string | null | undefined, method: string): Permission | null;
export function routeIdsFor(area: AreaId | Permission): string[];
```

**Tests:** permission parsing drops junk/dupes; `satisfies('jkai.intel:all' ⊇ 'jkai.intel:self')`, not the reverse, not across areas; family perms satisfy only themselves; `requiredFor` = today's member table (every existing auth.test case still holds via wrappers); HEAD→GET; null route id → null; every listed route id exists on disk.

- [ ] Write tests → red → implement → green → commit.

### Task 2: Schema

**Files:** Modify `src/lib/db/schema.ts` (`allowedUser` gains `groups`, `grants` `text[] not null default '{}'`; new `accessGroup` table). Apply locally with a throwaway config extending `tablesFilter` with the dev DB's eight undeclared tables.

- [ ] Edit, push locally, `\d allowed_user` + `\d access_group` confirm, commit.

### Task 3: Grants resolution

**Files:** Create `src/lib/server/access/grants.ts`, `src/lib/server/access/grants.test.ts` (pure), `src/lib/server/access/grants.integration.test.ts`. Modify `src/lib/server/members.ts` (export `ensureMemberPrincipal`; `setMemberRole` kept for the legacy PATCH shape → maps to grants).

**Produces:**
```ts
export function effectivePermissions(user: { role: string; groups: string[]; grants: string[] }, groups: ReadonlyMap<string, readonly string[]>): Set<Permission>;
export async function ensureBuiltInGroups(): Promise<void>;
export async function listGroups(): Promise<AccessGroupRow[]>;
export async function loadMember(email: string): Promise<{ principalId: string; grants: Set<Permission> } | null>;
export async function setUserAccess(email: string, access: { groups: string[]; grants: string[] }): Promise<boolean>;
export async function saveGroup(g: { id?: string; label: string; description?: string | null; grants: string[] }): Promise<AccessGroupRow>;
export async function deleteGroup(id: string): Promise<'deleted' | 'built-in' | 'missing'>;
```
`loadMember` returns null when effective permissions are empty (a guest) or there is no principal. `setUserAccess` creates the principal when the result is non-empty and disables Gmail when no `jkai.intel` level remains; it also resets legacy `role` to `'guest'` so grants are the only source. `deleteGroup` also strips the id from every `allowed_user.groups`.

**Tests (pure):** union of groups + extras; unknown group ignored; junk perms dropped; legacy member ⇒ intel self. **Integration:** a user given Family Circle resolves `family:circle`; a group edit changes the next resolution; removing the last intel grant disables their Gmail row; deleting a group strips it from users; built-ins cannot be deleted.

### Task 4: Viewer + hook

**Files:** Modify `src/lib/server/viewer.ts` (member kind gains `grants`; `resolveViewer` uses `loadMember`; add `viewerHas(event, perm)`), `src/hooks.server.ts` (`memberMayReach` → `grantMayReach` via `requiredFor` + `satisfies`), `src/app.d.ts` if needed.

**Tests:** `src/lib/server/viewer.integration.test.ts`: owner (no DB), member with grants, user with groups but no principal gets one only via setUserAccess, guest, anonymous. Hook logic is covered by `grantMayReach` exported for test as a pure `mayReach(viewer, routeId, method)`.

### Task 5: Intel reads the level

**Files:** Modify `src/lib/jkai/intel/scope.server.ts`. `resolveRequestScope`: member without any `jkai.intel` level → 403; `self` → `[own, household]`; `all`/`admin` → `[own, household, ...every other user principal]` (never `owner`). Extend `members.integration.test.ts`: a second member with `jkai.intel:all` sees the first member's word and never the owner secret; a member holding only `family:circle` gets 403 from intel.

### Task 6: /admin/access

**Files:** Modify `src/routes/api/admin/access/+server.ts` (GET returns users with groups/grants/effective + groups + catalogue; PATCH `{email, groups, grants}`, legacy `{role}` still accepted), create `src/routes/api/admin/access/groups/+server.ts` (GET/POST/PATCH/DELETE), modify `src/routes/admin/access/+page.server.ts` + `+page.svelte` (Super Admin / People / Groups sections, grant grid, disabled not-yet-open areas).

**Tests:** `src/routes/api/admin/access/access.integration.test.ts`: PATCH round-trip; bad permission strings dropped; group CRUD; built-in delete refused 400.

### Task 7: Gate, review, ship

- [ ] `./scripts/gate-remote.sh --build` green.
- [ ] Code-review subagent; apply findings.
- [ ] Rebase onto the household merge (convert `household` role → `family:circle` in the catalogue; `viewerOf` household kind folds into member-with-`family:circle`) — **only if it has merged by then; otherwise ship and let household rebase.**
- [ ] PR → CI green → squash merge → master run green → `.deploy-sha` matches → verify `/admin/access` renders the groups section (signed-in check via grep of the built server chunk for `access_group` + an anonymous 302), and `select * from access_group` on prod shows the two built-ins after the first page load.
