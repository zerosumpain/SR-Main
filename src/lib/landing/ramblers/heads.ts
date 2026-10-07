// The rambler's heads: hand-drawn sprites for the side, front and back views,
// and the faces painted onto them. A face is a short list of cells, so an
// expression is cheap to add and easy to read here. Pure.
//
// Sprite key: H hair, L hair highlight, s skin, d skin shade, . empty.

/** Every expression he has. Not every one has a side version; see `sideFace`. */
export type Face =
  | 'neutral'
  | 'blink'
  | 'happy'
  | 'calm'
  | 'think'
  | 'yawn'
  | 'tired'
  | 'stressed'
  | 'mad'
  | 'surprised'
  | 'confused'
  | 'cold'
  | 'hot'
  | 'asleep'
  | 'strain';

/** Palette keys a face cell may use. */
export type FaceInk = 'eye' | 'white' | 'hair' | 'skin' | 'skinD' | 'mouth' | 'teeth' | 'tongue' | 'blush';
export type Cell = [col: number, row: number, ink: FaceInk];

export const SIDE_HEAD = [
  '....HHHHH...',
  '..HHHLLHHH..',
  '.HHHHHHHHLH.',
  'HHHHHHHHHHH.',
  'HHHHHssssss.',
  'HHHdsssssss.',
  'HHddsssssss.',
  'HHddsssssss.',
  '.Hdssssssss.',
  '..dssssssss.',
  '...ddssss...',
];
/** Column of the side head that sits over the neck. */
export const SIDE_NECK = 5;

export const FRONT_HEAD = [
  '...HHHHH...',
  '..HHLLHHH..',
  '.HHHHHHLHH.',
  'HHHHHHHHHHH',
  'HHssssssHHH',
  'HsssssssssH',
  'dsssssssssd',
  'dsssssssssd',
  '.sssssssss.',
  '.sssssssss.',
  '..sssssss..',
];
export const FRONT_NECK = 5;

export const BACK_HEAD = [
  '...HHHHH...',
  '..HHLLHHH..',
  '.HHHHHHLHH.',
  'HHHHHHHHHHH',
  'HHHHHHHHHHH',
  'HHHHLHHHHHH',
  'dHHHHHHHHHd',
  'dHHHHHHHHHd',
  '.HHHHHHHHH.',
  '..HHHHHHH..',
  '...sssss...',
];

// Front face layout: brows across rows 4 to 6, eyes on row 7 (a pupil and a
// white), nose on row 8, mouth on rows 9 and 10.
const BROW: Record<string, [number, number][]> = {
  flat: [[2, 5], [3, 5], [7, 5], [8, 5]],
  up: [[2, 4], [3, 4], [7, 4]],
  worried: [[2, 6], [3, 5], [7, 5], [8, 6]],
  angry: [[2, 5], [3, 6], [7, 6], [8, 5]],
  quizzical: [[2, 4], [3, 4], [7, 6], [8, 6]],
};
const brows = (k: keyof typeof BROW): Cell[] => BROW[k].map(([c, r]) => [c, r, 'hair']);

