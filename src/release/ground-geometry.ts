/**
 * Pure planar geometry for materializing the citywide ground release (Task T006).
 *
 * `../domain/ground.ts` owns identity and `./ground-release.ts` owns the
 * partition and the release document. Neither of them touches coordinates, and
 * neither may: the T005 contracts are deliberately geometry-free. This module is
 * the one place that cuts a source polygon into per-cell shares, and it states
 * the four numerical decisions that make the cut reproducible.
 *
 * 1. **Quantization is a disclosed lossy step, not a cleanup.** Coordinates are
 *    rounded to `GROUND_COORDINATE_DECIMALS` (7) decimal degrees, roughly 1.1 cm
 *    at this latitude, against a source whose planimetric accuracy is
 *    decimetre-scale. Rounding is `Math.round`, which ECMA-262 specifies
 *    exactly; nothing here uses a transcendental function, so every recorded
 *    number is reproducible bit-for-bit on any conforming engine.
 * 2. **Clipping is Sutherland-Hodgman against an axis-aligned rectangle, with
 *    no buffer.** A rectangle is convex, which is the only precondition
 *    Sutherland-Hodgman needs. Adjacent partition cells share identical
 *    boundary doubles, so a buffer — however small — would hand the same square
 *    metre to two cells and break the exactly-once ownership the ledger
 *    checksums depend on.
 * 3. **Holes are clipped separately and stay holes.** Sutherland-Hodgman is
 *    ring-local and orientation-preserving, so a hole clipped against the same
 *    rectangle remains a hole of the same polygon. It may come back touching the
 *    outer boundary, which is a degenerate-but-representable ring: this module
 *    MEASURES that (`ringSimplicityCensus`) and deliberately does not repair it.
 *    Repair changes geometry, and geometry that changed for an unrecorded reason
 *    is exactly what a provenance-preserving pipeline must not ship.
 * 4. **Shoelace areas are computed about a local origin.** Manhattan longitudes
 *    are near -74 and a roadbed polygon is around 1e-9 square degrees, so the
 *    naive cross-product sum loses the signal to catastrophic cancellation —
 *    absolute error near 1e-11 against a 1e-9 signal is a 1% area residual
 *    invented by the arithmetic. Translating each ring to its own first vertex
 *    is exact for nearby doubles and drops that error by ten orders of
 *    magnitude, which is what makes an area-conservation claim meaningful.
 *
 * Areas are in SQUARE DEGREES and are used only for RATIOS — clipped share
 * against source share. No square metre is claimed and no projection is applied,
 * because a ratio of co-located areas does not need one and a fabricated
 * projection would be a second unvalidated authority.
 */

/** Decimal degrees retained per coordinate. ~1.1 cm of longitude at this latitude. */
export const GROUND_COORDINATE_DECIMALS = 7 as const;

/** 10 ** GROUND_COORDINATE_DECIMALS, written out so no `Math.pow` enters a recorded value. */
export const GROUND_COORDINATE_SCALE = 10000000 as const;

/** One quantization step, in degrees. The most a shipped vertex can move. */
export const GROUND_COORDINATE_STEP = 1 / GROUND_COORDINATE_SCALE;

/** A GeoJSON position. Only the first two ordinates participate; Z is not carried. */
export type GroundPosition = readonly number[];

/** A GeoJSON LineString: an ordered, OPEN position list. Unlike a ring it does not close. */
export type GroundLine = readonly GroundPosition[];

/** A closed GeoJSON linear ring: first and last positions are equal. */
export type GroundRing = readonly GroundPosition[];

/** A GeoJSON polygon: outer ring first, then holes. */
export type GroundPolygon = readonly GroundRing[];

export interface GroundRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface GroundRingCensus {
  /** Rings inspected. */
  rings: number;
  /** Rings with at least one vertex repeated other than the closing vertex. */
  selfTouchingRings: number;
  /** Vertices whose incoming and outgoing edges are exactly collinear (zero cross product). */
  collinearVertices: number;
  /** Rings whose signed area is exactly zero. */
  zeroAreaRings: number;
}

