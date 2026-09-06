<script lang="ts">
  /**
   * One person's own work, on the household room.
   *
   * The Family tab used to be a presence map and nothing else. Four of the
   * five people in the trail have had a year of position history and a feature
   * store since the family backfill, and nothing had ever asked a question
   * about them, because the sweep and the hypothesis proposer both ran for
   * John alone. Both are per-subject now, so this reads what they produced.
   *
   * It opens on a deck rather than on a table: three figures — questions
   * asked, findings that survived the correction, suggestions that cited them
   * — and the rows underneath for whoever wants them. The old shape was an
   * accordion whose body was three nested tables, which meant the answer to
   * "has anything been noticed about Rory" was four clicks away.
   *
   * A suggestion is filed under a person by its CITATIONS — the ponder pack
   * cards each member as `family:<subject>` — never by finding their name in
   * the text, which would file every thought that merely mentions them.
   */
  import { kindLabel } from '$lib/daydream/thought-groups';
  import { verdictTone } from '$lib/daydream/priority';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';

  /** A question on the board. Structurally a subset of `BoardRow`. */
  export interface PersonQuestion {
    id: string;
    question: string;
    verdict: string | null;
  }

  /** A suggestion that cited this person as evidence. */
  export interface PersonThought {
    id: string;
    kind: string;
    title: string;
    score: number;
    status: string;
    createdAt: string;
  }

  export interface PersonDetail {
    hypotheses: PersonQuestion[];
    sweep: { testsRun: number; naiveHits: number; findings: unknown[]; errors: string[] } | null;
    thoughts: PersonThought[];
  }

  interface Props {
    subject: string;
    detail?: PersonDetail | undefined;
    /** The person's last fix, said outright — `—` when there has never been one. */
    lastSeen?: string | null;
  }

  let { subject, detail = undefined, lastSeen = null }: Props = $props();

  const VERDICT_LABEL: Record<string, string> = {
    supported: 'held up',
    refuted: 'legacy assessment',
    inconclusive: 'not established',
    wrong_direction: 'backwards',
    underpowered: 'not enough data',
  };

  function cap(sub: string): string {
    return sub.charAt(0).toUpperCase() + sub.slice(1);
  }

  const name = $derived(cap(subject));
  const questions = $derived(detail?.hypotheses ?? []);
  const sweep = $derived(detail?.sweep ?? null);
  const thoughts = $derived(detail?.thoughts ?? []);

  /** Verdict buckets, in the tone order the hub sorts everything by. */
  const verdicts = $derived(
    (() => {
      const by = new Map<string, number>();
      for (const q of questions) by.set(q.verdict ?? 'open', (by.get(q.verdict ?? 'open') ?? 0) + 1);
      return [...by.entries()].map(([verdict, n]) => ({
        verdict,
        n,
        label: verdict === 'open' ? 'still open' : (VERDICT_LABEL[verdict] ?? verdict.replace(/_/g, ' ')),
        tone: verdictTone(verdict === 'open' ? null : verdict),
      }));
    })(),
  );

  const held = $derived(questions.filter((q) => q.verdict === 'supported').length);
  /** A suggestion nobody has ruled on is the one thing here waiting on him. */
  const unrated = $derived(
    thoughts.filter((t) => t.status === 'new' || t.status === 'delivered' || t.status === 'seen').length,
  );

  const tiles = $derived<DeckTile[]>([
    {
      key: 'questions',
      label: 'Questions asked',
      value: String(questions.length),
      tone: questions.length ? 'steady' : 'quiet',
      sub: questions.length
        ? `${held} still holding. They sit on the board with everyone else's.`
        : 'Proposed nightly, and only once there are enough days of history to answer them.',
    },
    {
      key: 'findings',
      label: 'Findings',
      value: sweep ? String(sweep.findings.length) : '—',
      tone: sweep ? (sweep.findings.length ? 'good' : 'steady') : 'watch',
      sub: sweep
        ? `${sweep.testsRun} tests · ${sweep.naiveHits} would pass an uncorrected p<0.05 · these survive the false-discovery correction.`
        : `The sweep has not run for ${name} yet.`,
    },
    {
      key: 'suggestions',
      label: 'Suggestions',
      value: String(thoughts.length),
      tone: unrated ? 'action' : thoughts.length ? 'steady' : 'quiet',
      lit: unrated > 0,
      sub: thoughts.length
        ? `${unrated} still waiting on a verdict. Filed by citation, never by name.`
        : `Nothing has cited ${name} as evidence yet.`,
    },
  ]);
