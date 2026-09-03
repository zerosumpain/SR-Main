<script lang="ts">
  // One day of the briefing, opened from the WhatsApp message or the strip.
  //
  // The message that arrives at 07:00 is eight lines. This is everything the
  // message had to leave out for that day: the fact sheet it was composed
  // from, section by section, every fact linked back to the room it came from;
  // what did not report; and the message itself, verbatim, so the summary and
  // its evidence can be read against each other.
  import type { PageData } from './$types';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import FactList from '$lib/components/jkai/daydream/hub/FactList.svelte';
  import {
    briefingFactRows,
    briefingFactSections,
    briefingRollupCells,
  } from '$lib/components/jkai/daydream/briefing-sections';
  import type { BriefingSourceRow } from '$lib/briefing/types';

  let { data }: { data: PageData } = $props();

  const briefing = $derived(data.briefing);
  const detail = $derived(briefing.detail ?? null);
  const sections = $derived(briefingFactSections(detail));
  const cells = $derived(briefingRollupCells(briefing));
  const gaps = $derived(detail?.gaps ?? []);
  const sources = $derived(detail?.sources ?? []);
  const factCount = $derived(detail?.facts?.length ?? 0);

  const dateLabel = $derived(detail?.dateLabel || briefing.title || briefing.id);
  const titleLines = $derived(
    detail?.headline ? [detail.headline] : [briefing.title || 'The briefing'],
  );

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter = (i: number) => ALPHABET[i % ALPHABET.length];
  // A is the rollup; the fact sections take B onwards, and the three closing
  // bands carry on from wherever they stop.
  const sentLetter = $derived(letter(sections.length + 1));
  const healthLetter = $derived(letter(sections.length + 2));
  const stripLetter = $derived(letter(sections.length + 3));

  const STATUS_LABEL: Record<BriefingSourceRow['status'], string> = {
    ok: 'reported',
    failed: 'failed',
    stale: 'stale',
    empty: 'no update',
  };

  function stamp(iso: string | undefined): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }
</script>

<svelte:head><title>Briefing {briefing.id} — JKAI</title></svelte:head>

<section class="band flush">
  <div class="inner">
    <SectionHead
      kicker="A / {dateLabel}"
      title={titleLines}
      strap="Everything the morning message was composed from, kept for the day it describes. Each figure below jumps to the facts behind it; each fact links back to the room that produced it."
    />
    <RollupGrid {cells} min={190} />
    <p class="note">
      {briefing.status} · started {stamp(briefing.startedAt)} · {factCount} fact{factCount === 1
        ? ''
        : 's'} · {briefing.llmCalls} model call{briefing.llmCalls === 1 ? '' : 's'} · ${(
        briefing.costUsd ?? 0
      ).toFixed(3)}
    </p>
  </div>
</section>

{#each sections as section, i (section.slug)}
  <section class="band anchored" class:sunken={i % 2 === 1} id="sec-{section.slug}">
    <div class="inner">
      <SectionHead
        kicker="{letter(i + 1)} / Fact sheet"
        title={[section.section]}
        strap="{section.facts.length} fact{section.facts.length === 1 ? '' : 's'} from {section
          .facts[0]?.source ?? 'the composer'}."
      />
      <FactList rows={briefingFactRows(section.facts)} columns={section.facts.length > 6 ? 2 : 1} />
    </div>
  </section>
{/each}

<section class="band anchored" class:sunken={sections.length % 2 === 1} id="sec-as-sent">
  <div class="inner">
    <SectionHead
      kicker="{sentLetter} / As sent"
      title={['The message', 'that went out']}
      strap="The composed summary, verbatim. It may only quote the fact sheet above, so anything here that is not up there is a fault worth reporting."
    />
    {#if briefing.markdown}
      <div class="sent"><ChatMarkdown content={briefing.markdown} /></div>
    {:else}
      <p class="note warn">This briefing completed without a written summary.</p>
    {/if}
    {#if detail?.daydreamsText}
      <p class="field-label sent-heading">💭 Daydreams{#if detail.daydreamsDay}
          · {detail.daydreamsDay}{/if}</p>
      <pre class="sent-block">{detail.daydreamsText}</pre>
    {/if}
  </div>
</section>

<section class="band anchored" class:sunken={sections.length % 2 === 0} id="sec-run-health">
  <div class="inner">
    <SectionHead
      kicker="{healthLetter} / Run health"
      title={['What did not', 'report']}
      strap="A source that failed is named with its real error rather than silently skipped, and every gap the composer declared is a section the model was forbidden to fill."
    />
    {#if gaps.length}
      <div class="stack tight">
        {#each gaps as gap (gap.section + gap.reason)}
          <div class="card t-watch">
            <p class="card-kicker">{gap.section}</p>
            <p class="card-body">{gap.reason}</p>
          </div>
        {/each}
      </div>
    {:else}
      <p class="note good">No gaps. Every configured source reported for this day.</p>
    {/if}

    {#if sources.length}
      <div class="tbl-wrap section-gap">
        <table class="tbl compact">
          <thead>
            <tr><th>Source</th><th>Status</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {#each sources as source (source.key)}
              <tr class:dim={source.status === 'empty'}>
                <td class="cell-lead nowrap">{source.label}</td>
                <td class="nowrap" class:bad={source.status === 'failed'}
                  >{STATUS_LABEL[source.status]}</td
                >
                <td class="cell-wrap">{source.error || source.detail}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="note">This record predates the source ledger.</p>
    {/if}
  </div>
</section>

<section class="band" class:sunken={sections.length % 2 === 1}>
  <div class="inner">
    <SectionHead
      kicker="{stripLetter} / The archive"
      title={['Every day', 'kept']}
      strap="The last thirty briefings. Each is its own page at the address the morning message links to."
    />
    <div class="strip">
      {#each data.days as day (day.id)}
        <a
          class="tag"
          class:t-action={day.id === briefing.id}
          class:t-urgent={day.status === 'failed'}
          href="/jkai/daydreams/briefing/{day.id}">{day.id}</a
        >
      {/each}
      {#if !data.days.length}<span class="dim">The day strip could not be read.</span>{/if}
    </div>
    <p class="note"><a class="link" href="/jkai/daydreams/briefing">Back to the briefing room</a></p>
  </div>
</section>

<style>
  /* The composed summary — a measure, so the markdown does not run the width
     of the shell's scroll container. */
  .sent {
    max-width: 78ch;
  }
  .sent-heading {
    margin-top: clamp(24px, 3vw, 40px);
  }
  /* The WhatsApp block, exactly as the phone received it: mono, and WRAPPING —
     a `pre` that does not wrap is the widest descendant of a horizontal scroll
     container, which stretches the whole room. */
  .sent-block {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
    color: var(--text-primary);
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--accent);
    padding: 14px 16px;
    margin: 0;
    max-width: 78ch;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
