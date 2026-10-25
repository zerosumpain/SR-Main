// The per-viewer wire's TYPES (spec §10.7). Types only: WP4 builds frames in
// src/lib/games/hometowns/wire.ts, and the map page and the iPhone app decode
// them. They live in the engine folder so the page imports one source of
// truth without pulling in server code.
//
// Redaction is part of the contract: another town's money, bonds, orders and
// contract books never appear in `towns` or `visiting`.
//
// FULL AND DELTA FRAMES (WP4). A frame with `base: null` is whole: every
// field below is present (optional ones only when they apply). A frame with
// `base: n` was cut against the frame this phone holds at `rev` n, and a
// part it leaves out is unchanged since then:
//   - `county`, `visiting`, `me.snapshot`, `me.derived`, `me.affordances`,
//     `me.inbox`, `me.predict`, `me.moves` and `me.welcomeBack` are each sent
//     whole when they changed and left out when they did not;
//   - the public cards come as `towns` (whole, when a town was founded) or
//     as `townsPatch`, one entry per town index: null when that card did
//     not change, else just the card's fields that did;
//   - the viewer's town comes as `me.town` (whole) or as `me.townDelta`,
//     whose `changed` holds every top-level TownState field that differs,
//     each whole. The planes never travel in a delta: a frame whose planes
//     changed carries `me.town`.
// Merging is "take the frame, fill each missing part from the held frame,
// assign each townsPatch entry over the held card, and for a townDelta
// assign `changed` over the held town"; `applyFrame` in
// the server's wire.ts is the reference, and `me.townHash` checks the result.
// A frame whose `base` is not the rev the phone holds cannot be merged: ask
// for a whole one (GET the room).

import type {
  Contract,
  GazetteIssue,
  GoalsBoard,
  InboxItem,
  Link,
  Offer,
  Pact,
  PublicCard,
  SeatId,
  SiteKind,
  Snapshot,
  TownState,
  BulletinItem,
  BuildingRecord,
} from './types';
import type { ParamsVersion } from './params';

export interface HometownsWire {
  id: string;
  game: 'hometowns';
  phase: 'lobby' | 'running' | 'closed';
  serverNow: number;
  rev: number;
  /** WP4: null for a whole frame; else the rev of the frame this one is cut against. */
  base: number | null;
  hostId: string;
  meId: string;
  /** WP4: the framework's player rows (hashed ids), with each one's seat once they have one. */
  players: WirePlayer[];
  client: { engineHash: string; page: string; bridge: 1 };
  clock: {
    gridTick: number;
    tickMs: number;
    nextTickAt: number;
    nextRegionalDayAt: number;
    nextGazetteAt: number;
    paused: boolean;
    napping: boolean;
    season: SeasonWire;
  };
  me: MeWire | null;
  /** Whole on a whole frame; in a delta frame only when the number of towns changed (else see townsPatch). */
  towns?: PublicTown[];
  /** WP4, delta frames only: per town index, null (unchanged) or the card fields that changed. */
  townsPatch?: (Partial<PublicTown> | null)[];
  /** Null when not visiting; absent in a delta frame when unchanged. */
  visiting?: VisitView | null;
  /** Absent in a delta frame when unchanged. */
  county?: CountyWire;
}

export interface WirePlayer {
  id: string;
  name: string;
  status: 'invited' | 'joined' | 'declined' | 'left';
  seat: SeatId | null;
}

