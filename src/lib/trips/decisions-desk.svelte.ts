// src/lib/trips/decisions-desk.svelte.ts
//
// v8: the site's decision desk — every choice the trip page (and the places
// page) posts back to the server, and what the page shows meanwhile: which
// card is working, which proposals and questions are settled here and should
// leave the screen before the page reloads, a proposal re-checked because the
// plan moved on (shown again with its new difference), and the latest "What
// changed" card with its Undo. The server owns every decision; the desk only
// posts choices by id (never ops) and reloads.
//
// Svelte 5 runes in a class: fields are $state; nothing here is an $effect,
// and fetched objects are replaced, never mutated in place.

import { api, errorText } from './decisions-client';
import { changeCard, isOptionCard, optionAsProposal, type ChangeCard, type ChangeResponse } from './decisions-view';
import type { BriefPatch, Nudge, Proposal, Question, RejectReason } from './decisions';
import { postAsJob } from './job-client';
import type { WishDraft } from './model';
import type { PlanOption } from './options';

export interface DeskHooks {
  /**
   * Reload the page's data (and glow what moved). Called after every change.
   * May say what the plan's latest version now is, when it moved — used for
   * changes whose route does not describe them (a legacy option's wish).
   */
  reload: () => Promise<{ planVersion: number; changes: string[] } | void>;
  /** Put words in "Tell the planner" for the person to send (never sent for them). */
  tell?: (text: string) => void;
}

/** What a proposals request targets (the contract's `target`, plus the pack place for "Add to the plan"). */
export interface ProposalTarget {
  stopId?: string | null;
  wishId?: string | null;
  date?: string | null;
  stage?: string | null;
  proposalId?: string | null;
  packPlaceId?: string | null;
}

export interface ProposalRequest {
  kind: 'swap' | 'fill' | 'day' | 'nudge' | 'shapes';
  target: ProposalTarget;
  nudge?: Nudge;
  variant?: 'lighter' | 'rainy' | 'swap-days';
  withDate?: string | null;
}

export class DecisionDesk {
  /** The key of the thing working: `p:<id>`, `q:<id>`, a request key, 'undo', 'brief'. */
  busy = $state<string | null>(null);
  /** Proposals an action returned that the page's data may not hold yet. */
  local = $state<Proposal[]>([]);
  /** Proposal ids (and `group:<id>`) settled here. */
  gone = $state<Set<string>>(new Set());
  /** Question ids settled here. */
  goneQuestions = $state<Set<string>>(new Set());
  /** Proposals re-checked after a 409: the card shows the new difference and asks again. */
  stale = $state<Record<string, boolean>>({});
  /** The latest failure, and the card it belongs to (or null for the rail). */
  problem = $state<{ where: string | null; text: string } | null>(null);
  /** A plain note from a request ("Nothing nearer fitted…"). */
  note = $state<{ where: string | null; text: string } | null>(null);
  /** The latest "What changed". */
  change = $state<ChangeCard | null>(null);
  /** The group a request just brought, so the rail can bring it into view. */
  fresh = $state<{ groupId: string; n: number } | null>(null);

  #seq = 0;
  #legacy = new Map<string, WishDraft>();
  #base: () => string;
  #hooks: DeskHooks;

  constructor(base: () => string, hooks: DeskHooks) {
    this.#base = base;
    this.#hooks = hooks;
  }

  get base(): string {
    return this.#base();
  }

