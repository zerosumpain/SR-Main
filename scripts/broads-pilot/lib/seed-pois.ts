// Curated POI enrichment: famous waterside pubs (dog/food flags + descriptions)
// overlaid by name onto OSM, plus curated dog-friendly WALKS (which OSM doesn't
// model as points). Research brief §7.

export interface PubMeta { dog_friendly: boolean; food: boolean; description: string }
export const PUB_OVERLAY: { match: RegExp; meta: PubMeta }[] = [
  { match: /swan inn.*horning|the swan.*horning/i, meta: { dog_friendly: true, food: true, description: 'Busy riverside pub on the Bure at Horning with its own moorings — classic Broads lunch stop.' } },
  { match: /new inn.*horning/i, meta: { dog_friendly: true, food: true, description: 'Riverside pub at Horning with moorings; food all day, dogs welcome in the bar.' } },
  { match: /ferry inn.*horning|horning ferry/i, meta: { dog_friendly: true, food: true, description: 'Waterside inn at Horning Ferry with moorings and a big riverside terrace.' } },
  { match: /ferry inn.*stokesby|the ferry.*stokesby/i, meta: { dog_friendly: true, food: true, description: 'Friendly village pub right on the Bure at Stokesby with free moorings for patrons.' } },
  { match: /the lion.*thurne|lion inn.*thurne/i, meta: { dog_friendly: true, food: true, description: 'Village pub a short walk from Thurne Staithe, below the windmill.' } },
  { match: /maltsters.*ranworth|the maltsters/i, meta: { dog_friendly: true, food: true, description: 'Pub at Ranworth Staithe, steps from the moorings and the boardwalk to the church tower.' } },
  { match: /the ship.*reedham|reedham ferry/i, meta: { dog_friendly: true, food: true, description: 'Riverside pub at Reedham with moorings, near the chain ferry and swing bridge.' } },
  { match: /berney arms/i, meta: { dog_friendly: true, food: true, description: 'Remote pub on Breydon Water reachable only by boat or on foot — a Broads institution.' } },
  { match: /pleasure boat.*hickling|the pleasure boat/i, meta: { dog_friendly: true, food: true, description: 'Pub at Hickling Staithe on the edge of the broad, with moorings.' } },
  { match: /falgate|potter heigham/i, meta: { dog_friendly: true, food: true, description: 'Pub near Potter Heigham, a stroll from the bridge moorings.' } },
];

