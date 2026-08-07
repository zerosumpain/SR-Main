// house.ts — content for Reach / "The house".
//
// A home-automation system hands you a flat list of several hundred entity ids named like
// `light.kitchen_ceiling_2`. That is a fine wire format and a hopeless way to answer "turn
// the kitchen off", so the interesting engineering here is the shape imposed on top of it:
// the same entities arranged the way a person thinks about a house, and a dry run that
// answers "what would you do" without doing it.
//
// The rooms and devices below are illustrative — no real house is described here.

export interface Entity {
  id: string;
  name: string;
  domain: string;
  area: string;
  /** What a reading of it looks like. */
  state: string;
  /** True when a service can be called on it, rather than only read. */
  actuates: boolean;
}

/** A stand-in house, sized so the tree is legible rather than realistic. */
export const ENTITIES: Entity[] = [
  { id: 'light.kitchen-ceiling', name: 'Ceiling', domain: 'light', area: 'Kitchen', state: 'on · 60%', actuates: true },
  { id: 'light.kitchen-under', name: 'Under-cupboard', domain: 'light', area: 'Kitchen', state: 'off', actuates: true },
  { id: 'sensor.kitchen-temp', name: 'Temperature', domain: 'sensor', area: 'Kitchen', state: '19.4 °C', actuates: false },
  { id: 'binary.kitchen-door', name: 'Back door', domain: 'binary_sensor', area: 'Kitchen', state: 'closed', actuates: false },
  { id: 'light.study-desk', name: 'Desk', domain: 'light', area: 'Study', state: 'on · 100%', actuates: true },
  { id: 'sensor.study-power', name: 'Power draw', domain: 'sensor', area: 'Study', state: '184 W', actuates: false },
  { id: 'climate.study-rad', name: 'Radiator', domain: 'climate', area: 'Study', state: '18 °C, idle', actuates: true },
  { id: 'media.living-speaker', name: 'Speaker', domain: 'media_player', area: 'Living room', state: 'paused', actuates: true },
  { id: 'light.living-lamp', name: 'Corner lamp', domain: 'light', area: 'Living room', state: 'off', actuates: true },
  { id: 'cover.living-blind', name: 'Blind', domain: 'cover', area: 'Living room', state: 'open', actuates: true },
  { id: 'sensor.hall-motion', name: 'Motion', domain: 'binary_sensor', area: 'Hall', state: 'clear', actuates: false },
  { id: 'lock.hall-front', name: 'Front door', domain: 'lock', area: 'Hall', state: 'locked', actuates: true },
];

/** Friendly names for the domains that appear above. */
export const DOMAIN_LABEL: Record<string, string> = {
  light: 'Lights',
  sensor: 'Sensors',
  binary_sensor: 'Contacts and motion',
  climate: 'Heating',
  media_player: 'Media',
  cover: 'Blinds',
  lock: 'Locks',
};

export const TREE_NOTE = {
  title: 'Area, then kind, then thing',
  body:
    'The connection itself returns a flat list of ids and their states, and no area at all — the area lives in a separate registry that is cached and joined on to every reading. Doing that join is what turns “which of these three hundred is the kitchen” into a question with a two-click answer, and it is what lets an automation be written against a room rather than against a list of identifiers.',
} as const;

export interface Operation {
  id: string;
  label: string;
  what: string;
  /** Does it change anything in the house? */
  writes: boolean;
}

export const OPERATIONS: Operation[] = [
  { id: 'query_state', label: 'Read a state', what: 'The current value of one or many entities, each returned with its area and friendly name attached.', writes: false },
  { id: 'get_history', label: 'Read history', what: 'The same entities over a window, for anything that needs a trend rather than a moment.', writes: false },
  { id: 'render_template', label: 'Render a template', what: 'Ask the house itself to compute something across its own entities and hand back the answer.', writes: false },
  { id: 'call_service', label: 'Call a service', what: 'Turn something on, set a temperature, open a blind. The domain is derived from the entity when it is not given.', writes: true },
  { id: 'fire_event', label: 'Fire an event', what: 'Put an event on the house’s own bus, for automations that live over there rather than here.', writes: true },
];

export const DRY_RUN = {
  title: 'Ask what it would do',
  body:
    'Any operation that changes something can be run without changing it. Instead of calling, the node returns the exact call it would have made — domain, service, target and data — so a new automation can be built, wired and watched end to end before it is ever allowed to touch a light. It is the same code path with one flag, so what you inspect is what will run.',
} as const;

export const MULTI = {
  title: 'One node, many entities',
  body:
    'A read takes a selection rather than a single id, so “every sensor in the kitchen” is one node and one round trip rather than four wired in parallel. Each result still comes back individually labelled with its own area and name, so the branch downstream can tell them apart without knowing the identifiers.',
} as const;

export const HOUSE_FACTS = [
  { k: 'Five operations', v: 'three read, two write', why: 'The split is the useful one: everything on the left of it is safe to run speculatively, and everything on the right has a dry run.' },
  { k: 'Areas are cached', v: 'joined per reading', why: 'The live connection has states and no areas. The registry is stored and merged in, so an area is available even on a response that never carried one.' },
  { k: 'Templates are values', v: 'anywhere in the config', why: 'An entity id, a service payload or an event body can be written in terms of what arrived at the node, so one node serves a whole class of runs.' },
  { k: 'A read is one probe', v: 'and the probe is real', why: 'The health check for the house is an actual round trip that comes back with sensors, not a stored flag saying it was configured once.' },
  { k: 'It is a node, not a bespoke path', v: 'the same engine as everything else', why: 'Which means the house can be wired to mail, to a schedule, to the assistant or to a model without any of them knowing anything about it.' },
];

export const HOUSE_LESSON = {
  title: 'The interface is the feature',
  body:
    'Nothing here changes what the house can do. Arranging its entities the way a person already thinks about the building, and letting an automation be inspected before it is armed, is what makes several hundred identifiers into something worth wiring anything to.',
} as const;
