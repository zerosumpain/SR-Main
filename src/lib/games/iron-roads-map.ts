// Iron Roads: Darlington Edition — the map, as plain data (no rules here).
//
// Real towns of the North East and North Yorkshire, Darlington at the heart,
// placed roughly where they sit on the ground in a 1000 × 560 box (north up),
// nudged apart where Teesside would otherwise crowd its labels. Single routes
// only, length 1–5, a card colour or grey (any one colour). The TV board,
// the phone and the rules all read this one module, so it stays pure.

export const CARD_COLOURS = ['red', 'blue', 'green', 'yellow', 'black', 'white'] as const;
export type CardColour = (typeof CARD_COLOURS)[number];
export type RouteColour = CardColour | 'grey';

export const MAP_W = 1000;
export const MAP_H = 560;

export interface Town {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Which side of the dot the name sits. */
  label: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
}

export interface Route {
  id: string;
  a: string;
  b: string;
  length: number;
  colour: RouteColour;
}

export interface Ticket {
  id: number;
  a: string;
  b: string;
  points: number;
  /** A line about the day out at the far end. */
  line: string;
}

export const TOWNS: readonly Town[] = [
  { id: 'hexham', name: 'Hexham', x: 70, y: 45, label: 'n' },
  { id: 'newcastle', name: 'Newcastle', x: 345, y: 25, label: 'e' },
  { id: 'sunderland', name: 'Sunderland', x: 560, y: 72, label: 'e' },
  { id: 'consett', name: 'Consett', x: 195, y: 144, label: 'w' },
  { id: 'durham', name: 'Durham', x: 400, y: 160, label: 'e' },
  { id: 'crook', name: 'Crook', x: 250, y: 248, label: 'w' },
  { id: 'hartlepool', name: 'Hartlepool', x: 690, y: 193, label: 'e' },
  { id: 'sedgefield', name: 'Sedgefield', x: 520, y: 254, label: 'ne' },
  { id: 'bishop', name: 'Bishop Auckland', x: 300, y: 320, label: 's' },
  { id: 'shildon', name: 'Shildon', x: 395, y: 320, label: 'e' },
  { id: 'barnard', name: 'Barnard Castle', x: 135, y: 402, label: 'sw' },
  { id: 'darlington', name: 'Darlington', x: 425, y: 413, label: 'sw' },
  { id: 'stockton', name: 'Stockton', x: 590, y: 342, label: 'se' },
  { id: 'middlesbrough', name: 'Middlesbrough', x: 705, y: 314, label: 'e' },
  { id: 'redcar', name: 'Redcar', x: 820, y: 256, label: 'ne' },
  { id: 'saltburn', name: 'Saltburn', x: 915, y: 298, label: 'e' },
  { id: 'guisborough', name: 'Guisborough', x: 820, y: 380, label: 'e' },
  { id: 'yarm', name: 'Yarm', x: 575, y: 446, label: 's' },
  { id: 'stokesley', name: 'Stokesley', x: 715, y: 463, label: 'se' },
  { id: 'whitby', name: 'Whitby', x: 950, y: 463, label: 's' },
  { id: 'richmond', name: 'Richmond', x: 270, y: 485, label: 'w' },
  { id: 'northallerton', name: 'Northallerton', x: 490, y: 518, label: 's' },
  { id: 'thirsk', name: 'Thirsk', x: 630, y: 551, label: 'e' },
];

export const HEART = 'darlington';

const r = (a: string, b: string, length: number, colour: RouteColour): Route => ({ id: `${a}-${b}`, a, b, length, colour });

export const ROUTES: readonly Route[] = [
  // The Tyne and the north
  r('hexham', 'newcastle', 4, 'green'),
  r('hexham', 'consett', 2, 'grey'),
  r('hexham', 'barnard', 5, 'black'),
  r('newcastle', 'sunderland', 3, 'red'),
  r('newcastle', 'consett', 3, 'yellow'),
  r('newcastle', 'durham', 2, 'blue'),
  r('sunderland', 'durham', 3, 'white'),
  r('sunderland', 'hartlepool', 3, 'grey'),
  r('consett', 'durham', 3, 'grey'),
  r('consett', 'crook', 2, 'red'),
  r('durham', 'crook', 3, 'black'),
  r('durham', 'sedgefield', 2, 'yellow'),
  r('durham', 'shildon', 3, 'green'),
  // Weardale and Teesdale
  r('crook', 'bishop', 1, 'white'),
  r('crook', 'barnard', 3, 'blue'),
  r('bishop', 'barnard', 3, 'green'),
  r('bishop', 'shildon', 2, 'grey'),
  r('barnard', 'richmond', 3, 'yellow'),
  // The 1825 line: Shildon – Darlington – Stockton, the Stockton & Darlington
  // Railway, the first public railway to run steam. It is the heart of the map.
  r('shildon', 'darlington', 2, 'red'),
  r('darlington', 'stockton', 3, 'yellow'),
  // Darlington's other roads out
  r('darlington', 'barnard', 5, 'white'),
  r('darlington', 'sedgefield', 3, 'green'),
  r('darlington', 'yarm', 2, 'grey'),
  r('darlington', 'richmond', 3, 'black'),
  r('darlington', 'northallerton', 2, 'blue'),
  // Teesside and the coast
  r('shildon', 'sedgefield', 2, 'white'),
  r('sedgefield', 'hartlepool', 3, 'red'),
  r('sedgefield', 'stockton', 2, 'grey'),
  r('hartlepool', 'stockton', 3, 'blue'),
  r('hartlepool', 'redcar', 2, 'black'),
  r('stockton', 'middlesbrough', 2, 'grey'),
  r('stockton', 'yarm', 2, 'green'),
  r('middlesbrough', 'redcar', 2, 'yellow'),
  r('middlesbrough', 'guisborough', 2, 'red'),
  r('middlesbrough', 'stokesley', 3, 'white'),
  r('redcar', 'saltburn', 2, 'blue'),
  r('saltburn', 'guisborough', 2, 'grey'),
  r('saltburn', 'whitby', 3, 'green'),
  r('guisborough', 'whitby', 3, 'black'),
  r('guisborough', 'stokesley', 2, 'grey'),
  r('stokesley', 'whitby', 5, 'yellow'),
  // North Yorkshire
  r('yarm', 'stokesley', 3, 'black'),
  r('yarm', 'northallerton', 2, 'red'),
  r('stokesley', 'thirsk', 3, 'blue'),
  r('northallerton', 'thirsk', 3, 'white'),
  r('richmond', 'northallerton', 4, 'green'),
];

