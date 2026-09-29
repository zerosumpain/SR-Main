// Draw & Guess words. Hand-picked, family-friendly, and drawable: every one is
// something a child could sketch in eighty seconds and a grandparent could name.
// Space-separated to keep the module small; a two-word answer is joined with `_`
// here and shown with a space.
//
// EASY — simple concrete nouns: animals, food, toys, things in the house.
// MEDIUM — still things, but fussier to draw or to tell apart (castle, volcano),
// plus a few easy actions.
// HARD — harder to draw: actions, places, compound ideas and a few abstract ones
// (birthday, holiday, music) that need a scene rather than an object.

const split = (s: string): string[] =>
  s
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/_/g, " "));

export const EASY: readonly string[] = split(`
  apple banana cherry grapes lemon orange pear pineapple strawberry watermelon
  carrot pizza cake cookie egg bread cheese ice_cream sandwich lollipop
  cat dog fish bird cow pig sheep horse duck frog
  rabbit mouse snake spider bee butterfly snail owl lion tiger
  elephant giraffe monkey bear penguin whale shark octopus crab turtle
  sun moon star cloud rain snowman rainbow tree flower leaf
  house door window bed chair table lamp clock key cup
  hat shoe sock shirt glasses crown ring umbrella bag button
  ball kite balloon drum robot teddy doll boat car bus
  train plane bike rocket truck tractor book pencil scissors phone
  heart smile hand foot eye nose ear tooth
  boot bone candle bell box
  ladder spoon fork bucket brush comb soap towel
  tent flag fence mountain island
`);

export const MEDIUM: readonly string[] = split(`
  castle volcano lighthouse bridge windmill igloo pyramid tower submarine
  helicopter skateboard scooter parachute hot_air_balloon sailboat ambulance fire_engine
  dinosaur dragon unicorn mermaid pirate wizard ghost alien astronaut knight
  kangaroo zebra camel crocodile dolphin jellyfish seahorse peacock flamingo hedgehog
  squirrel bat parrot ladybird caterpillar worm eagle swan tortoise
  cactus mushroom palm_tree sunflower pumpkin corn broccoli popcorn cupcake pancake
  sandcastle snowflake tornado lightning waterfall river beach desert jungle cave
  guitar piano trumpet violin microphone camera television computer headphones
  magnet compass map telescope treasure anchor sword shield bow_and_arrow
  toothbrush hairdryer vacuum fridge oven kettle teapot bathtub toilet mirror
  swing slide trampoline football tennis basketball medal trophy
  jumping swimming sleeping running dancing eating
`);

export const HARD: readonly string[] = split(`
  birthday holiday music friendship dream nightmare memory idea secret surprise
  shadow echo gravity electricity wind noise silence invisible
  juggling sneezing yawning snoring whistling tickling hiccup laughing crying
  fishing painting cooking gardening skiing surfing climbing camping knitting
  hide_and_seek tug_of_war traffic_jam fire_drill picnic sleepover wedding
  haircut homework bedtime breakfast lunchbox shopping_trolley
  airport hospital library museum supermarket zoo farm circus playground school
  earthquake eclipse sunrise sunset thunderstorm fog tide
  time_machine black_hole space_station moon_landing
  scarecrow snow_angel treasure_map message_in_a_bottle
  recycling spring autumn winter summer
  magician superhero detective lifeguard referee
`);

/** Every word, for the check that nothing is repeated across tiers. */
export const ALL_WORDS: readonly string[] = [...EASY, ...MEDIUM, ...HARD];