/** Open eyes looking left (-1), at the viewer (0) or right (1). */
function openEyes(look: number): Cell[] {
  if (look < 0) return [[2, 7, 'eye'], [3, 7, 'white'], [7, 7, 'eye'], [8, 7, 'white']];
  if (look > 0) return [[2, 7, 'white'], [3, 7, 'eye'], [7, 7, 'white'], [8, 7, 'eye']];
  return [[2, 7, 'white'], [3, 7, 'eye'], [7, 7, 'eye'], [8, 7, 'white']];
}
const EYES: Record<string, Cell[]> = {
  shut: [[2, 7, 'eye'], [3, 7, 'eye'], [7, 7, 'eye'], [8, 7, 'eye']],
  squeeze: [[2, 7, 'eye'], [3, 6, 'eye'], [3, 8, 'eye'], [8, 7, 'eye'], [7, 6, 'eye'], [7, 8, 'eye']],
  happy: [[2, 7, 'eye'], [3, 6, 'eye'], [4, 7, 'eye'], [6, 7, 'eye'], [7, 6, 'eye'], [8, 7, 'eye']],
  heavy: [[2, 6, 'skinD'], [3, 6, 'skinD'], [3, 7, 'eye'], [7, 6, 'skinD'], [8, 6, 'skinD'], [7, 7, 'eye']],
  glare: [[2, 7, 'skinD'], [3, 7, 'eye'], [7, 7, 'eye'], [8, 7, 'skinD']],
  wide: [[2, 6, 'white'], [3, 6, 'white'], [2, 7, 'white'], [3, 7, 'eye'], [7, 6, 'white'], [8, 6, 'white'], [7, 7, 'eye'], [8, 7, 'white']],
};
const NOSE: Cell[] = [[5, 8, 'skinD']];
const MOUTH: Record<string, Cell[]> = {
  flat: [[4, 9, 'skinD'], [5, 9, 'mouth'], [6, 9, 'skinD']],
  smile: [[3, 8, 'mouth'], [4, 9, 'mouth'], [5, 9, 'mouth'], [6, 9, 'mouth'], [7, 8, 'mouth']],
  soft: [[4, 9, 'mouth'], [5, 9, 'mouth'], [6, 9, 'mouth']],
  sideways: [[6, 9, 'mouth'], [7, 9, 'mouth']],
  yawn: [[4, 9, 'mouth'], [5, 9, 'mouth'], [6, 9, 'mouth'], [4, 10, 'mouth'], [5, 10, 'tongue'], [6, 10, 'mouth']],
  wobble: [[3, 9, 'mouth'], [4, 10, 'mouth'], [5, 9, 'mouth'], [6, 10, 'mouth'], [7, 9, 'mouth']],
  grit: [[3, 9, 'mouth'], [4, 9, 'teeth'], [5, 9, 'teeth'], [6, 9, 'teeth'], [7, 9, 'mouth'], [4, 10, 'mouth'], [5, 10, 'mouth'], [6, 10, 'mouth']],
  o: [[5, 9, 'mouth'], [5, 10, 'mouth']],
  chatter: [[4, 9, 'teeth'], [5, 9, 'teeth'], [6, 9, 'teeth']],
  pant: [[4, 9, 'mouth'], [5, 9, 'mouth'], [6, 9, 'mouth'], [5, 10, 'tongue']],
};
const BLUSH: Cell[] = [[2, 8, 'blush'], [8, 8, 'blush']];

/** The front face for an expression, eyes turned towards `look`. */
export function frontFace(face: Face, look = 0): Cell[] {
  switch (face) {
    case 'blink': return [...brows('flat'), ...EYES.shut, ...NOSE, ...MOUTH.flat];
    case 'happy': return [...brows('up'), ...EYES.happy, ...NOSE, ...MOUTH.smile, ...BLUSH];
    case 'calm': return [...brows('flat'), ...EYES.shut, ...NOSE, ...MOUTH.soft];
    case 'think': return [...brows('quizzical'), ...openEyes(1), ...NOSE, ...MOUTH.sideways];
    case 'yawn': return [...brows('up'), ...EYES.squeeze, ...NOSE, ...MOUTH.yawn];
    case 'tired': return [...brows('flat'), ...EYES.heavy, ...NOSE, ...MOUTH.flat];
    case 'stressed': return [...brows('worried'), ...openEyes(look), ...NOSE, ...MOUTH.wobble];
    case 'mad': return [...brows('angry'), ...EYES.glare, ...NOSE, ...MOUTH.grit, ...BLUSH, [3, 8, 'blush'], [7, 8, 'blush']];
    case 'surprised': return [...brows('up'), ...EYES.wide, ...NOSE, ...MOUTH.o];
    case 'confused': return [...brows('quizzical'), ...openEyes(look), ...NOSE, ...MOUTH.sideways];
    case 'cold': return [...brows('worried'), ...openEyes(look), [5, 8, 'blush'], ...MOUTH.chatter];
    case 'hot': return [...brows('worried'), ...EYES.heavy, ...NOSE, ...MOUTH.pant, ...BLUSH];
    case 'strain': return [...brows('angry'), ...EYES.squeeze, ...NOSE, ...MOUTH.grit];
    case 'asleep': return [...brows('flat'), ...EYES.shut, ...NOSE, [5, 9, 'mouth']];
    default: return [...brows('flat'), ...openEyes(look), ...NOSE, ...MOUTH.flat];
  }
}