/** The shortest way between two towns, in trains. */
export function shortestTrains(a: string, b: string): number {
  const dist = new Map<string, number>(TOWNS.map((t) => [t.id, Infinity]));
  dist.set(a, 0);
  const open = new Set(TOWNS.map((t) => t.id));
  while (open.size) {
    let at: string | null = null;
    for (const id of open) if (at === null || dist.get(id)! < dist.get(at)!) at = id;
    if (at === null || dist.get(at) === Infinity) break;
    open.delete(at);
    if (at === b) break;
    for (const rt of ROUTES) {
      const other = rt.a === at ? rt.b : rt.b === at ? rt.a : null;
      if (!other || !open.has(other)) continue;
      const d = dist.get(at)! + rt.length;
      if (d < dist.get(other)!) dist.set(other, d);
    }
  }
  return dist.get(b) ?? Infinity;
}

/** A ticket's worth: the trains it takes at best, kept between 4 and 20. */
export const ticketPoints = (a: string, b: string): number => Math.max(4, Math.min(20, shortestTrains(a, b)));

const TICKET_LINES: [string, string, string][] = [
  ['darlington', 'whitby', 'Fish and chips on the harbour wall, with a gull eyeing every chip.'],
  ['newcastle', 'darlington', 'Up the main line for a wander along the Quayside and back for tea.'],
  ['hexham', 'whitby', 'Abbey to abbey, the whole of the North East in a day. Bring a flask.'],
  ['barnard', 'saltburn', 'From the castle walls to the end of the pier, and down on the cliff lift.'],
  ['durham', 'stockton', 'The cathedral in the morning and the longest high street in the afternoon.'],
  ['shildon', 'middlesbrough', 'Where the engines started out, to watch the Transporter Bridge carry the cars.'],
  ['richmond', 'hartlepool', 'Cobbles first, then the old ships at the marina by teatime.'],
  ['sunderland', 'yarm', 'A blowy walk on Roker beach, then under the viaduct for a warm-up.'],
  ['bishop', 'redcar', 'From the castle grounds to a day on Redcar sands.'],
  ['consett', 'darlington', 'Down the Derwent Walk and on to the Head of Steam to see Locomotion.'],
  ['crook', 'thirsk', 'Off the edge of Weardale and down to the market square for a pie.'],
  ['thirsk', 'newcastle', 'A day at the races swapped for a day under the bridges.'],
  ['northallerton', 'durham', 'Market day, then the climb up to the cathedral.'],
  ['sedgefield', 'whitby', 'Up the 199 steps and back down again before the rain.'],
  ['guisborough', 'hexham', 'A forest walk at one end and a cream tea at the other.'],
  ['stokesley', 'sunderland', 'Ducks on the Leven, then a paddle in the North Sea.'],
  ['yarm', 'barnard', 'Two market towns and the silver swan at the Bowes Museum.'],
  ['darlington', 'saltburn', 'A day at the seaside, the way we always did it, by train.'],
  ['darlington', 'hexham', 'Over the hills for a look round the abbey and a scone.'],
  ['hartlepool', 'thirsk', 'Sea air in the morning, a market square in the afternoon.'],
  ['stockton', 'richmond', 'Up into Swaledale for the falls and an ice cream.'],
  ['middlesbrough', 'northallerton', 'A parmo for lunch and a brew on the high street after.'],
  ['redcar', 'durham', 'Off the beach and on to the river for a go in a rowing boat.'],
  ['consett', 'guisborough', 'Steel town to Roseberry Topping, if the legs hold out.'],
  ['shildon', 'stockton', 'The first passenger run, give or take two hundred years.'],
  ['crook', 'whitby', 'The long way to the coast, and worth every stop.'],
];

export const TICKETS: readonly Ticket[] = TICKET_LINES.map(([a, b, line], i) => ({ id: i + 1, a, b, points: ticketPoints(a, b), line }));

const TOWN_BY_ID = new Map(TOWNS.map((t) => [t.id, t]));
const ROUTE_BY_ID = new Map(ROUTES.map((rt) => [rt.id, rt]));
const TICKET_BY_ID = new Map(TICKETS.map((t) => [t.id, t]));

export const town = (id: string): Town | undefined => TOWN_BY_ID.get(id);
export const route = (id: string): Route | undefined => ROUTE_BY_ID.get(id);
export const ticket = (id: number): Ticket | undefined => TICKET_BY_ID.get(id);
export const townName = (id: string): string => TOWN_BY_ID.get(id)?.name ?? id;
export const routeName = (rt: Pick<Route, 'a' | 'b'>): string => `${townName(rt.a)} – ${townName(rt.b)}`;
export const ticketName = (t: Pick<Ticket, 'a' | 'b'>): string => `${townName(t.a)} – ${townName(t.b)}`;

/** Points for claiming a route of each length (index = length). */
export const ROUTE_POINTS = [0, 1, 2, 4, 7, 10, 15] as const;
