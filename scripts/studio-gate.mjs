#!/usr/bin/env node
/**
 * Studio gate — does the explainer actually teach?
 *
 * Five checks per served project: the explainer kit actually mounted (once,
 * across the whole project — see below), then per chapter: reachable, has a
 * kit-produced visual, has a control that changes an outcome when driven,
 * cites a source from the brief.
 *
 * Contract, copied from smoke-static-app.mjs: a harness that could not run
 * prints { ran: false }. Never { passed: false }. A broken harness reporting a
 * failing app blocks good work and teaches the model to route around the tool.
 *
 * Every finding carries a `remedy`. An unfixable finding repeated three times
 * kills a finished build — that is the design_lint_loop incident of 2026-08-09.
 *
 *   echo '<base64 spec>' | node scripts/studio-gate.mjs <baseUrl>
 *
 * Spec shape (JSON, base64-encoded on stdin):
 *   {
 *     chapters: Array<{ n: number, title: string, path: string, leverId: string, outcomeId: string }>,
 *     sourceUrls?: string[],
 *     kitFiles?: string[],   // paths relative to the served root, e.g. "explainer-kit/tokens.css"
 *   }
 *
 * kitFiles is OPTIONAL. If it is absent or empty, the kit-presence check is
 * skipped entirely — this script never invents a default file list, because
 * the caller (studio-gate.ts, Task 13) is the one that knows which files the
 * kit sync was supposed to mount (see design-assets.ts EXPLAINER_FILES).
 */
// @ts-nocheck — a standalone node script, deliberately untyped, run by
// `node scripts/studio-gate.mjs` and never bundled. It sat outside the
// type-check graph until studio-gate.test.ts began importing injectBaseHref
// from it; without this line that one import pulls the whole file in and
// svelte-check reports ~20 implicit-any errors on code that has always been
// this way. Checking it properly would mean typing Playwright handles in a
// file that cannot import Playwright's types.
import { pathToFileURL } from 'node:url';

let out = { ran: false, reason: 'harness did not start' };

// Playwright error messages carry ANSI colour codes and a multi-line call
// log. An LLM agent reads finding text, not a terminal, so strip the escapes
// and keep only the first line — the rest is noise for that reader.
const stripAnsi = (s) => String(s).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const firstLine = (s) => stripAnsi(s).split('\n')[0].slice(0, 300);

/**
 * Make the browser see the page the way a human does.
 *
 * Both surfaces a reader ever reaches — the preview proxy and
 * /projects/<slug>/ — inject a <base href> at the project root, and the system
 * prompt therefore MANDATES project-root-relative URLs ("styles.css",
 * "assets/three.min.js"). This harness drove the bare static server with no
 * base tag, where exactly those URLs resolve against the chapter directory and
 * 404. No stylesheet, no scripts, so no canvas, no diagram, no controls and no
 * tokens — and the gate duly reported prose-only, no-model, no-design-tokens
 * and no-scene about a page that was, on every surface anyone looks at, fine.
 *
 * Measured on the surviving snapshot of build 85dac418: 24 findings without
 * this, 8 with it (and 7 of those 8 were an artefact of the replay passing no
 * source URLs). The build had been marked failed for fifteen iterations.
 *
 * Note what is deliberately NOT changed: the broken-link check resolves hrefs
 * against the server root via `new URL(href, baseUrl)`. That looks like the
 * same bug and is in fact already correct — with a base tag at the project
 * root, "styles.css" resolves to project-root/styles.css, which is precisely
 * what that fetch asks for. Making it page-relative would break it.
 */
