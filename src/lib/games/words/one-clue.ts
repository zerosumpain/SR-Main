// One Clue — the secret words, one list per difficulty.
//
// Curated by hand for a family table with children under thirteen: every word
// is one a child knows or can work out, nothing needs an adult's knowledge or
// an adult's mind, and nothing is a brand, a person or a place name. Every
// entry is ONE lower-case word of letters only (the clue checks compare stems
// against it, and a two-word secret would make "one word" clues unfair).
// Space-separated to keep the module small; the test checks the shape.
//
// EASY — concrete everyday nouns: animals, food, toys, things at home and at
// school. Easy to clue in one word, easy to guess.
// MEDIUM — still things, but a wider world: places, jobs, weather, sports,
// things in a town, a few activities. More clues collide.
// HARD — ideas and less common things (echo, shadow, gravity, holiday): the
// obvious one-word clue is often the one everybody writes, so duplicates
// cancel more and the team has to think sideways.

const split = (s: string): string[] => s.trim().split(/\s+/);

export const EASY: readonly string[] = split(`
  apple banana carrot cheese bread pizza cake biscuit sandwich egg
  orange lemon grapes strawberry pear potato tomato honey jam soup
  cat dog rabbit horse cow pig sheep duck chicken goat
  mouse frog fish bird owl lion tiger elephant giraffe monkey
  bear penguin whale shark dolphin turtle snake spider bee butterfly
  snail crab octopus zebra kangaroo
  sun moon star cloud rain snow rainbow tree flower leaf
  house door window bed chair table lamp clock key cup
  spoon fork plate bath towel soap toothbrush pillow blanket mirror
  hat shoe sock coat scarf glove umbrella bag button crown
  ball kite balloon drum robot teddy doll puzzle bike scooter
  car bus train plane boat rocket tractor truck book pencil
  crayon paint scissors school teacher garden beach sandcastle park swing
`);

export const MEDIUM: readonly string[] = split(`
  castle volcano lighthouse bridge windmill igloo pyramid tower island jungle
  desert forest river mountain cave farm zoo museum library hospital
  airport station circus market bakery playground cinema aquarium stadium harbour
  doctor nurse farmer pilot chef firefighter astronaut dentist builder postman
  thunder lightning tornado fog frost puddle sunset breeze icicle snowflake
  football tennis swimming skating cricket basketball skipping cycling karate gymnastics
  dragon unicorn mermaid pirate wizard knight ghost giant fairy alien
  hedgehog squirrel badger fox parrot peacock flamingo jellyfish seahorse caterpillar
  camera telescope compass magnet battery helmet backpack ladder tent torch
  birthday picnic holiday party wedding parade camping fireworks treasure map
  violin guitar piano trumpet whistle orchestra dancing singing painting baking
  calendar alphabet dictionary globe passport envelope stamp chimney fountain statue
`);

export const HARD: readonly string[] = split(`
  shadow echo gravity magic dream memory secret silence surprise mystery
  friendship courage patience kindness luck freedom bravery honesty adventure imagination
  time future history season weekend tomorrow midnight sunrise winter autumn
  energy electricity invention experiment volume temperature weight distance speed balance
  rhythm melody chorus harmony applause audience stage costume rehearsal ticket
  orbit planet comet eclipse galaxy universe meteor satellite horizon atmosphere
  fossil skeleton tide current reef glacier canyon swamp meadow harvest
  recipe ingredient breakfast dessert flavour appetite leftovers lunchbox menu kitchen
  journey direction border neighbour village capital crowd queue traffic shortcut
  instructions homework spelling question answer riddle joke rhyme fairytale sentence
  reflection invisible upside opposite middle pattern circle shape colour sparkle
`);

export const WORDS: Record<'easy' | 'medium' | 'hard', readonly string[]> = { easy: EASY, medium: MEDIUM, hard: HARD };

/**
 * Real words that sit one typo (two, on a ten-letter word) from a secret word,
 * keep its first letter, and are not a form of it: a guess of one of these is
 * a different answer, never a typo (plant is not planet, winner is not
 * winter). Never shown to anyone; generated from a system word list against
 * the lists above with the same typo and root rules as `guessMatches`, then
 * checked by hand: US spellings (color) and common misspellings (lightening)
 * are left off so they still count. Regenerate when the lists change; the
 * test checks every entry still sits near a listed word.
 */
export const NOT_TYPOS: readonly string[] = split(`
  adventurer atmospheric baaing backing badder badge baker baling balking
  bandana banking baring barking baseball basing basking bating batter baying
  biking blanked blanker blankest boarder bolder borer braking bravely
  braver breezy bride bridle buttery cannon canon canton capitol capping
  carping caste cattle champing cheesy chords chores circlet cirrus clamping
  cramping cricked currant dragoon electrician ellipse expedient experimental
  experimenter farmed firefight firmer flaming flowed flowery footfall
  fores former framer freighter gapes glazier graces grades graphs grates
  graves grazes gripes gropes gymnasts hardest honest honestly imaginative
  inland instructing instructional instructors intention invisibly jangle
  jingle juggle karat lander larder lighting magneto marked marker mastery
  meddle meter money muddle orchestral paddle paining panting pastern patter
  peddle piddle planed planes plant pointing postmen prate printing puzzler
  rabbi racket recite reelection reflecting reflective reflector refraction
  rejection repletion rocked rocker sating scooted seating secrete selling
  sentience shadowy shelling shimming shipping shooter signing silencer
  singling sinking sinning sipping skimming skimping slating slider slimming
  slinging slipping smelling snider snipping sparkler spidery spilling
  state stating stature status statute stinging subset swelling swinging
  teaches temperate thicket ticked ticker traitor treasurer treasury trumped
  villager wadding wedging weeding weigh weighty welding wending whistler
  whittle widow wight winger winner winnow wintery wright
`);