</script>

<article class="person" id="p-{subject}">
  <header class="person-hd">
    <h3 class="person-name">{name}</h3>
    {#if lastSeen}<span class="person-seen">last fix {lastSeen}</span>{/if}
  </header>

  <StatDeck {tiles} min={190} />

  <div class="person-body">
    <!-- Questions live on the Discoveries board, which spans the whole
         household with a name against each card. A second copy here would be
         two places to read the same thing and one of them would go stale, so
         this is the shape of the answer and a route to the rows. -->
    <div class="detail-block">
      <p class="field-label">Questions asked about {name}</p>
      {#if !questions.length}
        <p class="detail-line">
          Nothing yet. Questions are proposed nightly per person, and only once there are enough
          days of history to answer them.
        </p>
      {:else}
        <p class="verdict-row">
          {#each verdicts as v (v.verdict)}
            <span class="pill t-{v.tone}">{v.n} {v.label}</span>
          {/each}
        </p>
        <p class="detail-line">
          The false-discovery correction is applied within {name} — never across the household.
        </p>
        <a class="cta" href="/jkai/daydreams/discoveries?who={subject}">Open {name}'s questions</a>
      {/if}
    </div>

    <div class="detail-block">
      <p class="field-label">What the sweep found</p>
      {#if !sweep}
        <p class="detail-line">The sweep has not run for {name} yet.</p>
      {:else}
        {#if sweep.errors?.length}
          <p class="detail-line">{sweep.errors[0]}</p>
        {/if}
        {#if sweep.findings.length}
          <div class="tbl-wrap">
            <table class="tbl compact">
              <thead>
                <tr><th>Pair</th><th class="right">r</th><th class="right">q</th><th class="right">n</th></tr>
              </thead>
              <tbody>
                {#each sweep.findings.slice(0, 6) as f, fi (fi)}
                  {@const row = f as Record<string, unknown>}
                  <tr>
                    <td class="cell-lead cell-wrap">{row.a} ↔ {row.b}</td>
                    <td class="right num">{Number(row.r ?? 0).toFixed(2)}</td>
                    <td class="right num">{Number(row.q ?? 0).toFixed(3)}</td>
                    <td class="right num">{String(row.n ?? '—')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="detail-line">
            {sweep.testsRun} tests ran and nothing survived the correction. That is a result, not a
            gap.
          </p>
        {/if}
      {/if}
    </div>

    <div class="detail-block">
      <p class="field-label">Suggestions that cited {name}</p>
      {#if !thoughts.length}
        <p class="detail-line">Nothing has cited {name} as evidence yet.</p>
      {:else}
        <div class="tbl-wrap">
          <table class="tbl compact">
            <thead>
              <tr><th>Suggestion</th><th>Kind</th><th class="right">Score</th><th class="right">Status</th></tr>
            </thead>
            <tbody>
              {#each thoughts as t (t.id)}
                <tr>
                  <td class="cell-lead cell-wrap">
                    <a class="link" href="/jkai/daydreams/feed?open={t.id}">{t.title}</a>
                  </td>
                  <td>{kindLabel(t.kind)}</td>
                  <td class="right num">{t.score}</td>
                  <td class="right">{t.status}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
</article>

<style>
  /* Room-specific only. Everything the markup names in lower case —
     `.detail-block`, `.field-label`, `.detail-line`, `.tbl`, `.pill`, `.cta`,
     `.link` — is the shared `.ds-vocab` vocabulary declared once in the
     daydream layout, and must not be redeclared here. */

  .person {
    border-top: 1px solid var(--line-hair);
    padding: clamp(20px, 2.4vw, 30px) 0 clamp(24px, 3vw, 36px);
    min-width: 0;
    scroll-margin-top: 90px;
  }
  .person:last-child {
    border-bottom: 1px solid var(--line-hair);
  }

  .person-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin: 0 0 14px;
  }
  .person-name {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0;
  }
  .person-seen {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .person-body {
    display: flex;
    flex-direction: column;
    gap: 22px;
    margin-top: 20px;
    min-width: 0;
  }

  .verdict-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 10px;
  }
</style>