export function injectBaseHref(html, projectRoot) {
  // Never double-inject: a page that already declares its own base is telling
  // us where its root is, and overriding that would be a new lie.
  //
  // Comments are stripped before the test and the tag must actually carry an
  // href. The first version tested /<base\s/ against the raw HTML, so a page
  // whose COMMENT mentioned "<base href>" was treated as already-based and got
  // no base tag — every asset then 404'd and the gate reported prose-only,
  // no-model and no-design-tokens. Which is precisely the bug this function
  // exists to fix, reintroduced one layer up. Caught by running the kit's own
  // worked example through the real gate: its comment explains the base-href
  // rule, and that sentence was enough to break it.
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/<base\s[^>]*href/i.test(withoutComments)) return html;
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}<base href="${projectRoot}">`)
    : `<base href="${projectRoot}">${html}`;
}

/**
 * What kind of control is this chapter's lever?
 *
 * Read from the DOM, so a spine that claims `choice` and ships a slider is
 * reported as a slider. Returns null when the lever is missing — the
 * `no-model` rule already covers that and this must not double-report it.
 */
async function lever0Kind(root, leverId) {
  const el = root.locator(`[data-lever="${leverId}"]`).first();
  if ((await el.count().catch(() => 0)) === 0) return null;
  return el.evaluate((n) => {
    const tag = n.tagName.toLowerCase();
    if (tag === 'input') return (n.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'select') return 'select';
    if (n.getAttribute('role') === 'radiogroup') return 'choice';
    if (n.hasAttribute('aria-pressed')) return 'toggle';
    if (n.querySelector('button')) return 'buttons';
    return tag;
  }).catch(() => null);
}

async function serveLikeAHuman(page, baseUrl) {
  const projectRoot = new URL('/', baseUrl).toString();
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    let response;
    try {
      response = await route.fetch();
    } catch {
      return route.continue(); // a fetch failure is the navigation's problem to report, not ours
    }
    const type = response.headers()['content-type'] || '';
    if (!type.includes('html')) return route.fulfill({ response });
    let body;
    try {
      body = await response.text();
    } catch {
      return route.fulfill({ response });
    }
    return route.fulfill({ response, body: injectBaseHref(body, projectRoot) });
  });
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) { out = { ran: false, reason: 'no base url given' }; return; }

  const stdin = await new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 5000);
  });

  let spec;
  try {
    spec = JSON.parse(Buffer.from(stdin.trim(), 'base64').toString('utf8'));
  } catch {
    out = { ran: false, reason: 'could not parse the spec on stdin' };
    return;
  }
  const chapters = spec.chapters || [];
  const kitFiles = Array.isArray(spec.kitFiles) ? spec.kitFiles : [];
  const sourceHosts = new Set(
    (spec.sourceUrls || []).map((u) => { try { return new URL(u).host; } catch { return null; } }).filter(Boolean),
  );
  if (chapters.length === 0) { out = { ran: false, reason: 'no chapters in the spec' }; return; }

  // How many chapters the plan says should be FINISHED by now. Iteration 1 is
  // the skeleton (every chapter a placeholder), iteration 2 delivers chapter 1,
  // and so on — so after iteration N, chapters 1..N-1 are due. Without this the
  // gate reported every unbuilt chapter as prose-only/no-model/uncited on every
  // single iteration: not wrong, but premature, and it padded each iteration's
  // context with a wall of findings for work the agent was not yet meant to
  // have done. 0 or absent means "check everything", preserving old behaviour
  // for any caller that does not supply it.
  const dueBy = Number.isFinite(spec.chaptersDue) ? Math.max(0, spec.chaptersDue) : 0;

  const findings = [];
  const notYetDue = [];
  // Both are page-level facts, not per-chapter — check once, on the first
  // chapter that loads, since every chapter shares the same shell.
  let linksChecked = false;
  let designChecked = false;
  let sceneCount = 0;
  // Editorial variety. Every chapter of every build used to come out
  // structurally identical — seven chapters, seven times `article > h2 > h2` —
  // and every lever was a range slider, including for "which of six topics".
  // Nothing checked for it, so nothing stopped it.
  const formsSeen = [];
  const controlsSeen = [];

  // Check 0: the explainer kit actually mounted. Chapter 0 because this is a
  // project-level fact, not any one chapter's. A failed kit sync logs an
  // error and lets the build continue by design (the sync retries every
  // iteration), but that log line is a weak signal across a 20-iteration
  // unattended build — its real consequence, the agent inventing its own
  // visual language, is only visible by reading the finished output. So this
  // checks the served files directly instead of trusting anyone read the log.
  if (kitFiles.length > 0) {
    const missing = [];
    for (const rel of kitFiles) {
      const url = new URL(rel, baseUrl).toString();
      try {
        const resp = await fetch(url);
        if (!resp.ok) missing.push(rel);
      } catch {
        missing.push(rel);
      }
    }
    if (missing.length > 0) {
      findings.push({
        chapter: 0,
        rule: 'kit-missing',
        message: `The explainer kit is not reachable at the served root: ${missing.length}/${kitFiles.length} kit file(s) 404'd — ${missing.join(', ')}.`,
        remedy: `Two possible causes. Most likely: your server only serves a subdirectory (e.g. public/ or dist/) that excludes explainer-kit/ — serve the workspace root instead, or copy the kit files into the directory you do serve. Less likely: the kit mount itself failed — check the build log for an "Explainer kit sync FAILED" line; if you see one, this isn't something you can fix directly, mention it in ## Evaluation. Until ${missing.join(', ')} are reachable, you are likely inventing your own visuals instead of using the kit.`,
      });
    }
  }

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (e) { out = { ran: false, reason: `playwright is not available: ${e.message}` }; return; }

  let browser;
  try { browser = await chromium.launch({ args: ['--no-sandbox'] }); }
  catch (e) { out = { ran: false, reason: `could not launch chromium: ${e.message}` }; return; }

  try {
    for (const ch of chapters) {
      // `new URL` and `newPage()` used to sit outside this try, so a
      // malformed ch.path threw past the per-chapter boundary and erased
      // every finding already collected for earlier chapters (proved by
      // review: a 3-chapter spec with a malformed chapter-2 path returned
      // { ran: false }, discarding chapter 1's pass). Both now live inside
      // it: one bad chapter costs one chapter, never the run.
      let page;
      try {
        // prompt.ts mandates chapters be served at exactly /chapter-<n>/,
        // but an agent may still land elsewhere (it used to offer
        // /chapter/<n>/ as an equally-valid example, and old context from
        // earlier iterations can linger). Try the caller-supplied path
        // first, then three fixed fallbacks — bounded at four attempts
        // total, never more, no crawling — before reporting unreachable. A
        // build that used the mandated path always hits on the first try.
        const rawCandidates = [ch.path, `/chapter/${ch.n}/`, `/chapter-${ch.n}`, `/chapters/${ch.n}/`];
        const attempted = [];
        page = await browser.newPage();
        await serveLikeAHuman(page, baseUrl);
        let resp = null;
        for (const cand of rawCandidates) {
          if (attempted.includes(cand)) continue; // ch.path often already is one of the fallbacks
          attempted.push(cand);
          try {
            const candUrl = new URL(cand, baseUrl).toString();
            resp = await page.goto(candUrl, { waitUntil: 'networkidle', timeout: 20_000 });
          } catch {
            resp = null;
          }
          if (resp && resp.status() < 400) break;
          resp = null;
        }
        if (!resp) {
          findings.push({
            chapter: ch.n, rule: 'unreachable',
            message: `Chapter ${ch.n} (${ch.title}) was not reachable at any of the checked paths: ${attempted.join(', ')}.`,
            remedy: `Serve chapter ${ch.n} at exactly /chapter-${ch.n}/ (trailing slash) returning 200 with a root element carrying data-chapter="${ch.n}". Checked paths: ${attempted.join(', ')}.`,
          });
          continue;
        }

        // A chapter still carrying data-chapter-status="placeholder" is the
        // skeleton's stub, not finished work. Skip it — UNLESS the plan says it
        // was due, in which case the stub itself is the finding. That bound is
        // what stops the marker becoming a free pass: an agent that never
        // clears it still gets caught, just on the iteration it actually owed
        // the chapter.
        const isPlaceholder =
          (await page.locator(`[data-chapter="${ch.n}"][data-chapter-status="placeholder"]`).count()) > 0;
        if (isPlaceholder) {
          // No deadline supplied means we cannot justify skipping anything: an
          // unchecked chapter is indistinguishable from a passing one, so an
          // absent chaptersDue falls back to checking everything rather than
          // handing every placeholder a free pass.
          if (dueBy === 0 || ch.n <= dueBy) {
            findings.push({
              chapter: ch.n, rule: 'still-placeholder',
              message: `Chapter ${ch.n} (${ch.title}) was due by now but is still the skeleton placeholder.`,
              remedy: `Write chapter ${ch.n} in ${ch.path}: narrative, a kit visual, a control tagged data-lever="${ch.leverId}" driving data-outcome="${ch.outcomeId}", and a citation. Then remove data-chapter-status="placeholder" from its root element.`,
            });
          } else {
            notYetDue.push(ch.n);
          }
          continue;
        }

        // FIX (2026-08-10): every per-chapter assertion below is scoped to
        // THIS chapter's own element. They used to run against the whole
        // document, so a build that served one page for every /chapter-N/ URL
        // passed all seven checks on a single chapter's worth of content —
        // observed on build 5443df54, which shipped 7 identical 46KB pages and
        // a green gate. `root` is the scope; never use bare `page.locator` for
        // a per-chapter fact again.
        const root = page.locator(`[data-chapter="${ch.n}"]`);
        const marked = await root.count();
        if (marked === 0) {
          findings.push({
            chapter: ch.n, rule: 'unmarked',
            message: `Chapter ${ch.n} has no element with data-chapter="${ch.n}".`,
            remedy: `Put data-chapter="${ch.n}" on the chapter's root element in the file serving ${ch.path}.`,
          });
        }

        // Distinctness: on /chapter-N/ the reader should see chapter N, not
        // all of them stacked. A client-routed SPA that shows one at a time
        // passes; a single page dumping every chapter does not.
        // Count DISTINCT chapter numbers, not marked elements. Counting
        // elements calls a chapter whose wrapper and inner article both carry
        // data-chapter="3" two chapters — one chapter marked twice is untidy,
        // not the failure this rule is for, which is eight chapters stacked on
        // one page and served at every URL.
        const visibleChapters = await page
          .locator('[data-chapter]:visible')
          .evaluateAll((els) => new Set(els.map((e) => e.getAttribute('data-chapter'))).size);
        if (visibleChapters > 1) {
          findings.push({
            chapter: ch.n, rule: 'chapters-not-distinct',
            message: `Requesting ${ch.path} renders ${visibleChapters} chapters at once — every chapter URL is showing the same combined page.`,
            remedy: `Serve ${ch.path} as its own document containing only chapter ${ch.n}, or hide the other chapters when this route is active. A reader following the nav should land on one chapter.`,
          });
        }

        const visuals = await root.locator('canvas[data-scene], svg').count();
        sceneCount += await root.locator('canvas[data-scene]').count();

        // What shape is this chapter, and what does the reader touch? Read
        // from the DOM rather than the plan, because the plan is a statement
        // of intent and this is what actually shipped.
        formsSeen.push(
          (await page.locator('[data-form]').first().getAttribute('data-form').catch(() => null)) ?? 'none',
        );
        controlsSeen.push(
          await lever0Kind(root, ch.leverId),
        );
        if (visuals === 0) {
          findings.push({
            chapter: ch.n, rule: 'prose-only',
            message: `Chapter ${ch.n} (${ch.title}) renders no canvas or svg — it is prose.`,
            remedy: `Add a kit visual to ${ch.path}: Explainer.createDiagram for a mechanism, createScene for something spatial, createChart for a series. See ./explainer-kit/scenes.md.`,
          });
        }

        const lever = root.locator(`[data-lever="${ch.leverId}"]`).first();
        const outcome = root.locator(`[data-outcome="${ch.outcomeId}"]`).first();
        const haveLever = (await lever.count()) > 0;
        const haveOutcome = (await outcome.count()) > 0;
        if (!haveLever || !haveOutcome) {
          findings.push({
            chapter: ch.n, rule: 'no-model',
            message: `Chapter ${ch.n} is missing ${!haveLever ? `a control tagged data-lever="${ch.leverId}"` : ''}${!haveLever && !haveOutcome ? ' and ' : ''}${!haveOutcome ? `an element tagged data-outcome="${ch.outcomeId}"` : ''}.`,
            remedy: `Use Explainer.createSim in ${ch.path} with a lever id of "${ch.leverId}" and an outcome id of "${ch.outcomeId}". It tags both for you.`,
          });
        } else {
          const before = (await outcome.textContent()) ?? '';
          const tagName = await lever.evaluate((el) => el.tagName.toLowerCase());
          const inputType = tagName === 'input'
            ? (await lever.getAttribute('type') || 'text').toLowerCase()
            : null;

          // min/max ABSENT must not silently coerce to 0/0 — Number(null) is
          // 0, which is finite, so the old code's "fallback to '1' when
          // min/max are absent" branch was dead. Check presence explicitly.
          const minAttr = await lever.getAttribute('min');
          const maxAttr = await lever.getAttribute('max');
          const min = minAttr != null ? Number(minAttr) : null;
          const max = maxAttr != null ? Number(maxAttr) : null;
          const haveRange = min != null && max != null && Number.isFinite(min) && Number.isFinite(max);

          // Candidate values to drive the lever to, most-likely-to-work
          // first: 80% of range, then both extremes. A single point can land
          // in the same rounded/bucketed value as the start — sim.js's own
          // defaultFormat rounds every outcome to 0-2 decimal places — but
          // the endpoints are the values most likely to cross a boundary.
          // For a <select> (a discrete parameter, explicitly sanctioned by
          // sim.js's own doc comment for hand-rolled controls), every other
          // option is a candidate, capped at 5 to bound worst-case runtime
          // against the poll below.
          let candidates;
          if (tagName === 'select') {
            const options = await lever.evaluate((el) => Array.from(el.options).map((o) => o.value));
            const current = await lever.inputValue().catch(() => null);
            candidates = options.filter((v) => v !== current).slice(0, 5);
          } else if (haveRange) {
            candidates = [...new Set([min + (max - min) * 0.8, min, max])].map(String);
          } else {
            candidates = ['1'];
          }

          const setValue = async (val) => {
            if (tagName === 'select') {
              await lever.selectOption(String(val)).catch(() => {});
            } else if (tagName === 'input' && (inputType === 'range' || inputType === 'number')) {
              await lever.fill(String(val)).catch(async () => { await lever.click().catch(() => {}); });
            } else {
              // A segmented control, a stepper or a toggle carries data-lever
              // on the GROUP. Clicking the group hits whatever is under its
              // centre — often the option already selected, which changes
              // nothing and reads as an inert lever. Prefer a descendant
              // button that is not currently chosen and is not disabled.
              const notChosen = lever.locator(
                'button:not([aria-checked="true"]):not([aria-pressed="true"]):not(:disabled)',
              );
              if ((await notChosen.count().catch(() => 0)) > 0) {
                await notChosen.first().click({ timeout: 2000 }).catch(() => {});
              } else {
                await lever.click().catch(() => {});
              }
            }
            // A hand-rolled control may listen for 'change' rather than
            // 'input' — dispatch both rather than assume which.
            await lever.dispatchEvent('input').catch(() => {});
            await lever.dispatchEvent('change').catch(() => {});
          };

          // Poll rather than a fixed wait: re-read the outcome every 100ms
          // for up to 2000ms, stopping the moment it differs. Faster than a
          // fixed sleep in the common synchronous case, and tolerant of an
          // outcome that updates asynchronously and lands after the old
          // hardcoded 400ms.
          const pollForChange = async () => {
            const deadline = Date.now() + 2000;
            let last = before;
            while (Date.now() < deadline) {
              last = (await outcome.textContent()) ?? '';
              if (last.trim() !== before.trim()) return last;
              await page.waitForTimeout(100);
            }
            return last;
          };

          const tried = [];
          let changed = false;
          for (const val of candidates) {
            tried.push(val);
            await setValue(val);
            const after = await pollForChange();
            if (after.trim() !== before.trim()) { changed = true; break; }
          }

          // tried.length === 0 only for a <select> with no alternative
          // option to test — nothing to probe, so nothing to fail.
          if (!changed && tried.length > 0) {
            findings.push({
              chapter: ch.n, rule: 'inert-lever',
              message: `Chapter ${ch.n}: driving data-lever="${ch.leverId}" through ${tried.join(', ')} left data-outcome="${ch.outcomeId}" at "${before.trim().slice(0, 40)}" the whole time.`,
              remedy: `data-outcome="${ch.outcomeId}" in ${ch.path} showed no observable change while data-lever="${ch.leverId}" was driven through ${tried.join(', ')}. Either the model genuinely does not depend on this lever — wire step() so the outcome depends on it — or the outcome's display formatting (rounding, bucketing) is hiding a real change; show a value the check can observe moving.`,
            });
          }
        }

        // FIX 4 (2026-08-10): does the design system actually apply? The
        // orchestrator's design linter only runs when a workspace contains
        // .svelte files, and a studio build writes plain HTML — so it has
        // never run once, and enforceDesignSystem:true was decorative. Build
        // 5443df54 shipped with zero references to the kit's tokens. A runtime
        // read is unfakeable: if tokens.css is loaded, --ex-ink resolves.
        if (!designChecked) {
          designChecked = true;
          const inkToken = await page
            .evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ex-ink').trim())
            .catch(() => '');
          if (!inkToken) {
            findings.push({
              chapter: 0, rule: 'no-design-tokens',
              message: `The explainer kit's design tokens are not in effect — --ex-ink resolves to nothing on ${ch.path}.`,
              remedy: `Link the kit's tokens at the top of your stylesheet — copy explainer-kit/tokens.css into your project and reference it, or @import it — and build colours and fonts from var(--ex-*) instead of hard-coded values.`,
            });
          }
        }

        // FIX 2 (2026-08-10): the gate fetched the paths the PLAN declared and
        // never the ones the page actually links to. Build 5443df54 shipped a
        // nav containing the literal string /chapter-${number}/ — an
        // uninterpolated template that 404s — and the gate reported every
        // chapter reachable. Follow the real links.
        if (!linksChecked) {
          linksChecked = true;
          // Both href and src: a broken script/stylesheet URL is why a page
          // renders unstyled or without its 3D scene, and only checking anchors
          // missed exactly that on build 7c5f2ef2.
          const hrefs = await page
            .locator('a[href], link[href], script[src], img[src]')
            .evaluateAll((els) =>
              els.map((e) => e.getAttribute('href') || e.getAttribute('src') || ''),
            );
          // Root-absolute internal links are ALWAYS wrong here, even when they
          // resolve against the bare dev server. A human never sees that
          // server: the preview is served under /api/jkai/proxy/<id>/ and a
          // published build under /projects/<slug>/. Both inject or imply a
          // path prefix, and a <base href> — which is how the proxy makes
          // relative URLs work — has no effect on a path starting with "/".
          // So /chapter-2/ resolves to the SITE root and 404s. Observed
          // 2026-08-10: every chapter link in build 7dadc8f4 404'd for the
          // owner while the gate, testing 127.0.0.1 directly, saw them all 200.
          // Both surfaces inject <base href> pointing at the project root, so
          // ONLY a bare project-root-relative path works. A leading "/" escapes
          // to the site root; "../" climbs above the project root. Both 404,
          // and neither is visible when testing the bare dev server directly —
          // which is why build 7c5f2ef2 shipped with dead nav, no stylesheet
          // and no three.js while this gate reported every chapter fine.
          const badUrls = [...new Set(hrefs.filter((h) => h.startsWith('/') || h.startsWith('../')))];
          for (const href of badUrls.slice(0, 10)) {
            const why = href.startsWith('/')
              ? 'a leading slash escapes to the SITE root'
              : '"../" climbs ABOVE the project root, because <base href> already points there';
            findings.push({
              chapter: ch.n, rule: 'absolute-internal-link',
              message: `The page references ${href}, which will 404 for a human: ${why}.`,
              remedy: `In the page served at ${ch.path}, write it relative to the PROJECT ROOT with no leading slash and no "../" — e.g. "chapter-2/", "styles.css", "assets/three.min.js". Both the preview proxy and /projects/<slug>/ inject a <base href> at the project root, so that form is the only one that resolves on both.`,
            });
          }
          // Every internal reference, not just the malformed ones: a
          // correctly-relative link can still point at a page that does not
          // exist. Deduped and bounded — no crawling.
          const internal = [...new Set(hrefs.filter((h) => h && !/^[a-z]+:/i.test(h) && !h.startsWith('#')))].slice(0, 25);
          for (const href of internal) {
            let status = 0;
            try {
              const r = await fetch(new URL(href, baseUrl).toString(), { redirect: 'follow' });
              status = r.status;
            } catch {
              status = 0;
            }
            if (status === 0 || status >= 400) {
              findings.push({
                chapter: ch.n, rule: 'broken-link',
                message: `The page links to ${href}, which returns ${status || 'no response'}.`,
                remedy: `Fix or remove the link to ${href} in the page served at ${ch.path}. If it came from a template, check the value was interpolated rather than emitted literally.`,
              });
            }
          }
        }

        const citations = await root.locator('a[data-citation]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('href') || ''),
        );
        const good = citations.filter((href) => {
          try { return sourceHosts.has(new URL(href).host); } catch { return false; }
        });
        if (good.length === 0) {
          findings.push({
            chapter: ch.n, rule: 'uncited',
            message: `Chapter ${ch.n} has ${citations.length} citation link(s), none pointing at a source from the research brief.`,
            remedy: `Add <a data-citation href="..."> in ${ch.path} linking to one of the FACT source URLs in the brief.`,
          });
        }
      } catch (e) {
        findings.push({
          chapter: ch.n, rule: 'errored',
          message: `Chapter ${ch.n} threw while being checked: ${firstLine(e?.message ?? e)}`,
          remedy: `Open ${ch.path} in a browser and fix the runtime error before adding more chapters.`,
        });
      } finally {
        await page?.close().catch(() => {});
      }
    }
    // Visual variety. scenes.md offers four modes and a build kept defaulting
    // to diagrams for all eight chapters (7dadc8f4: 0 scenes, 0 charts). One
    // mode everywhere is a weaker artefact than the kit is capable of, and the
    // low-poly scene in particular is the register this format exists for.
    if (chapters.length >= 5 && sceneCount === 0 && dueBy >= chapters.length) {
      findings.push({
        chapter: 0, rule: 'no-scene',
        message: `All ${chapters.length} chapters use flat diagrams or charts — not one uses the low-poly scene.`,
        remedy: `Give at least one chapter an Explainer.createScene tile grid. It suits any quantity that varies across a SET, not just geography — one tile per source, claim, year or category, height for magnitude and colour for a second variable. See ./explainer-kit/scenes.md.`,
      });
    }
    // Only judge variety once the build has actually delivered enough
    // chapters for sameness to be a choice rather than a coincidence.
    const delivered = formsSeen.length;
    if (delivered >= 4 && dueBy >= chapters.length) {
      const distinctForms = new Set(formsSeen.filter((f) => f && f !== 'none')).size;
      if (distinctForms <= 1) {
        findings.push({
          chapter: 0, rule: 'same-form',
          message: `All ${delivered} chapters are told in the same shape (${formsSeen[0]}) — the explainer has no editorial flow.`,
          remedy: `Vary the Form column in the chapter spine and pass it to Explainer.mountShell({ form }). Use at least three of: open, question, walk, compare, annotate, ledger, close — chosen from what each chapter is doing, never the same one twice in a row.`,
        });
      }
      const distinctControls = new Set(controlsSeen.filter(Boolean)).size;
      if (distinctControls <= 1 && controlsSeen[0]) {
        findings.push({
          chapter: 0, rule: 'same-control',
          message: `Every chapter's lever is the same kind of control (${controlsSeen[0]}) — the reader does the same thing ${delivered} times.`,
          remedy: `Pass a "kind" to each createSim lever. Use choice (segmented buttons) whenever the parameter is a SET of things, toggle for a single assumption, step to walk a sequence, and slider ONLY for a continuous quantity like money or people.`,
        });
      }
    }
    out = { ran: true, passed: findings.length === 0, findings, notYetDue };
  } catch (e) {
    out = { ran: false, reason: `the gate harness failed: ${e.message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

// Run only when invoked as a script, so a test can import injectBaseHref
// without starting a browser and consuming stdin.
//
// If this guard ever mis-fires the script prints nothing, which the caller
// already reports as `ran: false, reason: "the studio gate printed nothing"` —
// a visible skip, never a silent pass. Verified by running the real script
// against a real snapshot after the change, not by reading it.
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((e) => { out = { ran: false, reason: `unexpected: ${e.message}` }; })
    .finally(() => { process.stdout.write(JSON.stringify(out) + '\n'); });
}