/**
 * Rounds one ordinate to the shipped precision.
 *
 * `Math.round` is exactly specified (ties toward +Infinity), and the multiply,
 * round, divide sequence is three IEEE-754 operations with no library call, so
 * the result is identical on every conforming engine.
 */
export function quantizeCoordinate(value: number): number {
  return Math.round(value * GROUND_COORDINATE_SCALE) / GROUND_COORDINATE_SCALE;
}

/** Quantizes a position, dropping any ordinate beyond longitude and latitude. */
export function quantizePosition(position: GroundPosition): number[] {
  return [quantizeCoordinate(position[0]!), quantizeCoordinate(position[1]!)];
}

/**
 * Quantizes a ring and removes vertices that quantization made identical to
 * their predecessor.
 *
 * Collapsing exact duplicates is not a repair: two positions that round to the
 * same 1.1 cm cell are the same shipped vertex, and emitting it twice would
 * claim a zero-length edge the source never had. The closing vertex is always
 * restored, so the result is a closed ring or — if fewer than three distinct
 * vertices survive — an empty one.
 */
export function quantizeRing(ring: GroundRing): number[][] {
  const out: number[][] = [];
  for (const position of ring) {
    const quantized = quantizePosition(position);
    const previous = out[out.length - 1];
    if (previous && previous[0] === quantized[0] && previous[1] === quantized[1]) continue;
    out.push(quantized);
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
    else break;
  }
  if (out.length < 3) return [];
  out.push([out[0]![0]!, out[0]![1]!]);
  return out;
}

/**
 * Twice the signed shoelace area of a ring, about the ring's own first vertex.
 *
 * Returning the doubled value keeps the arithmetic to multiplies and adds; the
 * halving happens once in `ringSignedArea`. Positive is counter-clockwise.
 */
function doubleSignedArea(ring: GroundRing): number {
  if (ring.length < 4) return 0;
  const originX = ring[0]![0]!;
  const originY = ring[0]![1]!;
  let total = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const currentX = ring[index]![0]! - originX;
    const currentY = ring[index]![1]! - originY;
    const nextX = ring[index + 1]![0]! - originX;
    const nextY = ring[index + 1]![1]! - originY;
    total += currentX * nextY - nextX * currentY;
  }
  return total;
}

/** Signed area in square degrees. Positive is counter-clockwise. */
export function ringSignedArea(ring: GroundRing): number {
  return doubleSignedArea(ring) / 2;
}

/** Unsigned area in square degrees. */
export function ringArea(ring: GroundRing): number {
  const area = ringSignedArea(ring);
  return area < 0 ? -area : area;
}

/**
 * Net area of a polygon: outer ring minus holes, floored at zero.
 *
 * The floor matters. A hole clipped against a rectangle can, in a cell that lies
 * entirely inside the hole, come back covering the whole cell along with the
 * outer ring — the honest answer there is that the polygon covers none of the
 * cell, not that it covers a negative amount of it.
 */
export function polygonNetArea(polygon: GroundPolygon): number {
  if (polygon.length === 0) return 0;
  let net = ringArea(polygon[0]!);
  for (let index = 1; index < polygon.length; index += 1) net -= ringArea(polygon[index]!);
  return net > 0 ? net : 0;
}

/** Net area of a MultiPolygon. */
export function multiPolygonNetArea(polygons: readonly GroundPolygon[]): number {
  let total = 0;
  for (const polygon of polygons) total += polygonNetArea(polygon);
  return total;
}

/** Axis-aligned envelope of a MultiPolygon, or null when it has no positions. */
export function multiPolygonBounds(polygons: readonly GroundPolygon[]): GroundRect | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const position of ring) {
        const longitude = position[0]!;
        const latitude = position[1]!;
        if (longitude < west) west = longitude;
        if (longitude > east) east = longitude;
        if (latitude < south) south = latitude;
        if (latitude > north) north = latitude;
      }
    }
  }
  return Number.isFinite(west) && Number.isFinite(south) ? { west, south, east, north } : null;
}