export interface MeWire {
  seat: SeatId;
  profile: 'kid' | 'adult';
  isParent: boolean;
  /** Whole on a whole frame, or when the planes changed since `base`; absent before the town is founded. */
  town?: TownState;
  townDelta?: { tick: number; tileEvents: string; changed: Partial<TownState> };
  /** The production determinism canary: stateHash of the server's town as sent ('' before founding). */
  townHash: string;
  /** Absent in a delta frame when unchanged (as are affordances, snapshot, inbox, predict and moves). */
  derived?: {
    /** Perceived stars, STAR layout (20). */
    stars: number[];
    meters: number[];
    wants: Want[];
    advisors: AdvisorCard[];
    needs: NeedRow[];
    pipeline: { homes: number; movers: number };
    townTalk: [key: string, pct: number][];
  };
  affordances?: { unlocked: string[]; costs: Record<string, number>; initiatives: number; slots: number; canUndo: string[] };
  /**
   * Exactly the server's inputs, so the phone predicts. WP4: each row's
   * `skyline` is sent as '' (no step reads it; the County view has the
   * public cards' skylines), which keeps a six-town first frame in budget.
   */
  snapshot?: Snapshot;
  inbox?: InboxItem[];
  welcomeBack?: Card[];
  /**
   * WP4: the rest of what exact prediction needs (§10.9): the town's index
   * (TickContext.townIndex), the county's dayIndex, settings and params.
   * Build TownEnv as { params: paramsFor(paramsVersion), snapshot, rivalry,
   * mishaps, dayIndex } and tick with townContext(town, townIndex, …).
   */
  predict?: { townIndex: number; dayIndex: number; rivalry: 'friendly' | 'spirited'; mishaps: 'mild' | 'off'; paramsVersion: ParamsVersion };
  /**
   * WP4 (A19, A28): this seat's most recent logged moves, newest last, with
   * the town tick before which each applied. The store re-posts a pending
   * move whose id is not here after a frame whose rev went backwards.
   */
  moves?: { id: string; type: string; atTick: number }[];
}

export interface SeasonWire {
  n: number;
  theme: string;
  day: number;
  daysLeft: number;
}

export interface Want {
  key: string;
  severity: number;
  /** A tile to point the bubble at, or −1. */
  tile: number;
  hatched: boolean;
}

export interface AdvisorCard {
  /** WP4: 'mo' (the hedgehog) replaces the frozen draft's 'otto', matching engine/advisors.ts. */
  advisor: 'bramble' | 'penny' | 'mo' | 'zia';
  /** The rule id (copy keys `advisor.<key>.kid` / `.adult`). */
  key: string;
  /** `action`: the rule's deep link (a ghost plan, a sheet or a lens). */
  data: Record<string, number | string>;
}

/** WP4: one row per wealth tier (`tier` 0–2); `cohort` is that tier's Families cohort. */
export interface NeedRow {
  cohort: number;
  tier: number;
  items: { key: string; met: number; buildable: boolean }[];
}

export interface Card {
  key: string;
  data: Record<string, number | string>;
}

/** What everyone may see of a town. NEVER money, bonds, orders or contract books. */
export interface PublicTown extends PublicCard {
  mayor: string;
  linked: number[];
}

export interface VisitView {
  seat: SeatId;
  planes: string;
  lv: string;
  buildings: BuildingRecord[];
  terrainSeed: number;
  siteKind: string;
  terrainEdits: number[];
  construction: number[];
}

export interface MarketWire {
  goods: { p: number; band: [number, number] };
  food: { p: number; band: [number, number] };
}

export interface FlowsSummary {
  commutersIn: number;
  commutersOut: number;
  shoppersIn: number;
  shoppersOut: number;
  dayTrips: number;
  touristShare: number;
}

export interface GreatWorkWire {
  id: string;
  stage: number;
  progress: number[];
  needs: number[];
  myCredit: number;
}

export interface CouncilWire {
  question: string | null;
  options: string[];
  myVote: number | null;
  /** Totals only after the vote closes. */
  totals: number[] | null;
}

export interface AwardsWire {
  week: number;
  recent: { town: number; award: string }[];
}

/** WP4: a site around Kingsport, for the Founding sheet (`owner` is a town index or null). */
export interface SiteWire {
  index: number;
  kind: SiteKind;
  terrainSeed: number;
  owner: number | null;
}

export interface CountyWire {
  /** WP4: the county's name and its sites (founding needs both). */
  name: string;
  sites: SiteWire[];
  kingsport: PublicTown;
  links: Link[];
  /** Mine only. */
  offers: Offer[];
  /** Mine only. */
  contracts: Contract[];
  pacts: Pact[];
  market: MarketWire;
  flowsSummary: FlowsSummary;
  greatWork: GreatWorkWire | null;
  goals: GoalsBoard;
  council: CouncilWire;
  awards: AwardsWire;
  fund: number;
  bulletin: BulletinItem[];
  /** When new. */
  gazette?: GazetteIssue;
}