  #fail(where: string | null, text: string) {
    this.problem = { where, text };
  }
  #clear() {
    this.problem = null;
    this.note = null;
  }
  #drop(...keys: string[]) {
    const next = new Set(this.gone);
    for (const k of keys) next.add(k);
    this.gone = next;
  }
  #replaceLocal(p: Proposal) {
    this.local = [...this.local.filter((x) => x.id !== p.id), p];
  }

  /** Show a change card (and keep its numbering in one place). */
  showChange(title: string, res: ChangeResponse): ChangeCard {
    const card = changeCard(++this.#seq, title, res);
    this.change = card;
    return card;
  }
  dismissChange() {
    this.change = null;
  }

  /** Legacy `options` from a chat turn as cards; "Use this" adds the option's wish. */
  optionCards(options: PlanOption[]): Proposal[] {
    return options.map((o) => {
      const p = optionAsProposal(o);
      this.#legacy.set(p.id, o.wish);
      return p;
    });
  }

  // ── Questions ──

  async answer(q: Question, action: 'answer' | 'decide' | 'skip', answerId?: string): Promise<boolean> {
    if (this.busy) return false;
    this.#clear();
    this.busy = `q:${q.id}`;
    try {
      const r = await api<ChangeResponse & { question?: Question }>('POST', `${this.base}/questions/${encodeURIComponent(q.id)}`, action === 'answer' ? { action, answerId } : { action });
      if (r.status === 409) {
        this.goneQuestions = new Set([...this.goneQuestions, q.id]);
        this.#fail(null, 'That question has already been answered or has gone.');
        await this.#hooks.reload();
        return false;
      }
      if (!r.ok) {
        this.#fail(`q:${q.id}`, errorText(r));
        return false;
      }
      this.goneQuestions = new Set([...this.goneQuestions, q.id]);
      const chosen = action === 'answer' ? q.answers.find((a) => a.id === answerId)?.label : action === 'decide' ? q.answers.find((a) => a.id === q.defaultAnswerId)?.label : null;
      const title = action === 'skip' ? `Skipped: ${q.prompt}` : `Answered: ${chosen ?? 'You decide'}`;
      const card = changeCard(++this.#seq, title, r.body);
      if (card.days.length || card.lines.length || card.remember || action !== 'skip') this.change = card;
      await this.#hooks.reload();
      return true;
    } finally {
      this.busy = null;
    }
  }

  // ── Proposals ──

  async accept(p: Proposal): Promise<boolean> {
    if (this.busy) return false;
    this.#clear();
    this.busy = `p:${p.id}`;
    try {
      if (isOptionCard(p)) return await this.#acceptOption(p);
      const r = await api<ChangeResponse & { proposal?: Proposal; stale?: boolean }>('POST', `${this.base}/proposals/${encodeURIComponent(p.id)}`, { action: 'accept' });
      if (r.status === 409 && r.body.stale && r.body.proposal) {
        // The plan moved on: show the re-checked difference and ask again.
        this.#replaceLocal({ ...r.body.proposal, status: 'open' });
        this.stale = { ...this.stale, [p.id]: true };
        return false;
      }
      if (r.status === 409) {
        this.#drop(p.id);
        this.#fail(null, 'That choice is no longer open — the plan has moved on.');
        await this.#hooks.reload();
        return false;
      }
      if (!r.ok) {
        this.#fail(`p:${p.id}`, errorText(r));
        return false;
      }
      // Taking one closes its alternatives (a shape closes the other shapes).
      this.#drop(p.id, `group:${p.groupId}`);
      if (p.kind === 'shape') this.#drop(...this.local.filter((x) => x.kind === 'shape').map((x) => x.id));
      const { [p.id]: _, ...rest } = this.stale;
      this.stale = rest;
      this.showChange(`Used: ${p.title}`, r.body);
      await this.#hooks.reload();
      return true;
    } finally {
      this.busy = null;
    }
  }

  async #acceptOption(p: Proposal): Promise<boolean> {
    const wish = this.#legacy.get(p.id);
    if (!wish) {
      this.#fail(`p:${p.id}`, 'That option has gone — ask the planner again.');
      return false;
    }
    const r = await api<{ planVersion?: number | null; replanned?: boolean; warning?: string }>('POST', `${this.base}/wishes`, wish);
    if (!r.ok) {
      this.#fail(`p:${p.id}`, errorText(r, 'Could not add it.'));
      return false;
    }
    this.#drop(p.id, `group:${p.groupId}`);
    // The wishes route says only that it re-planned: the lines come from the reloaded latest version.
    const after = await this.#hooks.reload();
    if (after) this.showChange(`Used: ${p.title}`, after);
    return true;
  }

  async reject(p: Proposal, reason: RejectReason, note?: string): Promise<boolean> {
    if (this.busy) return false;
    this.#clear();
    if (isOptionCard(p)) {
      this.#drop(p.id);
      return true;
    }
    this.busy = `p:${p.id}`;
    try {
      const r = await api('POST', `${this.base}/proposals/${encodeURIComponent(p.id)}`, note ? { action: 'reject', reason, note } : { action: 'reject', reason });
      if (!r.ok && r.status !== 409) {
        this.#fail(`p:${p.id}`, errorText(r));
        return false;
      }
      this.#drop(p.id);
      return true;
    } finally {
      this.busy = null;
    }
  }

  /**
   * Ask for proposals (swap, fill, a day variant, a nudge, shapes). The group
   * that comes back joins the rail; `key` names the button that is working.
   */
  async request(req: ProposalRequest, key: string, where: string | null = null): Promise<Proposal[]> {
    if (this.busy) return [];
    this.#clear();
    this.busy = key;
    try {
      const { ok, body } = await postAsJob<{ proposals?: Proposal[]; note?: string; message?: string }>(`${this.base}/proposals`, { ...req });
      if (!ok) {
        this.#fail(where, body.error ?? body.message ?? 'The planner could not find anything just now.');
        return [];
      }
      const ps = (body.proposals ?? []).filter((p) => p && typeof p.id === 'string');
      if (!ps.length) {
        this.note = { where, text: body.note ?? body.message ?? 'Nothing fitted there. Try another way, or tell the planner what you have in mind.' };
        return [];
      }
      if (body.note) this.note = { where: null, text: body.note };
      this.local = [...this.local.filter((x) => !ps.some((p) => p.id === x.id)), ...ps];
      // A nudge's alternatives replace the group it nudged (unless they share its group).
      if (req.kind === 'nudge' && req.target.proposalId) {
        const old = this.local.find((x) => x.id === req.target.proposalId);
        if (old && !ps.some((p) => p.groupId === old.groupId)) this.#drop(`group:${old.groupId}`);
      }
      this.fresh = { groupId: ps[0].groupId, n: ++this.#seq };
      return ps;
    } finally {
      this.busy = null;
    }
  }

  nudge(p: Proposal, nudge: Nudge): Promise<Proposal[]> {
    // Keep the nudged proposal known locally so its group can be retired.
    if (!this.local.some((x) => x.id === p.id)) this.local = [...this.local, p];
    return this.request({ kind: 'nudge', target: { proposalId: p.id }, nudge }, `p:${p.id}`, `p:${p.id}`);
  }

  // ── Undo, restore, the brief ──

  async undo(toVersion: number, title?: string): Promise<boolean> {
    if (this.busy) return false;
    this.#clear();
    this.busy = 'undo';
    const undone = this.change?.planVersion ?? null;
    try {
      const r = await api<ChangeResponse>('POST', `${this.base}/undo`, { toVersion });
      if (r.status === 409) {
        this.#fail('undo', 'That version cannot be brought back — it was saved before undo existed.');
        return false;
      }
      if (!r.ok) {
        this.#fail('undo', errorText(r));
        return false;
      }
      const card = changeCard(++this.#seq, title ?? `Undone — back to how it was at version ${toVersion}`, { ...r.body, undo: null });
      this.change = { ...card, redoTo: title ? null : undone };
      await this.#hooks.reload();
      return true;
    } finally {
      this.busy = null;
    }
  }

  async patchBrief(patch: BriefPatch, what: string): Promise<boolean> {
    if (this.busy) return false;
    this.#clear();
    this.busy = 'brief';
    try {
      const r = await api<ChangeResponse>('PATCH', `${this.base}/brief`, patch);
      if (!r.ok) {
        this.#fail('brief', errorText(r));
        return false;
      }
      const card = changeCard(++this.#seq, what, r.body);
      if (card.days.length || card.lines.length) this.change = card;
      await this.#hooks.reload();
      return true;
    } finally {
      this.busy = null;
    }
  }

  tell(text: string) {
    this.#hooks.tell?.(text);
  }
}
