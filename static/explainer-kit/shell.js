/**
 * shell.js — the project chrome. Mount it; do not author it.
 *
 * Every explainer gets the same header, the same two-level navigation, the
 * same chapter heading and the same footer, because a reader landing on any
 * chapter should know instantly where they are and what else exists. That
 * consistency is the point of a house style, and it is not something worth
 * re-inventing per build — earlier builds spent iterations hand-rolling nav
 * that then 404'd, while the gate had nothing to say about it.
 *
 * Modelled on the Engine Room's SectionNav: a sticky bar with the project
 * mark, a row of chapter tabs that collapses to a menu on narrow screens, and
 * a progress readout. Same fonts, same petrol accent, same pill tabs.
 *
 * URLS: every link is written PROJECT-ROOT-RELATIVE with no leading slash and
 * no "../". Both surfaces a reader reaches inject a <base href> at the project
 * root, so that is the only form which resolves on both. A leading slash
 * escapes to the site root and 404s. This is the single most common way a
 * build has shipped dead navigation.
 *
 * Usage, once per chapter page, after the DOM exists:
 *
 *   Explainer.mountShell({
 *     project: 'How school funding actually works',
 *     chapters: [ { n: 1, title: 'The Record Room' }, … ],
 *     current: 3,
 *     kicker: 'supplied public record',        // optional, above the title
 *     lede: 'One sentence framing the chapter.' // optional
 *   });
 *
 * It writes the header and chapter heading into <body> (prepended) and the
 * footer at the end, so your own content needs no wrapper. Returns the
 * <main class="ex-chapter"> element your visuals should mount inside.
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Project-root-relative, never absolute. See the URLS note above. */
  function chapterHref(n) {
    return `chapter-${n}/`;
  }

  /**
   * The editorial shapes a chapter can take.
   *
   * Every chapter of every build came out structurally identical — seven
   * chapters, seven times `article > h2 > h2` — because the plan had no word
   * for HOW a chapter is told, only what it is about and which ids the checker
   * would hunt for. A vocabulary with no term for variety produces none.
   *
   * Each form is a real arrangement, not a class name: it changes the order of
   * the heading, the visual and the prose, and what the chapter opens with.
   * Modelled on the Engine Room, where every leaf shares a frame and differs
   * in its centrepiece.
   */
  const FORMS = {
    // Visual first, at full width, then the claim it supports. For opening a
    // part, or any chapter whose picture IS the argument.
    open: { visualFirst: true, wide: true },
    // Question as the heading; evidence; then a bounded answer.
    question: { questionHead: true },
    // Numbered movements, each its own small section.
    walk: { numbered: true },
    // Two columns: this against that.
    compare: { split: true },
    // One artefact, held wide, with the reading notes beside it.
    annotate: { wide: true, aside: true },
    // A list of items, each with its own small visual.
    ledger: { list: true },
    // What is established, and what is not. For closing.
    close: { terse: true },
  };

  ns.CHAPTER_FORMS = Object.keys(FORMS);

  ns.mountShell = function mountShell(spec) {
    const chapters = Array.isArray(spec && spec.chapters) ? spec.chapters : [];
    const current = Number(spec && spec.current) || 0;
    const project = (spec && spec.project) || document.title || 'Explainer';
    if (chapters.length === 0) {
      // Loud rather than silent: a shell with no chapters is a build that has
      // not passed its spine in, and the reader would get a nav bar with
      // nothing in it.
      console.error('[explainer-kit] mountShell called with no chapters — nav will be empty.');
    }

    const here = chapters.find((c) => Number(c.n) === current) || null;

    // --- header -------------------------------------------------------------
    const header = el('header', 'ex-top');

    const bar = el('div', 'ex-bar');
    const brand = el('a', 'ex-brand');
    brand.href = './';
    brand.textContent = project;
    brand.title = 'Back to the contents';
    bar.appendChild(brand);

    const prog = el('span', 'ex-prog');
    prog.textContent = here ? `${current} / ${chapters.length}` : `${chapters.length} chapters`;
    bar.appendChild(prog);
    header.appendChild(bar);

    const nav = el('nav', 'ex-nav');
    nav.setAttribute('aria-label', 'Chapters');
    for (const c of chapters) {
      const a = el('a', 'ex-tab');
      a.href = chapterHref(c.n);
      if (Number(c.n) === current) {
        a.classList.add('is-here');
        a.setAttribute('aria-current', 'page');
      }
      a.appendChild(el('span', 'ex-tab-n', String(c.n)));
      // The title goes in its own span so it can be truncated. text-overflow
      // does not apply to a flex container, so putting the ellipsis on the tab
      // itself clipped long chapter names mid-word with no ellipsis at all.
      a.appendChild(el('span', 'ex-tab-t', c.title || `Chapter ${c.n}`));
      a.title = c.title || `Chapter ${c.n}`;
      nav.appendChild(a);
    }
    header.appendChild(nav);

    // The same list again as a disclosure, for narrow screens. CSS decides
    // which of the two is visible; both are always in the DOM so the gate's
    // link check sees every chapter link either way.
    const menu = el('details', 'ex-menu');
    const summary = el('summary', 'ex-menu-sum', here ? here.title : 'Chapters');
    menu.appendChild(summary);
    const menuList = el('nav', 'ex-menu-list');
    menuList.setAttribute('aria-label', 'All chapters');
    for (const c of chapters) {
      const a = el('a', 'ex-menu-item');
      a.href = chapterHref(c.n);
      if (Number(c.n) === current) a.classList.add('is-here');
      a.textContent = `${c.n} · ${c.title || ''}`.trim();
      menuList.appendChild(a);
    }
    menu.appendChild(menuList);
    header.appendChild(menu);

    document.body.insertBefore(header, document.body.firstChild);

    // --- chapter heading ----------------------------------------------------
    let main = document.querySelector('main.ex-chapter');
    if (!main) {
      main = el('main', 'ex-chapter');
      // The chapter contract's first clause, set here so no page can forget
      // it. The checker scopes every test to `[data-chapter="<n>"]`, so a
      // chapter missing this attribute scores zero on everything it contains
      // — a visual, a lever and a citation all present, and none of them
      // counted.
      //
      // Only when the page has not marked itself. Setting it unconditionally
      // put the attribute on BOTH this wrapper and the author's own element,
      // and the distinctness check reads two marked elements as two chapters
      // stacked on one page.
      if (current > 0 && !document.querySelector('[data-chapter]')) {
        main.setAttribute('data-chapter', String(current));
      }
      // Adopt whatever the page already wrote, so a chapter can be plain HTML
      // in <body> and still land inside the shell's measure.
      const orphans = [];
      for (const node of Array.from(document.body.childNodes)) {
        if (node === header) continue;
        if (node.nodeType === 1 && node.classList && node.classList.contains('ex-foot')) continue;
        orphans.push(node);
      }
      document.body.appendChild(main);
      for (const node of orphans) main.appendChild(node);
    }
    // The form drives the arrangement. An unknown or absent form falls back to
    // `question`, which is the plainest shape, rather than silently producing
    // the old identical one.
    const formName = FORMS[spec.form] ? spec.form : here ? 'question' : null;
    const form = formName ? FORMS[formName] : null;
    if (formName) {
      main.classList.add('ex-form-' + formName);
      main.setAttribute('data-form', formName);
    }

    if (here || spec.kicker || spec.lede) {
      const head = el('div', 'ex-chap-head');
      const kick = el('p', 'ex-kicker');
      kick.textContent = here
        ? `Chapter ${current} of ${chapters.length}${spec.kicker ? ` · ${spec.kicker}` : ''}`
        : spec.kicker || '';
      head.appendChild(kick);
      if (here) {
        const h1 = el('h1', 'ex-h1', here.title);
        // A question chapter asks its title. Marked in the DOM as well as
        // styled, so the checker can tell the forms apart.
        if (form && form.questionHead) h1.setAttribute('data-ask', 'true');
        head.appendChild(h1);
      }
      if (spec.lede) head.appendChild(el('p', 'ex-lede', spec.lede));

      // `open` puts the visual above the words. Everything else keeps the
      // heading first.
      if (form && form.visualFirst) {
        const stage = el('div', 'ex-stage');
        stage.id = spec.stageId || 'ex-stage';
        main.insertBefore(head, main.firstChild);
        main.insertBefore(stage, main.firstChild);
      } else {
        main.insertBefore(head, main.firstChild);
      }
    }

    // Structural affordances, created HERE rather than described in the prompt.
    //
    // `compare` and `ledger` are arrangements the CSS cannot produce from
    // plain prose — they need a container. Asking the agent to write the right
    // wrapper is persuasion, and persuasion is what produced seven identical
    // chapters in the first place. So the shell makes the container and hands
    // it over; the agent only has to put things in it.
    if (form && form.split) {
      const split = el('div', 'ex-split');
      const left = el('div', 'ex-side');
      const right = el('div', 'ex-side');
      left.id = 'ex-left';
      right.id = 'ex-right';
      split.append(left, right);
      main.appendChild(split);
    }
    if (form && form.list) {
      const list = el('div', 'ex-ledger');
      list.id = 'ex-ledger';
      main.appendChild(list);
    }
    if (form && form.aside) {
      const aside = el('div', 'ex-aside');
      aside.id = 'ex-aside';
      main.appendChild(aside);
    }

    // --- footer: previous / next -------------------------------------------
    const foot = el('footer', 'ex-foot');
    const idx = chapters.findIndex((c) => Number(c.n) === current);
    const prev = idx > 0 ? chapters[idx - 1] : null;
    const next = idx !== -1 && idx < chapters.length - 1 ? chapters[idx + 1] : null;

    if (prev) {
      const a = el('a', 'ex-step ex-step-prev');
      a.href = chapterHref(prev.n);
      a.appendChild(el('span', 'ex-step-lab', 'Previous'));
      a.appendChild(el('span', 'ex-step-t', prev.title || `Chapter ${prev.n}`));
      foot.appendChild(a);
    }
    if (next) {
      const a = el('a', 'ex-step ex-step-next');
      a.href = chapterHref(next.n);
      a.appendChild(el('span', 'ex-step-lab', 'Next'));
      a.appendChild(el('span', 'ex-step-t', next.title || `Chapter ${next.n}`));
      foot.appendChild(a);
    }
    document.body.appendChild(foot);

    return main;
  };

  /**
   * Add one row to a `ledger` chapter: a heading, a line, and a slot for its
   * own small visual. Returns the slot.
   */
  ns.addLedgerEntry = function addLedgerEntry(spec) {
    const list = document.querySelector('#ex-ledger');
    if (!list) {
      console.error('[explainer-kit] addLedgerEntry: no #ex-ledger — is this chapter form "ledger"?');
      return null;
    }
    const row = el('div', 'ex-entry');
    const words = el('div');
    words.appendChild(el('h3', null, spec.title || ''));
    if (spec.note) words.appendChild(el('p', null, spec.note));
    const slot = el('div', 'ex-entry-viz');
    row.append(words, slot);
    list.appendChild(row);
    return slot;
  };

  /**
   * The contents page. Same chrome, a list of chapters instead of one.
   * Call from index.html with the same chapters array.
   */
  ns.mountContents = function mountContents(spec) {
    const chapters = Array.isArray(spec && spec.chapters) ? spec.chapters : [];
    const main = ns.mountShell({ ...spec, current: 0 });
    const list = el('ol', 'ex-toc');
    for (const c of chapters) {
      const li = el('li', 'ex-toc-item');
      const a = el('a', 'ex-toc-link');
      a.href = chapterHref(c.n);
      a.appendChild(el('span', 'ex-toc-n', String(c.n)));
      a.appendChild(el('span', 'ex-toc-t', c.title || `Chapter ${c.n}`));
      if (c.blurb) a.appendChild(el('span', 'ex-toc-b', c.blurb));
      li.appendChild(a);
      list.appendChild(li);
    }
    main.appendChild(list);
    return main;
  };
})();
