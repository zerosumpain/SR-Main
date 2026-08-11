---
name: explainer-kit
description: Build a multi-chapter interactive explainer using the Strange Ramblings house style — mounted chrome, SVG instruments, low-poly scenes and a self-check you run before saying a chapter is done. Use for any jkai Studio build.
---

# The explainer kit

You are building a publication, not a slide deck and not an essay. A reader
should be able to land on any chapter, see immediately what is being shown,
touch one control, and watch a number move.

`--skill` loaded nothing before this file existed: pi's loader returns null
without a `description` in the frontmatter, and the kit had none. So the
guidance below has never actually reached a build.

## Order of work, per chapter

1. **Mount the chrome. Do not author it.** `Explainer.mountShell({...})` gives
   you the header, the chapter nav, the heading and prev/next, already on
   brand. Hand-rolled nav is how earlier builds shipped dead links.
2. **Pick the visual from the concept, not from novelty.** A process is
   `createSteps`. A composition is `createStackBar`. A proportion is
   `createIconArray`. A quantity across a set is `createScene`. Reaching for
   the 3D scene to draw nine boxes is the most common wrong answer here — both
   pages this style comes from contain zero WebGL.
3. **Put it in an instrument.** `createInstrument` gives every visual the same
   frame: label, title, a line saying what is plotted, the control, the visual,
   then at most one sentence of payoff underneath.
4. **Wire one lever to one outcome** with `createSim`, using the ids from the
   chapter spine. A chapter with no working control is not finished.
5. **Cite.** At least one `<a data-citation href="...">` pointing at a source
   URL from the research brief.
6. **Look at it.** Run the checker named in your system prompt. Fix what it
   says. Run it again. It is the same code that scores the build, so a chapter
   that passes there passes everywhere.

## Rules that are not stylistic

- **URLs are project-root-relative.** `styles.css`, `chapter-2/`,
  `assets/three.min.js`. Never a leading slash, never `../`. Both surfaces a
  reader reaches inject a `<base href>` at the project root.
- **Colours come from `--ex-*` tokens.** Raw hex belongs in `tokens.css` and
  nowhere else. The fonts load from `tokens.css`; import it first or the page
  renders in whatever the reader happens to have installed.
- **Never edit the mount.** `explainer-kit/` is regenerated every iteration
  and your edits there are discarded. Copy what you need into your own tree.
- **Numbers come from the brief.** A generated illustration must never carry a
  quantity, and neither must you invent one to make a chart look fuller.

## Read next

- `api.md` — every signature.
- `scenes.md` — which visual mode suits which concept.
- `examples/chapter.html` — a complete chapter to copy.
