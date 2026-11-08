import { db } from '$lib/db';
import { jkaiBuilds, projectVisibility } from '$lib/db/schema';
import { isNotNull, or, desc } from 'drizzle-orm';
import { resolveVisibilityMap, isProjectPublic, isProjectSlug } from '$lib/projects/visibility';
import { isOwnerEmail } from '$lib/server/access';
import { OWNER_ONLY_CARDS } from './owner-cards.server';
import { PROJECT_CARDS } from './cards';
import { HERO_VIEW_COOKIE, chooseHeroView } from '$lib/landing/hero-view';
import { HEALTH_TIMEZONE } from '$lib/constants/health-day';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const session = await event.locals.auth();
  // Which way the index reads: the landing page's own choice (a ?view= link,
  // then the sr_hero_view cookie, then the notes), so the first paint already
  // shows it. The HTML depends on that cookie (and on who is signed in), so
  // keep it out of every shared cache, as the home page does.
  const view = chooseHeroView({ query: event.url.searchParams.get('view'), cookie: event.cookies.get(HERO_VIEW_COOKIE) });
  event.setHeaders({ 'cache-control': 'private, no-cache' });
  // "Sun 11 Oct", in the owner's day, for a view's dateline or date stamp.
  const dateline = new Date()
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: HEALTH_TIMEZONE })
    .replace(',', '');
  // Only the owner sees private projects + the visibility/remove controls; a
  // signed-in guest (non-owner) sees the same public listing as the public.
  const authenticated = isOwnerEmail(session?.user?.email);

  const [published, visRows] = await Promise.all([
    db
      .select({
        id: jkaiBuilds.id,
        title: jkaiBuilds.title,
        prompt: jkaiBuilds.prompt,
        publishedSlug: jkaiBuilds.publishedSlug,
        // The page a change request added to the repo. See schema.ts — a build
        // can carry an address in either column, never the same one in both.
        projectSlug: jkaiBuilds.projectSlug,
        // Curated card copy, written when the build was promoted. Null on
        // anything published before promotion existed — resolveProjectCard
        // falls those back to the title and prompt, exactly as before.
        cardTitle: jkaiBuilds.cardTitle,
        cardBlurb: jkaiBuilds.cardBlurb,
        cardTag: jkaiBuilds.cardTag,
        iterationsCompleted: jkaiBuilds.iterationsCompleted,
        createdAt: jkaiBuilds.createdAt,
        updatedAt: jkaiBuilds.updatedAt,
      })
      .from(jkaiBuilds)
      .where(or(isNotNull(jkaiBuilds.publishedSlug), isNotNull(jkaiBuilds.projectSlug)))
      .orderBy(desc(jkaiBuilds.updatedAt)),
    db
      .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
      .from(projectVisibility),
  ]);

  const visibility = resolveVisibilityMap(visRows);

  // A git-target build parks its PR URL / branch ref in `publishedSlug`, so
  // "has a publishedSlug" is not the same as "is a project". Those rendered
  // cards linking at /projects/https://github.com/... — drop them here rather
  // than relying on someone hiding each one by hand after it appears.
  //
  // `projectSlug` is the other way a build gets an address: a change request
  // that added a page to the repo and had a card flipped on from the build
  // menu. Collapse both into one `slug` so nothing downstream has to know
  // which column a card came from — the old code passed `publishedSlug!`
  // around, and that non-null assertion is exactly what would break here.
  const projectPublishes = published
    .map((p) => {
      // `source` tells the card which kind of thing it is looking at, so the
      // Remove button can pick the right call: a repo page has no published
      // files to delete, only a card to withdraw.
      const fromRepo = isProjectSlug(p.projectSlug);
      return {
        ...p,
        slug: fromRepo ? p.projectSlug : p.publishedSlug,
        source: fromRepo ? ('repo' as const) : ('build' as const),
      };
    })
    .filter((p) => isProjectSlug(p.slug));

  // Attach each build's resolved visibility; hide private builds from the
  // public. A build with no visibility row is PRIVATE (see $lib/projects/
  // visibility) — publishing does not put it on the index, the toggle does.
  const withVis = projectPublishes.map((p) => ({
    ...p,
    isPublic: isProjectPublic(visibility, p.slug!),
  }));
  const projects = authenticated ? withVis : withVis.filter((p) => p.isPublic);

  // The hand-built cards are filtered HERE, against the real visibility map.
  // The client must not decide: the public is sent an empty map (it names every
  // private slug), and reading an empty map client-side resolves every static
  // key to its default — public — so every private card rendered for anonymous
  // visitors. Sending only the permitted cards also keeps private card copy out
  // of the public page payload.
  const cards = authenticated ? PROJECT_CARDS : PROJECT_CARDS.filter((c) => isProjectPublic(visibility, c.key));

  // The visibility map names every private project's slug: the owner's toggles
  // only, never the public's.
  return { view, dateline, projects, cards, authenticated, visibility: authenticated ? visibility : {}, ownerCards: authenticated ? OWNER_ONLY_CARDS : [] };
};