/** True when two axis-aligned rectangles share more than a boundary line. */
export function rectsOverlap(left: GroundRect, right: GroundRect): boolean {
  return left.west < right.east && left.east > right.west && left.south < right.north && left.north > right.south;
}

/**
 * True when two axis-aligned rectangles share ANY point, boundaries included.
 *
 * The line prefilter needs this and the polygon prefilter must not have it. A
 * polygon that merely touches a cell's edge contributes no area there, so
 * `rectsOverlap`'s strict test correctly drops it. A LINE's envelope can be
 * degenerate — a perfectly north-south pavement edge has `west === east` — and
 * under the strict test such a feature would match no cell at all and vanish
 * from the release. Boundary-inclusive prefiltering also matches the
 * boundary-inclusive line clipper: a piece lying along a shared edge is kept by
 * both neighbours, and a piece that merely touches at one point clips to zero
 * length and is dropped downstream.
 */
export function rectsTouchOrOverlap(left: GroundRect, right: GroundRect): boolean {
  return left.west <= right.east && left.east >= right.west && left.south <= right.north && left.north >= right.south;
}

type Side = "west" | "east" | "south" | "north";

function inside(position: GroundPosition, rect: GroundRect, side: Side): boolean {
  if (side === "west") return position[0]! >= rect.west;
  if (side === "east") return position[0]! <= rect.east;
  if (side === "south") return position[1]! >= rect.south;
  return position[1]! <= rect.north;
}

/**
 * Where an edge meets one clip line.
 *
 * The clipped ordinate is assigned the boundary value EXACTLY rather than being
 * interpolated to it, so a vertex introduced on a shared cell edge carries the
 * identical double in both neighbouring cells. Only the free ordinate is
 * interpolated, with one division.
 */
function intersect(from: GroundPosition, to: GroundPosition, rect: GroundRect, side: Side): number[] {
  const fromX = from[0]!;
  const fromY = from[1]!;
  const toX = to[0]!;
  const toY = to[1]!;
  if (side === "west" || side === "east") {
    const boundary = side === "west" ? rect.west : rect.east;
    const span = toX - fromX;
    const ratio = span === 0 ? 0 : (boundary - fromX) / span;
    return [boundary, fromY + (toY - fromY) * ratio];
  }
  const boundary = side === "south" ? rect.south : rect.north;
  const span = toY - fromY;
  const ratio = span === 0 ? 0 : (boundary - fromY) / span;
  return [fromX + (toX - fromX) * ratio, boundary];
}

function clipAgainstSide(vertices: readonly GroundPosition[], rect: GroundRect, side: Side): number[][] {
  const out: number[][] = [];
  if (vertices.length === 0) return out;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const previous = vertices[(index + vertices.length - 1) % vertices.length]!;
    const currentInside = inside(current, rect, side);
    const previousInside = inside(previous, rect, side);
    if (currentInside) {
      if (!previousInside) out.push(intersect(previous, current, rect, side));
      out.push([current[0]!, current[1]!]);
    } else if (previousInside) {
      out.push(intersect(previous, current, rect, side));
    }
  }
  return out;
}

/**
 * Clips one closed ring against an axis-aligned rectangle.
 *
 * Boundary-inclusive on all four sides: a vertex exactly on the clip line stays.
 * That is what makes the cut lossless — a shared edge is retained by whichever
 * cell the ring's interior is actually on, and a ring that merely grazes the
 * rectangle comes back with zero area and is rejected by the caller's area test
 * rather than by a tolerance nobody measured.
 *
 * Returns a closed ring, or `[]` when nothing survives.
 */
export function clipRingToRect(ring: GroundRing, rect: GroundRect): number[][] {
  if (ring.length < 4) return [];
  // Work on the open ring; Sutherland-Hodgman treats the vertex list as cyclic.
  let vertices: readonly GroundPosition[] = ring.slice(0, ring.length - 1);
  for (const side of ["west", "east", "south", "north"] as const) {
    vertices = clipAgainstSide(vertices, rect, side);
    if (vertices.length === 0) return [];
  }
  if (vertices.length < 3) return [];
  const out = vertices.map((position) => [position[0]!, position[1]!]);
  out.push([out[0]![0]!, out[0]![1]!]);
  return out;
}

