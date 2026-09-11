/**
 * WHAT HAPPENS TO YOUR DOCUMENT — in the words a reader actually uses.
 *
 * A reader deciding whether to put an unpublished paper into this thing is
 * asking one question: where does it go, and can I get it back out of every
 * place it went? Everything needed to answer that already existed — in a spec, a
 * commit message and a schema comment, none of which is on the page.
 *
 * So this is the answer, written once, as data. `HandlingPanel.svelte` draws it
 * as a diagram AND as a list — the list is not a fallback, it is what a screen
 * reader, a printer and the Word export all get, and it carries exactly the same
 * journey. `report-doc.ts` renders it into the document, for the same reason the
 * glossary is rendered there: a paper that lands on somebody's desk has nobody
 * to ask.
 *
 * TWO RULES FOR EDITING THIS FILE:
 *
 * 1. **Behaviour, not mechanism.** "The findings are written down beside the
 *    paper", not "artefacts persist to `policy_artefacts` under the analysis id".
 * 2. **Never overclaim.** Every sentence here is a promise to somebody who is
 *    trusting it with work that is not theirs to leak. If a thing cannot be
 *    guaranteed, this file says so in the same plain words as everything else —
 *    that is what `BEYOND` is for, and it is not an appendix.
 */

/** Where a stop on the journey happens. The diagram groups by this, and it is the whole point of the picture. */
export type Place =
  /** On the machine that runs this site. */
  | 'site'
  /** Somebody else's computer. Nothing here can reach it. */
  | 'away'
  /** Your own device, once you have taken a copy. */
  | 'you';

export type Stop = {
  /** Two or three words, for the diagram. */
  short: string;
  title: string;
  /** What happens, in ordinary words. */
  what: string;
  /**
   * The one sentence that must not be skimmed past, kept OUT of `what` rather
   * than marked up inside it.
   *
   * `DashHead` already established that this feature does not render `{@html}`,
   * and a caveat is not worth being the exception: a second field costs nothing,
   * cannot inject anything, and can be asserted in a test.
   */
  emphasis?: string;
  place: Place;
};

export const PLACE_LABEL: Record<Place, string> = {
  site: 'On this site',
  away: 'Leaves this site',
  you: 'With you',
};

/**
 * The journey, start to finish.
 *
 * Step 2 is the reason the diagram exists. Everything else stays on one machine
 * and can be destroyed on demand; the model that reads the paper runs on
 * somebody else's computer, and no amount of care at this end changes that. A
 * picture that did not show that arrow leaving would be a reassuring picture and
 * a dishonest one.
 */
export function journey(sealed: boolean): Stop[] {
  return [
    {
      short: 'You send it',
      title: 'You send the paper',
      place: 'site',
      what: sealed
        ? 'It is scrambled the moment it arrives — the document, its name, and the title you gave it. What is stored is unreadable without a key, and the key is kept outside the database, where the nightly copies never look.'
        : 'It is stored on the machine that runs this site, and kept there until you remove it. Nobody else can open it: every page and download here is behind your sign-in.',
    },
    {
      short: 'A model reads it',
      title: 'A model reads it',
      place: 'away',
      what: 'The assessment is written by a language model, and that model runs on a company’s computers, not ours. The paper is sent there in order to be read.',
      emphasis: 'That copy is the one thing on this page we cannot delete for you. Whether it is kept, and for how long, is a setting on the account the site uses to reach it.',
    },
    {
      short: 'Findings written',
      title: 'The findings are written down',
      place: 'site',
      what: sealed
        ? 'Every claim, body, play and conclusion is stored beside the paper — scrambled in the same way, under the same key. So is the running commentary the assessment keeps about itself. On a sealed run the conversations with the model are not written down at all.'
        : 'Every claim, body, play and conclusion is stored beside the paper, along with the conversations with the model, so the assessment can be checked and picked apart later.',
    },
    {
      short: 'You take a copy',
      title: 'You take a copy',
      place: 'you',
      what: 'Word, markdown, or the offline pack — one file that holds the whole dashboard and asks nothing of the network. Once it is on your machine it is yours, and nothing here can reach it or take it back.',
    },
    {
      short: 'You purge it',
      title: 'You purge it',
      place: 'site',
      what: sealed
        ? 'The key is destroyed first, then the records. Burning the key turns every copy of this run into gibberish at the same moment, wherever a copy has got to, without anyone having to go and find them.'
        : 'The paper, the findings, the commentary, the queue entries and anything another assessment wrote about this one are all deleted together.',
    },
    {
      short: 'What is left',
      title: 'What is left afterwards',
      place: 'site',
      what: sealed
        ? 'Copies made by the nightly backup are still on disk for a fortnight, and they always will be — that is what a backup is. They are gibberish, and they stay gibberish, because the only thing that could read them no longer exists.'
        : 'Copies made by the nightly backup are still readable for about a fortnight, until they rotate out on their own. Deleting the records here does not reach them. If that matters for a particular paper, seal it when you submit it.',
    },
  ];
}

/** What the site is holding while an assessment exists. */
export function kept(sealed: boolean): string[] {
  return [
    sealed ? 'The paper itself, scrambled.' : 'The paper itself.',
    sealed ? 'The assessment and its workings, scrambled.' : 'The assessment and its workings.',
    sealed
      ? 'How much the run cost and which models answered — but not a word of what was said to them.'
      : 'The conversations with the model, so a finding can be traced back to what produced it.',
    'When each stage ran, and what it could not establish.',
  ];
}

/** What a purge removes. Written as a list because it was the thing most easily assumed and most easily wrong. */
export function destroyed(sealed: boolean): string[] {
  const common = [
    'The paper, in full.',
    'Every finding, and the trail of reasoning behind it.',
    'The queue entries the run left in the site’s own machinery.',
    'Anything another assessment recorded about this one.',
    'Any share link pointing at it.',
  ];
  return sealed ? ['The key — first, before anything else.', ...common] : common;
}

/**
 * What nobody here can reach.
 *
 * This list is the reason the rest of the page can be believed. A handling note
 * that only says what it CAN do is marketing.
 */
export function beyond(sealed: boolean): string[] {
  const provider = 'The copy the language model’s provider received in order to read the paper. That is an account setting on their side, not something this site can delete.';
  return sealed
    ? [
        provider,
        'Nothing else. A sealed run does no web searching, is never compared against your other papers, and remembers nothing about the organisations it meets — so there is no third place for it to have gone.',
      ]
    : [
        provider,
        'Anything a web search picked up while researching the paper. The search provider has the queries, and those are not ours to erase.',
        'The nightly backups, until they rotate out on their own after about a fortnight.',
      ];
}

/** The one-line answer, for a reader who reads nothing else. */
export function headline(sealed: boolean): string {
  return sealed
    ? 'This is a sealed assessment. Everything it stores is scrambled under a key held outside the database, and purging it destroys that key — which makes every copy unreadable at once, including the ones in backups that deleting cannot reach.'
    : 'Your paper is stored on this site, read once by a language model elsewhere, and removed in full whenever you say so. Backups keep a readable copy for about a fortnight; seal a run at submission if that is not acceptable for a particular paper.';
}
