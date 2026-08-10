# Scene grammar — which mode for which concept

Pick per chapter, not per project. A good project usually uses three of the four.

| The concept is… | Use | Why |
|---|---|---|
| A system where a few inputs drive an outcome through named mechanisms | `createSim` + `createDiagram` | The diagram shows the causal path; the levers let the learner feel it. This is the default for a policy or process. |
| Spatially distributed, or about density, allocation and place | `createScene` | Extruded tiles read as quantity-in-place instantly. This is the SimCity register: one variable as height, one as colour. |
| A quantity changing over time, or a comparison across categories | `createChart` | Do not build a 3D scene for a time series. |
| A sequence of stages with gates, queues or dropout between them | `createDiagram` with `kind: 'mechanism'` nodes and weighted edges | Edge weight carries the flow; `setWeight` animates it as a lever moves. |

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
