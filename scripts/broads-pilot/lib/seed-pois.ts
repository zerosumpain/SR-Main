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
  id: string; name: string; lat: number; lng: number; dog_friendly: boolean; description: string;
}
export const WALKS: SeedWalk[] = [
  { id: 'walk-ranworth-boardwalk', name: 'Ranworth Broad Boardwalk', lat: 52.6695, lng: 1.4960, dog_friendly: true, description: 'Floating boardwalk through wet woodland to the Broads Wildlife Centre and the climb up St Helen\'s church tower for the best Broads view. From Ranworth Staithe moorings.' },
  { id: 'walk-how-hill', name: 'How Hill Trails', lat: 52.7080, lng: 1.4790, dog_friendly: true, description: 'Riverside and marsh trails through the How Hill estate past Toad Hole Cottage and the drainage mills. From the How Hill moorings on the Ant.' },
  { id: 'walk-salhouse-woods', name: 'Salhouse Broad Woods', lat: 52.6905, lng: 1.4318, dog_friendly: true, description: 'Woodland and broad-edge paths from Salhouse Broad — easy circular walk, dogs love it. From the Salhouse Broad moorings.' },
  { id: 'walk-cockshoot', name: 'Cockshoot Boardwalk & Hide', lat: 52.6855, lng: 1.4995, dog_friendly: true, description: 'Short boardwalk to a hide over the conservation broad. From Cockshoot Dyke moorings on the Bure.' },
  { id: 'walk-coltishall-common', name: 'Coltishall Common Riverside', lat: 52.7268, lng: 1.3760, dog_friendly: true, description: 'Open riverside common at the head of navigation — relaxed dog walk and paddling spot beside the Bure.' },
  { id: 'walk-thurne-windmill', name: 'Thurne Mill & Riverbank', lat: 52.6960, lng: 1.5290, dog_friendly: true, description: 'Walk to the white-sailed Thurne Dyke drainage mill and along the riverbank. From Thurne Staithe.' },
];
