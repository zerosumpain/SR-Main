// Codenames — the words on the cards.
//
// Written for this table, not copied from any box: everyday words a child
// knows, chosen because most of them mean two things (bat, bank, pitch, ring)
// — that is what makes a clue that links three of them land, and a careless
// one point at the wrong card. Nothing is a brand, a person or a place a child
// would not know. Every entry is ONE lower-case word of letters only (the clue
// check compares stems against them). Space-separated to keep the module
// small; the test checks the shape and that there are no repeats.

const split = (s: string): string[] => s.trim().split(/\s+/);

export const WORDS: readonly string[] = split(`
  bat bank bark bear bell belt berry block board boot bow bowl box bridge brush bug
  button cap card carrot castle cat chain chair change check chest chick chip circle
  clock cloud club coach coat code comb cone cook copper cord corn court cover crane
  crown crystal cup cycle dance date deck diamond dice disc doctor dog dragon drill
  drop drum duck dust eagle egg engine eye face fair fall fan feather fence field file
  fire fish flag flat flute fly fog foot fork fox frog game garden ghost giant glass
  glove goal gold grass ground hammer hand head heart hole honey hook horn horse hose
  ice iron jack jam jet joke key kid king kite knife knight knot ladder lamp lap lead
  leaf letter light line link lion lock log mail map mark mask match medal milk mine
  mint mirror mole money monkey moon mouse mouth nail net night note nut octopus orange
  organ owl pad paint palm pan paper park party pass pen penguin piano pie pig pilot
  pin pipe pirate pit pitch plane plant plate point pole pool post pound press prince
  pumpkin pupil queen racket rain ring robot rock rocket roll root rose round row
  ruler sail salt saw scale school screen seal season shadow shark sheep shell ship
  shoe shop shower sink skate slip snake snow sock soldier sound space spell spider
  spike spine spot spring square stable staff stamp star station stick stone storm
  straw stream string suit sun swing table tail tap tea teacher temple tick tie tiger
  tooth top torch tower track train trap tree trunk tube turkey wall watch water wave
  web whale wheel whip wind window wing witch wolf worm yard
  apple anchor angel arm arrow back ball band bar base battery beach bed bee bill
  bird blade blind bolt bone book bottle branch brick bubble bulb bus cake camel camera
  candle cannon capital cave cell chalk cheese cherry circus cliff comet compass
  cotton cow crab crash cricket crow cube cushion dart desert dinosaur dolphin door
  dream dress echo elephant elf envelope fairy farm flower forest fountain frost
  galaxy gate gem giraffe glue gnome grape guitar hat helmet hero hill hospital island
  jelly jungle kangaroo kettle lab lemon lift lizard magic magnet marble maze meteor
  microscope moth mountain mud museum ninja ocean oil oven paddle panda parrot pearl
  pebble pepper pillow pizza planet pocket pony potato puzzle pyramid rabbit radio
  rainbow river saddle sandwich scarf scissors shield skeleton sledge slide smoke
  snail soap spoon sponge squirrel statue steam sugar sword telescope tent thread
  throne thunder toast tornado toy treasure trumpet tunnel unicorn vampire volcano
  wagon wallet wand wizard yoyo zebra zoo
`);