export interface SeedWalk {
  id: string; name: string; lat: number; lng: number; dog_friendly: boolean; length_mi: number; description: string;
}
// Descriptions LEAD with the mileage (the guide catalogue truncates to ~90 chars).
export const WALKS: SeedWalk[] = [
  // short / easy
  { id: 'walk-ranworth-boardwalk', name: 'Ranworth Broad Boardwalk', lat: 52.6695, lng: 1.4960, dog_friendly: true, length_mi: 1, description: '1-mile floating boardwalk through wet woodland to the Broads Wildlife Centre and up St Helen\'s church tower for the best Broads view. From Ranworth Staithe.' },
  { id: 'walk-how-hill', name: 'How Hill Trails', lat: 52.7080, lng: 1.4790, dog_friendly: true, length_mi: 2.5, description: '2½-mile estate & marsh trails past Toad Hole Cottage and the drainage mills. From How Hill moorings on the Ant.' },
  { id: 'walk-salhouse-woods', name: 'Salhouse Broad Woods', lat: 52.6905, lng: 1.4318, dog_friendly: true, length_mi: 2, description: '2-mile woodland & broad-edge loop — easy and dog-friendly. From Salhouse Broad moorings.' },
  { id: 'walk-cockshoot', name: 'Cockshoot Boardwalk & Hide', lat: 52.6855, lng: 1.4995, dog_friendly: true, length_mi: 1.5, description: '1½-mile boardwalk to a hide over the conservation broad. From Cockshoot Dyke moorings on the Bure.' },
  { id: 'walk-coltishall-common', name: 'Coltishall Common Riverside', lat: 52.7268, lng: 1.3760, dog_friendly: true, length_mi: 1.5, description: '1½-mile riverside common stroll at the head of navigation — relaxed and good for paddling. Beside the Bure.' },
  { id: 'walk-thurne-windmill', name: 'Thurne Mill & Riverbank', lat: 52.6960, lng: 1.5290, dog_friendly: true, length_mi: 2, description: '2-mile walk to the white-sailed Thurne Dyke mill and along the riverbank. From Thurne Staithe.' },
  // longer family walks (5–7 miles)
  { id: 'walk-weavers-stalham-hickling', name: "Weavers' Way: Stalham to Hickling", lat: 52.7772, lng: 1.5072, dog_friendly: true, length_mi: 6, description: "6-mile Weavers' Way section from the Stalham (Richardsons) base across the marshes to Hickling — big skies, reedbeds; dogs on leads." },
  { id: 'walk-hickling-circular', name: 'Hickling Broad Circular (NWT)', lat: 52.7300, lng: 1.5870, dog_friendly: true, length_mi: 5, description: "5-mile circular round England's largest broad — marsh harriers, swallowtails, NWT reserve trails. From Hickling Staithe; dogs on leads." },
  { id: 'walk-barton-neatishead', name: 'Barton Broad, Neatishead & Irstead', lat: 52.7200, lng: 1.5050, dog_friendly: true, length_mi: 5.5, description: "5½-mile circular linking Gay's Staithe, Neatishead and thatched Irstead church around Barton Broad." },
  { id: 'walk-ludham-stbenets', name: "Ludham, How Hill & St Benet's Abbey", lat: 52.6992, lng: 1.5093, dog_friendly: true, length_mi: 6, description: '6-mile circular from Ludham Bridge taking in How Hill and the ruined St Benet\'s Abbey — proper big-country marsh walking.' },
  { id: 'walk-horning-ranworth', name: "Horning to Ranworth (Weavers' Way)", lat: 52.7088, lng: 1.4178, dog_friendly: true, length_mi: 6, description: "6-mile there-and-back on Weavers' Way from Horning to Ranworth — riverside, woodland and a pub at each end." },
  { id: 'walk-reedham-berney', name: "Reedham to Berney Arms (Wherryman's Way)", lat: 52.5666, lng: 1.5712, dog_friendly: true, length_mi: 7, description: "7-mile there-and-back on the lonely Wherryman's Way beside the Yare to the remote Berney Arms windmill & pub — vast skies, no roads." },
  { id: 'walk-surlingham-wheatfen', name: 'Surlingham & Wheatfen (Ted Ellis Reserve)', lat: 52.6080, lng: 1.4250, dog_friendly: true, length_mi: 4.5, description: "4½-mile circular through Wheatfen, Ted Ellis's wild fenland reserve, and along the Yare. Dog-friendly." },
  { id: 'walk-carlton-marshes', name: 'Carlton & Oulton Marshes (SWT)', lat: 52.4720, lng: 1.6800, dog_friendly: true, length_mi: 5, description: '5-mile circular across Carlton Marshes Suffolk Wildlife Trust reserve from Oulton Broad — grazing marsh, cranes and otters.' },
  { id: 'walk-whitlingham', name: 'Whitlingham Country Park Circular', lat: 52.6190, lng: 1.3320, dog_friendly: true, length_mi: 3.5, description: "3½-mile family circular round Whitlingham's broads and woods near Norwich — very dog-friendly, café and big meadows." },
  { id: 'walk-cantley-buckenham', name: 'Cantley & Buckenham Marshes (RSPB)', lat: 52.5840, lng: 1.5130, dog_friendly: true, length_mi: 6, description: '6-mile riverside walk along the Yare past Buckenham & Cantley RSPB marshes — wintering geese and wide grazing levels.' },
  { id: 'walk-upton-fen', name: 'Upton Fen & Marshes (NWT)', lat: 52.6620, lng: 1.5560, dog_friendly: true, length_mi: 4, description: "4-mile circular through Upton Fen's rare wet woodland and dykes from Upton Dyke moorings; dogs on leads near stock." },
];

