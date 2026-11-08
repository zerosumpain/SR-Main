import { beforeEach, describe, expect, it, vi } from "vitest";

// The real gate (`withNativeAccess('games', …)`) in front of the route, then
// the family check: games access alone is not enough to see the family's
// ideas, and a member's +1 is kept under their player id, never an email.

const OWNER = "owner@example.test";

const h = vi.hoisted(() => ({
  identity: null as null | {
    id: string;
    ownerEmail: string;
    label: string | null;
    expiresAt: Date;
  },
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
  stored: null as unknown,
}));

vi.mock("$env/dynamic/private", () => ({
  env: { AUTH_ALLOWED_EMAILS: OWNER },
}));
vi.mock("$lib/db", () => ({ db: {} }));
vi.mock("$lib/server/native-auth", () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock("$lib/server/access", () => ({
  isOwnerEmail: (e: string | null | undefined) =>
    (e ?? "").trim().toLowerCase() === OWNER,
}));
vi.mock("$lib/server/grants", () => ({
  loadMember: async (e: string) => h.members.get(e) ?? null,
}));
vi.mock("$lib/server/models/settings", () => ({
  getSetting: async (key: string) =>
    key === "games.suggestions" ? h.stored : null,
  setSetting: async (_key: string, value: unknown) => {
    h.stored = value;
  },
}));
vi.mock("$lib/jkai/chat/job-store", () => ({ getJob: () => null }));
vi.mock("$lib/games/players.server", () => ({
  playerFor: async (email: string) => ({
    id: `p_${email.split("@")[0]}`,
    email,
    name: email.split("@")[0],
  }),
  playerId: (email: string) => `p_${email.split("@")[0]}`,
  gamePlayers: async () => [],
}));

const { GET, POST } = await import("./+server");

function call(method: "GET" | "POST", body?: unknown) {
  const url = new URL("https://site.test/api/native/games/suggestions");
  const request = new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${"x".repeat(43)}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const handler = (method === "GET" ? GET : POST) as unknown as (
    e: unknown,
  ) => Promise<Response>;
  return handler({ request, url, locals: { auth: async () => null } });
}

function device(email: string) {
  return {
    id: `dev-${email}`,
    ownerEmail: email,
    label: "iPhone",
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  };
}

beforeEach(() => {
  h.identity = null;
  h.members.clear();
  h.stored = null;
});

describe("/api/native/games/suggestions", () => {
  it("401s an unpaired phone", async () => {
    expect((await call("GET")).status).toBe(401);
  });

  it("403s games access without the family", async () => {
    h.identity = device("ann@example.test");
    h.members.set("ann@example.test", {
      principalId: "u_ann",
      grants: new Set(["games:self"]),
    });
    const res = await call("POST", { name: "Moon lander" });
    expect(res.status).toBe(403);
    expect(h.stored).toBeNull();
  });

  it("lets a family member suggest and +1, and the owner see it", async () => {
    h.identity = device("ann@example.test");
    h.members.set("ann@example.test", {
      principalId: "u_ann",
      grants: new Set(["games:self", "family:circle"]),
    });
    const made = await call("POST", {
      name: "Moon lander",
      note: "Tilt to land",
    });
    expect(made.status).toBe(200);
    const body = await made.json();
    expect(body).toMatchObject({
      parent: false,
      suggestions: [
        {
          name: "Moon lander",
          note: "Tilt to land",
          by: "ann",
          votes: 1,
          voted: true,
          mine: true,
        },
      ],
    });
    expect(JSON.stringify(h.stored)).not.toContain("@");

    h.identity = device(OWNER);
    const id = body.suggestions[0].id;
    const voted = await (await call("POST", { id, vote: true })).json();
    expect(voted).toMatchObject({
      parent: true,
      suggestions: [{ votes: 2, voted: true, mine: false }],
    });
    const read = await (await call("GET")).json();
    expect(read.suggestions).toHaveLength(1);
  });

  it("refuses a nameless idea and an unknown one", async () => {
    h.identity = device(OWNER);
    const bad = await call("POST", { name: " " });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Give the game a name." });
    expect((await call("POST", { id: "s_none", vote: true })).status).toBe(404);
  });
});
