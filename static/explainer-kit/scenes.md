# Scene grammar — which mode for which concept

Pick per chapter, not per project. A good project usually uses three of the four.

| The concept is… | Use | Why |
|---|---|---|
| A system where a few inputs drive an outcome through named mechanisms | `createSim` + `createDiagram` | The diagram shows the causal path; the levers let the learner feel it. This is the default for a policy or process. |
| **Any quantity that varies across a SET of things** — sources, claims, years, categories, cohorts, regions | `createScene` | This is the SimCity register and it is far broader than maps. One tile per item, height for magnitude, colour for a second variable. Ten sources with different credibility? A tile grid. Eight claims with different evidential weight? A tile grid. It does not need to be geography — it needs a set and a number. |
| A quantity changing over time, or a comparison across categories | `createChart` | Do not build a 3D scene for a time series. |
| A sequence of stages with gates, queues or dropout between them | `createDiagram` with `kind: 'mechanism'` nodes and weighted edges | Edge weight carries the flow; `setWeight` animates it as a lever moves. |

## Reach for the scene more often than feels natural

The commonest failure of this kit is a project where every chapter is a flat
diagram. Diagrams are the safe default and they make a monotonous artefact. If a
chapter involves more than about five of anything with a number attached, the
tile grid will almost always read better than a bar chart and far better than
prose — it is the one visual here that makes quantity *physical*.

A build of five or more chapters with no scene at all is flagged by the checker.

## Anti-patterns

- **A scene for the sake of a scene.** If height and colour carry nothing, use a chart.
- **A diagram that just restates the nav.** Boxes named after your own chapters teach nothing.
- **Levers with no consequence.** A slider that changes a number nobody explained is decoration. Every lever must move an outcome the chapter has already given meaning to.
- **Six charts in a row.** One idea per chapter.

## Sequencing chapters

Order chapters so each one can only be understood after the last. Aim for 6–10.
A workable spine: what the thing is → what drives it → the mechanism in the
middle → what happens when you push it → where it breaks → what is actually
uncertain. The last chapter should name the gaps from the research brief
honestly rather than closing on false confidence.