/**
 * Clips a polygon, keeping holes as holes.
 *
 * A polygon whose outer ring vanishes contributes nothing, so its holes are not
 * evaluated. A hole that vanishes simply stops being a hole in this cell, which
 * is correct: the hole was outside the rectangle.
 */
export function clipPolygonToRect(polygon: GroundPolygon, rect: GroundRect): number[][][] {
  if (polygon.length === 0) return [];
  const outer = clipRingToRect(polygon[0]!, rect);
  if (outer.length === 0) return [];
  const rings: number[][][] = [outer];
  for (let index = 1; index < polygon.length; index += 1) {
    const hole = clipRingToRect(polygon[index]!, rect);
    if (hole.length > 0) rings.push(hole);
  }
  return rings;
}

/** Clips a MultiPolygon, dropping polygons that fall entirely outside. */
export function clipMultiPolygonToRect(polygons: readonly GroundPolygon[], rect: GroundRect): number[][][][] {
  const out: number[][][][] = [];
  for (const polygon of polygons) {
    const clipped = clipPolygonToRect(polygon, rect);
    if (clipped.length > 0) out.push(clipped);
  }
  return out;
}

/** Quantizes a MultiPolygon, dropping rings and polygons that collapse. */
export function quantizeMultiPolygon(polygons: readonly GroundPolygon[]): number[][][][] {
  const out: number[][][][] = [];
  for (const polygon of polygons) {
    const outer = quantizeRing(polygon[0] ?? []);
    if (outer.length === 0) continue;
    const rings: number[][][] = [outer];
    for (let index = 1; index < polygon.length; index += 1) {
      const hole = quantizeRing(polygon[index]!);
      if (hole.length > 0) rings.push(hole);
    }
    out.push(rings);
  }
  return out;
}

/**
 * Whether a closed ring visits any position twice, other than its closing
 * vertex.
 *
 * The single authority for "self-touching", extracted from
 * `ringSimplicityCensus` so a consumer that must ACT on the condition — the
 * T007 renderer refuses to draw such a ring rather than repairing it — decides
 * it by exactly the same test the census counts it by. A second copy of this
 * comparison would let the measured number and the refused set drift apart.
 */