// OSM tags no fishing/swimming for the Broads, so curate the well-known spots.
export interface SimplePoi { id: string; name: string; lat: number; lng: number; description: string }
export const FISHING: SimplePoi[] = [
  { id: 'fish-rockland-broad', name: 'Rockland Broad', lat: 52.5872, lng: 1.4770, description: 'Renowned coarse-fishing broad off the Yare — pike, bream and roach. Moor at Rockland Staithe and fish the broad or the dyke.' },
  { id: 'fish-womack-water', name: 'Womack Water (Ludham)', lat: 52.7052, lng: 1.5410, description: 'Quiet dyke off the Thurne with excellent bank fishing from the staithe moorings.' },
  { id: 'fish-barton-broad', name: 'Barton Broad', lat: 52.7380, lng: 1.4930, description: 'The Broads’ second-largest broad — open-water bream and pike. Moor at Gay’s Staithe or Neatishead.' },
  { id: 'fish-oulton-broad', name: 'Oulton Broad', lat: 52.4740, lng: 1.7000, description: 'Large broad at Lowestoft with mixed coarse fishing and easy moorings at Nicholas Everitt Park.' },
  { id: 'fish-salhouse-broad', name: 'Salhouse Broad', lat: 52.6900, lng: 1.4320, description: 'Sheltered broad off the Bure, good for a relaxed afternoon’s float fishing from the moorings.' },
  { id: 'fish-wroxham-broad', name: 'Wroxham Broad', lat: 52.6960, lng: 1.4170, description: 'The Bure’s biggest broad near Wroxham — open-water bream, roach and pike.' },
  { id: 'fish-hickling-broad', name: 'Hickling Broad', lat: 52.7340, lng: 1.5910, description: 'Big shallow broad famed for pike and bream — fish from the staithe. NWT reserve, observe the rules.' },
  { id: 'fish-south-walsham', name: 'South Walsham Broad', lat: 52.6740, lng: 1.5050, description: 'Quiet inner broad off the Bure with sheltered float fishing from the moorings.' },
  { id: 'fish-surlingham-broad', name: 'Surlingham Broad', lat: 52.6090, lng: 1.4280, description: 'Reed-fringed broad off the Yare near Coldham Hall — classic tench and rudd water.' },
  { id: 'fish-bure-horning', name: 'River Bure at Horning', lat: 52.7080, lng: 1.4200, description: 'Productive river stretch through Horning for roach, bream and big perch from the bank or moored.' },
  { id: 'fish-yare-brundall', name: 'River Yare at Brundall', lat: 52.5950, lng: 1.4350, description: 'Deep tidal Yare with bream shoals and the chance of a big pike; fish near the marina moorings.' },
  { id: 'fish-waveney-beccles', name: 'River Waveney at Beccles', lat: 52.4590, lng: 1.5640, description: 'Slow, wide Waveney through Beccles — roach, bream and chub from the quay moorings.' },
];
export const SWIM: SimplePoi[] = [
  { id: 'swim-beccles-lido', name: 'Beccles Lido', lat: 52.4585, lng: 1.5680, description: 'Family-favourite open-air heated swimming pool right by the Waveney at Beccles — proper safe swimming with a paddling pool and café. Seasonal; check session times. Moor at Beccles.' },
  { id: 'swim-whitlingham', name: 'Whitlingham Great Broad', lat: 52.6190, lng: 1.3320, description: 'Supervised open-water swimming venue near Norwich (Whitlingham Outdoor Education Centre) — sessions must be booked, not free-swim. The only organised open-water swim on the system.' },
  { id: 'swim-salhouse', name: 'Salhouse Broad shallows', lat: 52.6905, lng: 1.4318, description: 'Shallow, sandy-edged broad sometimes used for paddling and a dip from the moorings — check for blue-green algae warnings and keep well clear of the navigation channel.' },
  { id: 'swim-rockland-broad', name: 'Rockland Broad (wild dip)', lat: 52.5872, lng: 1.4760, description: 'A quiet broad off the Yare where confident wild-swimmers occasionally dip away from the channel — cold, weedy and algae-prone, so at your own risk and never near boats.' },
];
