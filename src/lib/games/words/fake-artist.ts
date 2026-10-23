// Odd Artist Out words: a category everyone sees and a secret word only the
// artists see. Hand-picked and family-safe: every word is something a child
// under thirteen knows (easy) or could work out from the category (medium,
// hard), with nothing scary, rude or grown-up. Each must be drawable a line at
// a time, so a picture built by five people can still hint at it.
//
// EASY — the first thing anyone would name in the category.
// MEDIUM — still well known, but not the obvious pick.
// HARD — less common members of the category: the fake has less to go on and
// the artists must draw more carefully to be recognised without giving it away.
//
// Space-separated to keep the module small; a two-word answer is joined with
// `_` here and shown with a space.

const split = (s: string): string[] =>
  s
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/_/g, ' '));

export interface Category {
  name: string;
  easy: readonly string[];
  medium: readonly string[];
  hard: readonly string[];
}

const cat = (name: string, easy: string, medium: string, hard: string): Category => ({
  name,
  easy: split(easy),
  medium: split(medium),
  hard: split(hard),
});

export const CATEGORIES: readonly Category[] = [
  cat(
    'Animals',
    'cat dog cow pig horse rabbit duck elephant',
    'giraffe zebra kangaroo penguin camel tortoise',
    'hedgehog flamingo armadillo platypus chameleon peacock',
  ),
  cat(
    'Food',
    'pizza apple banana cake sandwich egg ice_cream carrot',
    'pancake sausage pretzel doughnut burger spaghetti',
    'croissant pineapple broccoli artichoke kebab sushi',
  ),
  cat(
    'In the house',
    'bed chair table door lamp clock sofa bath',
    'teapot kettle fridge toaster ladder mirror',
    'chandelier wardrobe radiator staircase fireplace hourglass',
  ),
  cat(
    'Things that go',
    'car bus train bike boat plane rocket truck',
    'tractor helicopter scooter submarine skateboard canoe',
    'hovercraft tram unicycle hot_air_balloon gondola bulldozer',
  ),
  cat(
    'Sports and games',
    'football tennis swimming running skipping chess bowling golf',
    'basketball cricket skiing surfing archery darts',
    'fencing badminton snooker curling gymnastics rowing',
  ),
  cat(
    'Weather and sky',
    'sun rain snow rainbow cloud moon star wind',
    'lightning snowflake puddle tornado sunset comet',
    'hailstone fog icicle eclipse constellation frost',
  ),
  cat(
    'Jobs',
    'teacher doctor farmer chef firefighter builder nurse pilot',
    'astronaut postman dentist baker plumber artist',
    'lighthouse_keeper beekeeper photographer lifeguard librarian magician',
  ),
  cat(
    'Places',
    'beach farm school park castle zoo shop playground',
    'lighthouse library island airport museum stadium',
    'pyramid volcano igloo windmill harbour waterfall',
  ),
  cat(
    'Toys',
    'ball kite teddy doll yo_yo robot blocks puzzle',
    'spinning_top rocking_horse marbles jigsaw puppet skipping_rope',
    'kaleidoscope jack_in_the_box music_box pogo_stick boomerang dominoes',
  ),
  cat(
    'Clothes',
    'hat sock shoe scarf glove coat dress jumper',
    'wellies pyjamas crown bow_tie apron raincoat',
    'beret sombrero kilt waistcoat flip_flops earmuffs',
  ),
  cat(
    'Music',
    'drum guitar piano trumpet bell whistle violin',
    'recorder xylophone harp tambourine microphone saxophone',
    'accordion bagpipes cello harmonica triangle maracas',
  ),
  cat(
    'Under the sea',
    'fish whale shark crab octopus starfish dolphin',
    'jellyfish seahorse turtle lobster seal coral',
    'stingray pufferfish walrus anchor treasure_chest shipwreck',
  ),
  cat(
    'Fairy tales',
    'dragon castle princess king queen wizard unicorn',
    'giant mermaid fairy wand troll beanstalk',
    'glass_slipper pumpkin_coach magic_mirror genie gingerbread_house golden_goose',
  ),
  cat(
    'In the garden',
    'flower tree bee butterfly snail worm spade',
    'wheelbarrow watering_can sunflower ladybird bird_table hose',
    'greenhouse scarecrow compost_heap hedge_trimmer gnome trellis',
  ),
  cat(
    'At school',
    'pencil book ruler bag desk clock crayon',
    'scissors globe whiteboard rubber calculator lunchbox',
    'microscope protractor compass_set telescope register stapler',
  ),
  cat(
    'Bugs and small creatures',
    'ant spider bee ladybird snail worm butterfly',
    'caterpillar grasshopper beetle dragonfly moth frog',
    'stick_insect centipede firefly praying_mantis woodlouse tadpole',
  ),
];

/** Every word in every tier, for the list's own tests. */
export const ALL_WORDS: readonly string[] = CATEGORIES.flatMap((c) => [...c.easy, ...c.medium, ...c.hard]);