export function ringIsSelfTouching(ring: GroundRing): boolean {
  const open = ring.slice(0, ring.length - 1);
  const seen = new Set<string>();
  for (const position of open) {
    const key = `${position[0]!},${position[1]!}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/** Whether any ring of a polygon is self-touching. Holes count: they are rings. */
export function polygonIsSelfTouching(polygon: GroundPolygon): boolean {
  return polygon.some((ring) => ringIsSelfTouching(ring));
}

// ---------------------------------------------------------------------------
// Linework (T009)
//
// Curbs are LINES, and Sutherland-Hodgman is a polygon algorithm: it treats its
// vertex list as cyclic and would close a curb into a ring. The line clipper
// below is Liang-Barsky, PORTED from `../ingestion/route-graph-snapshot.ts`
// (`clipSegment`, lines 66-73) rather than written a third time. That module is
// deliberately left untouched: it is a shipped ingestion path, and its `Bounds`
// type is structurally identical to `GroundRect` but privately declared, so the
// port is a retyping of proven arithmetic, not a new algorithm.
//
// ONE behaviour is deliberately NOT ported. `clipLine` there concatenates the
// surviving pieces of a polyline into a single output line, which draws a
// connector across whatever fell outside the rectangle. For a routing graph that
// preserves connectivity; for a curb it would INVENT pavement edge the source
// never recorded. `clipLineToRect` therefore returns the surviving pieces as
// separate lines and never bridges a gap.
// ---------------------------------------------------------------------------

/**
 * Clips one segment against an axis-aligned rectangle (Liang-Barsky).
 *
 * Boundary-inclusive: `p === 0 && q >= 0` keeps a segment that runs exactly
 * along a clip line, so a curb lying on a shared cell edge is retained by BOTH
 * neighbouring cells. That is a measured, disclosed duplication, not a defect to
 * silence — a curb has no interior with which to decide which side owns it, and
 * dropping it from one side would delete real linework at a cell seam.
 *
 * Returns `null` when nothing survives.
 */
export function clipSegmentToRect(from: GroundPosition, to: GroundPosition, rect: GroundRect): [number[], number[]] | null {
  const fromX = from[0]!;
  const fromY = from[1]!;
  const deltaX = to[0]! - fromX;
  const deltaY = to[1]! - fromY;
  let enter = 0;
  let exit = 1;
  const constraints: readonly (readonly [number, number])[] = [
    [-deltaX, fromX - rect.west],
    [deltaX, rect.east - fromX],
    [-deltaY, fromY - rect.south],
    [deltaY, rect.north - fromY],
  ];
  for (const [p, q] of constraints) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > exit) return null;
      if (ratio > enter) enter = ratio;
    } else {
      if (ratio < enter) return null;
      if (ratio < exit) exit = ratio;
    }
  }
  return [
    [fromX + enter * deltaX, fromY + enter * deltaY],
    [fromX + exit * deltaX, fromY + exit * deltaY],
  ];
}

/**
 * Clips one open polyline, returning the surviving pieces in source order.
 *
 * Consecutive clipped segments are joined only when the previous piece ENDS
 * exactly where the next begins, which is the case whenever both endpoints were
 * inside; a line that leaves the rectangle and returns produces two pieces. A
 * piece that collapses to a single point (a segment grazing a corner) is
 * dropped: a zero-length curb is not linework.
 */
export function clipLineToRect(line: GroundLine, rect: GroundRect): number[][][] {
  const pieces: number[][][] = [];
  let current: number[][] | null = null;
  for (let index = 1; index < line.length; index += 1) {
    const segment = clipSegmentToRect(line[index - 1]!, line[index]!, rect);
    if (!segment) {
      current = null;
      continue;
    }
    const [start, end] = segment;
    const last = current ? current[current.length - 1]! : null;
    if (last && last[0] === start[0]! && last[1] === start[1]!) {
      if (last[0] !== end[0]! || last[1] !== end[1]!) current!.push([end[0]!, end[1]!]);
      continue;
    }
    if (start[0]! === end[0]! && start[1]! === end[1]!) {
      current = null;
      continue;
    }
    current = [
      [start[0]!, start[1]!],
      [end[0]!, end[1]!],
    ];
    pieces.push(current);
  }
  return pieces.filter((piece) => piece.length >= 2);
}

/** Clips a MultiLineString, flattening each line's surviving pieces into the result. */
export function clipMultiLineStringToRect(lines: readonly GroundLine[], rect: GroundRect): number[][][] {
  const out: number[][][] = [];
  for (const line of lines) for (const piece of clipLineToRect(line, rect)) out.push(piece);
  return out;
}

/**
 * Quantizes an open line, dropping vertices that rounding made identical to
 * their predecessor.
 *
 * Same rule as `quantizeRing`, minus the closing vertex: two positions that
 * round to the same 1.1 cm cell are the same shipped vertex. Returns `[]` when
 * fewer than two distinct vertices survive, because a one-point line is not
 * linework and recording it would claim a curb with no extent.
 */
export function quantizeLine(line: GroundLine): number[][] {
  const out: number[][] = [];
  for (const position of line) {
    const quantized = quantizePosition(position);
    const previous = out[out.length - 1];
    if (previous && previous[0] === quantized[0] && previous[1] === quantized[1]) continue;
    out.push(quantized);
  }
  return out.length < 2 ? [] : out;
}

/** Quantizes a MultiLineString, dropping lines that collapse below two vertices. */
export function quantizeMultiLineString(lines: readonly GroundLine[]): number[][][] {
  const out: number[][][] = [];
  for (const line of lines) {
    const quantized = quantizeLine(line);
    if (quantized.length > 0) out.push(quantized);
  }
  return out;
}

/** Axis-aligned envelope of a MultiLineString, or null when it has no positions. */
export function multiLineStringBounds(lines: readonly GroundLine[]): GroundRect | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const line of lines) {
    for (const position of line) {
      const longitude = position[0]!;
      const latitude = position[1]!;
      if (longitude < west) west = longitude;
      if (longitude > east) east = longitude;
      if (latitude < south) south = latitude;
      if (latitude > north) north = latitude;
    }
  }
  return Number.isFinite(west) && Number.isFinite(south) ? { west, south, east, north } : null;
}

/**
 * L1 (taxicab) length in degrees. Adds only; no square root.
 *
 * This is NOT a distance and no metre is claimed by it. It exists for one
 * purpose: the clip-conservation RATIO, where the per-cell pieces of a line must
 * sum back to the source line's length inside the coverage rectangle. L1 is the
 * right tool for that and Euclidean length is the wrong one — clipping splits a
 * segment at a point ON the segment, along which x and y are each monotone, so
 * |dx| and |dy| are exactly additive across the split, while `Math.sqrt` is
 * implementation-approximated in ECMA-262 and would put an engine-dependent
 * number into a recorded measurement. `../release/ground-geometry.ts` records no
 * transcendental result anywhere, and this keeps that true.
 */
export function lineL1Length(line: GroundLine): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    const deltaX = line[index]![0]! - line[index - 1]![0]!;
    const deltaY = line[index]![1]! - line[index - 1]![1]!;
    total += (deltaX < 0 ? -deltaX : deltaX) + (deltaY < 0 ? -deltaY : deltaY);
  }
  return total;
}

/** L1 length of a MultiLineString, in degrees. See `lineL1Length`. */
export function multiLineStringL1Length(lines: readonly GroundLine[]): number {
  let total = 0;
  for (const line of lines) total += lineL1Length(line);
  return total;
}

/**
 * Whether every position of a MultiLineString lies exactly on one edge of the
 * rectangle.
 *
 * Such a piece is retained by both cells that share the edge (see
 * `clipSegmentToRect`). Counting them is how the duplication stays a measured
 * number instead of an unnoticed one.
 */
export function multiLineStringLiesOnRectEdge(lines: readonly GroundLine[], rect: GroundRect): boolean {
  let any = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    any = true;
    const x = line[0]![0]!;
    const y = line[0]![1]!;
    const onVerticalEdge = (x === rect.west || x === rect.east) && line.every((position) => position[0]! === x);
    const onHorizontalEdge = (y === rect.south || y === rect.north) && line.every((position) => position[1]! === y);
    if (!onVerticalEdge && !onHorizontalEdge) return false;
  }
  return any;
}

/**
 * Counts the degeneracies a rectangle clip is known to introduce.
 *
 * This is instrumentation, not a gate. Sutherland-Hodgman on a concave ring can
 * emit a ring that touches itself along the clip line, and it routinely emits
 * collinear vertices there. Both are recorded so the size of the problem is a
 * measured number before anything is written to repair it.
 */
export function ringSimplicityCensus(polygons: readonly GroundPolygon[], into?: GroundRingCensus): GroundRingCensus {
  const census: GroundRingCensus = into ?? { rings: 0, selfTouchingRings: 0, collinearVertices: 0, zeroAreaRings: 0 };
  for (const polygon of polygons) {
    for (const ring of polygon) {
      census.rings += 1;
      if (ringSignedArea(ring) === 0) census.zeroAreaRings += 1;
      const open = ring.slice(0, ring.length - 1);
      if (ringIsSelfTouching(ring)) census.selfTouchingRings += 1;
      for (let index = 0; index < open.length; index += 1) {
        const previous = open[(index + open.length - 1) % open.length]!;
        const current = open[index]!;
        const next = open[(index + 1) % open.length]!;
        const firstX = current[0]! - previous[0]!;
        const firstY = current[1]! - previous[1]!;
        const secondX = next[0]! - current[0]!;
        const secondY = next[1]! - current[1]!;
        if (firstX * secondY - secondX * firstY === 0) census.collinearVertices += 1;
      }
    }
  }
  return census;
}
