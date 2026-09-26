// Wordle Race secrets: common, family-friendly five-letter words (1405).
//
// Source: the five-letter lowercase a–z base words of the system Hunspell
// dictionary (/usr/share/hunspell/en_US.dic, SCOWL-derived), ranked by how often
// they are spoken in film and TV subtitles (hermitdave/FrequencyWords, 2018 en_50k,
// OpenSubtitles), cut at the top 1,700 and then pruned by hand: slurs, sexual and
// crude words, drink and drugs, first names, nationalities, slang contractions
// (gonna, dunno), abbreviations, and regular inflections (asked, balls) are out.
// US spellings whose British form is longer (color, favor) are guessable but never
// the secret; a few British spellings were added (fibre, metre, litre, sabre,
// odour, mould, ochre, tonne). Every answer is also in ALLOWED.
//
// ORDER MATTERS: commonest first. A difficulty draws its secret from a prefix of
// this list (see ANSWER_POOL in wordle-race.ts), so append, never sort.
// Space-separated to keep the module small; split once at load.

export const ANSWERS: readonly string[] = `
  there right about think going would where could never sorry thank doing thing these first still
  their again maybe other night great those leave money place which hello house every being wrong
  world might three today found woman heard ready happy haven whole start while since guess bring
  alone phone until heart worry watch music young water stuff death crazy drink check point sleep
  quite close party shall story least fight stand child speak truth blood break trust power honey
  front hurry along light clear order funny black cause ahead taken white small uncle earth shoot
  touch sound human drive daddy dance catch sense known dream write voice sweet lucky quiet given
  fault learn early clean piece throw worth quick state weird chief tired class worse court marry
  meant movie mouth month lying train seven hotel round broke frank table buddy floor swear spend
  space group peace force short enjoy crime horse count lunch radio paper eight cover agree major
  stick offer smart relax brain proud angry agent dress scene tough share laugh smell often spent
  third visit judge prove queen carry teach upset green store doubt wrote field south glass dying
  whose plane north madam truck board stuck magic reach dirty knock worst river final match grand
  press blame price smoke smile guard begin enemy allow apart stage bunch admit steal twice cross
  waste taste silly build track above video fresh stole study crowd treat empty level built raise
  extra heavy shame awful large local stone grace beach faith knife devil blind ghost tight speed
  trial ought spoke angel super among photo sight coach serve trick truly nurse chair brown shirt
  guest began usual aware proof cream total threw birth noise focus exist issue sword mayor staff
  split alarm slept enter brave model style spare shake loose paint sugar block fancy chest trade
  storm lover bread legal owner rough clock ocean thief bleep plant bless crash lower event shape
  royal cheap avoid grown giant scare fixed grant scary grave chase shock pizza image plate mercy
  drove wound crack chose stood below march aside spell freak awake prime piano value union media
  pride metal candy bride penny claim solve theme chuck false punch witch toast coast beast shift
  exact score pilot grade juice tower wheel fruit range youth eaten alien route trace nasty merry
  snake actor anger sharp squad chain fully robin curse loser climb trash prize stock bravo glory
  apple flesh mummy alert panic tiger saint solid chick demon crown dozen swing mixed carol cruel
  daily bound guide couch cheer title fever flash siren drama adult joint civil shine argue trail
  shout blast fifth sweat teddy mason kitty crush noble gross skull shown print sauce grass cheat
  steel cabin sheep brand virus plain robot purse holly tribe equal chill nerve stake thick sport
  basic cliff fetch guilt blown booth trunk drank salad loyal mouse fairy frame habit strip lousy
  belly fence limit pulse cloud pitch charm apply fifty clown minor chaos angle scale shark sneak
  shell drill begun liver album alley alibi blade alpha widow moral award grief novel opera brief
  elder beard burnt upper shore lemon crane fraud tense drawn motor steak tooth cable slide entry
  mount pound motel rifle brick brush delay baker badge eagle basis twist inner patch radar amber
  solar phase fleet smash poker sober niece towel daisy bunny skill baron petty diary wagon bacon
  click burst sunny sheet ranch steam pearl ideal spoil lance bloke nanny vital groom drown alike
  dough wreck stink bingo broad stare puppy suite arrow shave sixth error react theft harsh flame
  medal swell feast bench scout vault quote sonic rusty chess cargo shove skirt spike whale villa
  comic faint bleed cycle goose sweep risky blank dummy clerk prior organ spray ninja handy crawl
  slice stiff creep woody drake scent naive jolly swore bonus wrist drain laser thumb lobby dealt
  fatal roast flood champ dizzy bully spill snack cheek ditch spite rebel orbit greet forty brass
  sworn email tasty label eager logic minus cough cloth float glove stark creek ankle draft messy
  quest spoon swamp depth occur stamp torch stall panel smack choir stunt hobby hatch fluid shiny
  flush toxic rally bloom cease bribe lodge olive straw diner weigh topic blond plead cigar seize
  sting attic maker brake scarf marsh grain rogue erase canal shade hence rival elite craft shelf
  chart spark globe adore pasta delta stove disco ridge razor prank realm altar jelly choke donor
  refer karma layer adopt frost buyer blunt hunch yacht stain hairy lease lined tease baked rider
  stack wheat finch whack noisy waist curry grill pinch joker porch kneel rapid sushi shaft spine
  salon asset shook naval swine peach crook grasp reign stash jewel swept ferry urban wired comet
  vomit drift aisle raven spicy sheer blink steer dodge unite camel probe stray rabbi arena audio
  fibre metre litre sabre odour mould tonne ochre steed piggy pause scrap onion spice grunt elbow
  flown alter filth agony shack scrub ruler flour dusty utter exile drone tango swift token ninth
  scoop spear boxer yummy slack blend flirt dwarf boost timer poppy metro grove irony waltz await
  verse bliss wrath tutor stern curly batch flock medic sewer moose brace bluff juicy eerie troop
  flute funky broom curve sixty valid barge panda strap flora polar syrup haunt essay grind sniff
  slick vague tenth yield motto midst tying unity forge valve scope gravy vocal adapt fishy flick
  rhyme tummy rover hardy truce plaza berry verge coral arise scram brute telly crust abbey weary
  stool lotus skate vicar pupil crank manor merit salty rodeo bathe crate shady hitch rainy leash
  basil cocoa dense flint chalk clone hazel gamma fuzzy cutie siege cobra manly groan crude venom
  relay ounce queue shush tread doggy wager thigh serum alias apron tonic steep hound cloak macho
  fling froze mourn quack troll squid notch annoy arson dryer moody slate scold dwell squat manic
  omega trout risen flank itchy haste heist slash thorn hasty debut flare milky latte valet cadet
  dairy slope paste fiery genie viral crisp acute grape muddy needy titan carve brink chunk vouch
  venue lunar whoop hubby pluck surge sauna pedal turbo tempt melon windy derby heave bogus golly
  dandy tweet skunk chant laden comfy heath clamp rural usher merge blaze salsa dread abyss rouge
  corny havoc abide clink grail lever decoy vivid shaky goofy goody index blush snoop array maple
  linen slime clash fudge ivory trend chump mango sonar decay posse jumbo amuse lorry gavel thump
  weave budge diver cling relic spade ratio rhino scalp misty hedge viper witty abbot vegan guild
  rugby zebra growl picky ledge spree stale munch canoe baton geese forum crest chute slimy jumpy
  lowly cramp moist gauge intro tacky oasis aloud bagel farce scoot loony wedge folly basin banjo
  smear renew hutch stump purge slain knack crave stoop chord torso buggy tally furry sedan colon
  snail vista fiend peril brook civic cello whine rinse latch plank loner miner broth elope sling
  patio creed tempo bumpy stomp chime pouch combo stung chimp bleak expel mound whiff felon pushy
  rigid giddy imply biker dodgy juror wacky adieu swung bugle frown quota tidal genre unfit eater
  rowdy snuff swarm timid stalk brawl potty spook boast snore swipe snowy audit aloha cider samba
  jerky frail flair nutty flask ulcer racer foggy fussy elect mixer bossy deuce pious proxy crypt
  teeny ample clang icing gorge amaze limbo cedar girly graft chino drool leech sassy aroma atlas
  birch swoop quill algae floss vogue hoist retro bland toxin viola cinch speck croft lurch rabid
  scuba sleet shawl satin pence canon jiffy hippo glide friar latex atone envoy taboo quake fluke
  slang ether nasal tulip decaf sever trait abode beige deity snort spawn gnome blitz wharf puffy
  wield whirl aspen lumpy awoke cubic gloom polka gloss yearn tiara clank flake gauze ditto lucid
  glare kebab hover magma gloat evade dingo creak swede quail bison smoky shone lapse plump brood
  fluff scorn liner quilt nudge lyric crumb bonny stout otter width smelt ruddy stork hefty yeast
  mushy coven crock louse jazzy snout braid chirp vigil arose wring comma vinyl nylon avail prune
  mimic nacho strut ozone perky hyena sinus decor perch totem mower tract pooch gland savvy guise
  graze winch soggy regal horde croak silky eject cache chore vixen femur mural woven lolly berth
  polio spout cater excel amiss ethic cluck agile tubby detox dopey exert lofty tipsy binge gable
  filly putty matey align crept mania recap dinky gizmo rupee flung graph annex
`
  .trim()
  .split(/\s+/);
