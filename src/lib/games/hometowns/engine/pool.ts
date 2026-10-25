// The month's typed-array pool. A month step used to allocate about 140
// typed arrays (the space model, the coverage, travel and field planes, the
// utility grids), most of them 8–32 KB each: allocating, zeroing and later
// sweeping their backing stores was a tenth of a big town's month. Inside a
// pooled month (advanceTown's, which nothing outside the month can see) the
// arrays the month's own steps publish come from here instead and go back at
// the month's end, so the next town's month reuses them.
//
// Only for arrays whose life ends with the month: a slot on the month's
// blackboard (derived dies with the month step), a SpaceRun's model, or a
// working array. Never for anything a memo keeps (the road net, routes,
// footprints, decoded planes) or anything written into the town. Outside a
// pooled month (the exported monthStep that the wire's probe keeps the
// blackboard of, tests, pure queries, ticks) every call is a plain `new`.

type Pooled = Float64Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int8Array<ArrayBuffer> | Uint8Array<ArrayBuffer>;

interface Free<A extends Pooled> {
  /** Free arrays by length. */
  byLength: Map<number, A[]>;
  /** Arrays handed out in the open month. */
  used: A[];
}

const freeOf = <A extends Pooled>(): Free<A> => ({ byLength: new Map(), used: [] });
const F64 = freeOf<Float64Array<ArrayBuffer>>();
const I32 = freeOf<Int32Array<ArrayBuffer>>();
const I16 = freeOf<Int16Array<ArrayBuffer>>();
const I8 = freeOf<Int8Array<ArrayBuffer>>();
const U8 = freeOf<Uint8Array<ArrayBuffer>>();

let open = false;

function take<A extends Pooled>(pool: Free<A>, n: number, make: (n: number) => A): A {
  if (!open) return make(n);
  const list = pool.byLength.get(n);
  let a = list !== undefined ? list.pop() : undefined;
  if (a === undefined) a = make(n);
  else a.fill(0);
  pool.used.push(a);
  return a;
}

function give<A extends Pooled>(pool: Free<A>): void {
  const used = pool.used;
  for (let k = 0; k < used.length; k++) {
    const a = used[k];
    let list = pool.byLength.get(a.length);
    if (list === undefined) pool.byLength.set(a.length, (list = []));
    list.push(a);
  }
  used.length = 0;
}

const newF64 = (n: number) => new Float64Array(n);
const newI32 = (n: number) => new Int32Array(n);
const newI16 = (n: number) => new Int16Array(n);
const newI8 = (n: number) => new Int8Array(n);
const newU8 = (n: number) => new Uint8Array(n);

/** A zeroed Float64Array of length n: pooled inside a pooled month, else new. */
export const monthF64 = (n: number): Float64Array<ArrayBuffer> => take(F64, n, newF64);
export const monthI32 = (n: number): Int32Array<ArrayBuffer> => take(I32, n, newI32);
export const monthI16 = (n: number): Int16Array<ArrayBuffer> => take(I16, n, newI16);
export const monthI8 = (n: number): Int8Array<ArrayBuffer> => take(I8, n, newI8);
export const monthU8 = (n: number): Uint8Array<ArrayBuffer> => take(U8, n, newU8);

/** Is a pooled month open? */
export const monthPoolOpen = (): boolean => open;

/** Starts a pooled month (not reentrant: a pooled month never runs inside another). */
export function openMonthPool(): void {
  if (open) throw new Error('month pool is already open');
  open = true;
}

/** Ends the pooled month: everything handed out since openMonthPool is free again. */
export function closeMonthPool(): void {
  open = false;
  give(F64);
  give(I32);
  give(I16);
  give(I8);
  give(U8);
}
