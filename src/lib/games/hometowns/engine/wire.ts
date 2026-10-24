// The per-viewer wire's TYPES (spec §10.7). Types only: WP4 builds frames in
// src/lib/games/hometowns/wire.ts, and the map page and the iPhone app decode
// them. They live in the engine folder so the page imports one source of
// truth without pulling in server code.
//
// Redaction is part of the contract: another town's money, bonds, orders and
// contract books never appear in `towns` or `visiting`.

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
  Snapshot,
  TownState,
  BulletinItem,
  BuildingRecord,
} from './types';

export interface HometownsWire {
  id: string;
  phase: 'lobby' | 'running' | 'closed';
  serverNow: number;
  rev: number;
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
  towns: PublicTown[];
  visiting?: VisitView;
  county: CountyWire;
}

export interface MeWire {
  seat: SeatId;
  profile: 'kid' | 'adult';
  isParent: boolean;
  /** Full on the first frame or when planesRev > since. */
  town?: TownState;
  townDelta?: { tick: number; tileEvents: string; changed: Partial<TownState> };
  /** The production determinism canary: stateHash at the server's last tick. */
  townHash: string;
  derived: {
    stars: number[];
    meters: number[];
    wants: Want[];
    advisors: AdvisorCard[];
    needs: NeedRow[];
    pipeline: { homes: number; movers: number };
    townTalk: [key: string, pct: number][];
  };
  affordances: { unlocked: string[]; costs: Record<string, number>; initiatives: number; slots: number; canUndo: string[] };
  /** Exactly the server's inputs, so the phone predicts. */
  snapshot: Snapshot;
  inbox: InboxItem[];
  welcomeBack?: Card[];
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
  advisor: 'bramble' | 'penny' | 'zia' | 'otto';
  key: string;
  data: Record<string, number | string>;
}

export interface NeedRow {
  cohort: number;
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

export interface CountyWire {
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