// Side face: brow on row 5 (raised row 4), eye at column 9 of row 7, nose tip
// at column 11 of row 8, mouth at columns 9 and 10 of rows 9 and 10.
const SIDE: Partial<Record<Face, Cell[]>> = {
  neutral: [[8, 5, 'hair'], [9, 5, 'hair'], [9, 7, 'eye'], [10, 7, 'white'], [9, 9, 'skinD'], [10, 9, 'mouth']],
  blink: [[8, 5, 'hair'], [9, 5, 'hair'], [9, 7, 'eye'], [10, 7, 'eye'], [9, 9, 'skinD'], [10, 9, 'mouth']],
  happy: [[8, 4, 'hair'], [9, 4, 'hair'], [9, 7, 'eye'], [10, 6, 'eye'], [9, 8, 'blush'], [9, 9, 'mouth'], [10, 9, 'mouth'], [10, 8, 'mouth']],
  calm: [[8, 5, 'hair'], [9, 5, 'hair'], [9, 7, 'eye'], [10, 7, 'eye'], [10, 9, 'mouth']],
  think: [[8, 4, 'hair'], [9, 4, 'hair'], [10, 6, 'eye'], [9, 9, 'mouth']],
  yawn: [[8, 4, 'hair'], [9, 4, 'hair'], [9, 7, 'eye'], [10, 7, 'eye'], [9, 9, 'mouth'], [10, 9, 'mouth'], [9, 10, 'tongue'], [10, 10, 'mouth']],
  tired: [[8, 5, 'hair'], [9, 5, 'hair'], [9, 6, 'skinD'], [10, 6, 'skinD'], [9, 7, 'eye'], [10, 9, 'skinD']],
  stressed: [[8, 4, 'hair'], [9, 5, 'hair'], [9, 7, 'eye'], [10, 7, 'white'], [9, 9, 'mouth'], [10, 10, 'mouth']],
  mad: [[8, 5, 'hair'], [9, 6, 'hair'], [9, 7, 'eye'], [10, 9, 'teeth'], [9, 9, 'mouth'], [9, 10, 'mouth'], [8, 8, 'blush'], [9, 8, 'blush']],
  surprised: [[8, 3, 'hair'], [9, 4, 'hair'], [9, 6, 'white'], [9, 7, 'eye'], [10, 7, 'white'], [10, 9, 'mouth'], [10, 10, 'mouth']],
  confused: [[8, 4, 'hair'], [9, 5, 'hair'], [9, 7, 'eye'], [10, 7, 'white'], [9, 9, 'mouth']],
  cold: [[8, 4, 'hair'], [9, 5, 'hair'], [9, 7, 'eye'], [10, 7, 'white'], [10, 9, 'teeth'], [11, 8, 'blush']],
  hot: [[8, 4, 'hair'], [9, 5, 'hair'], [9, 6, 'skinD'], [9, 7, 'eye'], [9, 8, 'blush'], [10, 9, 'mouth'], [10, 10, 'tongue']],
  strain: [[8, 5, 'hair'], [9, 6, 'hair'], [9, 7, 'eye'], [10, 7, 'eye'], [9, 9, 'mouth'], [10, 9, 'teeth']],
  asleep: [[8, 5, 'hair'], [9, 5, 'hair'], [9, 7, 'eye'], [10, 7, 'eye'], [10, 9, 'mouth']],
};

export function sideFace(face: Face): Cell[] {
  return SIDE[face] ?? SIDE.neutral!;
}
