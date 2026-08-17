// The programme, the snag list and the handover pack — the parts of the job
// that are the same whoever builds it.

export type JobSize = 'simple' | 'standard' | 'complex';

/** [label, trade lane 1–5, first day, last day] */
export type Lane = [string, number, number, number];

export const LANES: Record<JobSize, Lane[]> = {
  simple: [
    ['Strip out', 1, 1, 1],
    ['First fix — plumbing', 1, 2, 2],
    ['First fix — electrics', 2, 2, 2],
    ['Board and plaster', 3, 3, 3],
    ['Tiling and grout', 4, 4, 5],
    ['Second fix', 1, 6, 6],
    ['Silicone, test, clean', 1, 7, 7],
    ['You: snag and sign off', 5, 7, 7],
  ],
  standard: [
    ['Strip out', 1, 1, 1],
    ['First fix — plumbing', 1, 2, 3],
    ['First fix — electrics', 2, 3, 3],
    ['Board, tank and plaster', 3, 4, 4],
    ['Drying out', 3, 5, 5],
    ['Tiling and grout', 4, 5, 7],
    ['Second fix', 1, 8, 9],
    ['Electrics second fix', 2, 9, 9],
    ['Silicone, test, clean', 1, 9, 9],
    ['You: snag and sign off', 5, 10, 10],
  ],
  complex: [
    ['Strip out', 1, 1, 2],
    ['First fix — plumbing and waste', 1, 3, 4],
    ['First fix — electrics', 2, 4, 4],
    ['Board, tank and plaster', 3, 5, 6],
    ['Drying out', 3, 7, 7],
    ['Tiling and grout', 4, 7, 10],
    ['Second fix', 1, 11, 12],
    ['Electrics second fix', 2, 12, 12],
    ['Silicone, test, clean', 1, 13, 13],
    ['You: snag and sign off', 5, 14, 14],
  ],
};

export const LANE_LEN: Record<JobSize, number> = { simple: 7, standard: 10, complex: 14 };

export const JOB_SIZES: { key: JobSize; label: string }[] = [
  { key: 'simple', label: 'Like-for-like, same layout' },
  { key: 'standard', label: 'Standard refit, minor moves' },
  { key: 'complex', label: 'Moved services / wet room' },
];

/** Lane colours reuse the cost bands so a trade reads the same everywhere. */
export const LANE_COLOUR: Record<number, string> = {
  1: 'var(--accent-ink)',
  2: 'var(--accent)',
  3: '#8a2d3a',
  4: '#2d7a3a',
  5: '#b0892a',
};

export const SNAGS: [string, string[]][] = [
  [
    'Water, waste and pressure',
    [
      'Run every tap hot and cold for two minutes — steady flow, no air, no knocking pipes',
      'Fill the bath to the overflow and check the overflow actually works',
      'Empty a full bath and watch for slow drainage or gurgling elsewhere',
      'Shower run for five minutes — temperature holds when a tap is turned on elsewhere',
      'Flush the WC ten times; check the fill is quiet and stops cleanly',
      "Check under the basin and behind the WC with a torch and dry tissue after everything's been run",
      'Look at the ceiling below the bathroom the morning after first use',
      'Bath and shower waste traps are accessible for cleaning',
      'Isolation valves fitted and reachable on basin, WC and shower',
      'No drips from any compression joint after 24 hours',
    ],
  ],
  [
    'Tiling and grout',
    [
      'Stand at the door: are the tile courses level and the verticals plumb?',
      'Cuts land in the corners and at the edges, not in the middle of the main wall',
      'No lippage — run a flat hand over the joins, nothing catches',
      'Grout lines are even width throughout and the same colour throughout',
      'No hollow tiles — tap across the wall with a knuckle and listen',
      'Tile trims are straight, mitred neatly, and the right colour',
      'Cut edges around sockets, the shower valve and the waste are neat and covered',
      'Floor falls towards the waste in a wet room, with no standing water after a shower',
    ],
  ],
  [
    'Silicone and sealing',
    [
      'One continuous bead everywhere — bath to wall, tray to wall, basin to wall, floor perimeter',
      'No gaps, no bubbles, no fingerprints, no smears on the tile',
      "Silicone is sanitary grade and anti-mould, not decorator's caulk",
      'Bath was filled with water before the bead went on (stops it splitting later)',
      "Shower screen seals sit correctly and the door doesn't drip on the floor",
      'Sealant around the fan, the light fittings and any pipe penetrations',
    ],
  ],
  [
    'Suite, furniture and screens',
    [
      'Nothing rocks — bath, WC, basin, all solid when you lean on them',
      'WC seat sits square and the soft-close works on both sides',
      'Drawers and doors on the vanity open fully, close flush and line up with each other',
      "Bath panel is fixed but removable, and doesn't flex when you stand near it",
      'Shower screen is plumb, swings freely and stays where you put it',
      'Every chrome surface free of scratches, tool marks and adhesive',
      'Taps turn smoothly, hot on the left, and the shower valve is the right way up',
      'All protective film and stickers removed from the whole room',
    ],
  ],
  [
    'Electrics, heat and air',
    [
      'Extractor fan runs, pulls a sheet of paper flat against the grille, and overruns after the light goes off',
      'Check the fan discharges outside — go and look at the vent from the garden with it running',
      'Every light works, the dimmer dims smoothly with no flicker or buzz',
      'Towel rail heats evenly top to bottom, with no cold spots',
      'Underfloor heating warms up within twenty minutes and the thermostat is outside the wet zones',
      'Shaver socket works, and there are no ordinary socket outlets in the room',
      'Test the RCD with the test button; power cuts and resets cleanly',
    ],
  ],
  [
    'Finish and making good',
    [
      'Ceiling paint is even with no roller lines or missed patches, checked with the light on and off',
      "Door closes and latches, and doesn't catch on the new floor",
      'Architrave, skirting and door frame made good and painted',
      'Landing carpet, stairs and the room below left clean',
      'No plaster splashes, adhesive or grout haze on anything',
      'Radiator or pipe boxing is neat and painted, not left bare',
      'Light switch and pull cord clean, straight and working',
      'All rubbish, offcuts and packaging removed from the house and the garden',
    ],
  ],
];

export const HANDOVER = [
  'Electrical Installation Certificate or Minor Works Certificate — with the scheme notification reference',
  'Gas Safe certificate, if the boiler or gas system was touched',
  'Building control sign-off, if the drainage was altered or the room is new',
  'Warranties and registration for the shower valve, the WC frame and the fan',
  'Receipts or the supplier order for every item, in case of a warranty claim',
  'Two or three spare tiles from the same batch, and the grout and silicone brand written down',
  'Where the isolation valves are, and where the stopcock is',
  'Paint colour codes and the tin, for touching up',
  'Your own photos of every wall taken before the boarding went on',
  'A written note of the guarantee: how long, what it covers, and how to claim',
];

export const snagKey = (group: number, index: number) => `s${group}_${index}`;
