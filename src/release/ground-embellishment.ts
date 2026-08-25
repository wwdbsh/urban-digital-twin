/**
 * Curb embellishment derivation, generalized from Block 835 (Task T009).
 *
 * The Block 835 public-realm release (`scripts/block835-public-realm-cli.mjs`,
 * `normalize`, lines 425-445) already derives curbs from NYC OTI Pavement Edge
 * linework for ONE block. This module is that same derivation with the block
 * removed: the same algorithm label, the same vertical profile, the same claim
 * level, the same "geometry is the source's own alignment, verbatim" rule — now
 * expressed over an arbitrary set of rectangles so the citywide partition can
 * use it. `src/release/ground-embellishment.test.ts` runs it over the Block 835
 * extent and asserts record-level equivalence with the promoted release, which
 * is what makes "generalized" a checked claim rather than an intention.
 *
 * Four decisions are load-bearing:
 *
 * 1. **A curb is estimated, and the type says so.** `claimLevel` is the literal
 *    `"estimated"`, not a `GroundClaimLevel`, so a source-backed curb cannot be
 *    constructed here any more than it can be validated in `../domain/ground.ts`.
 *    Pavement edge constrains the horizontal ALIGNMENT only; the 0.22 m rise is
 *    authored, and nothing in this pipeline has seen a curb.
 * 2. **No geometry is invented.** The shipped alignment is the source polyline,
 *    clipped to a rectangle and rounded to the shipped precision, and nothing
 *    else: no offsetting, no smoothing, no ribbon extrusion, no joining across a
 *    gap. The 3D curb a renderer draws is built FROM this alignment plus the
 *    declared profile, at render time; baking a solid here would freeze an
 *    estimate into the release as if it were geometry.
 * 3. **Two-level identity, content-addressed.** One canonical feature per source
 *    pavement-edge record, minted from the source geometry and properties, with
 *    one part per rectangle it genuinely reaches. Pavement Edge `source_id` is
 *    NOT unique (43,855 distinct values across 45,129 citywide rows), so an
 *    id minted from it would collide; a content address cannot, and a genuine
 *    content collision is a hard failure for the caller rather than a merge.
 * 4. **Length conservation is the line analogue of area conservation.** The
 *    per-rectangle pieces of a line must sum back to the source line's length
 *    inside the covered area. `lineL1Length` is used for it, for the reasons
 *    given there; the caller gates on the residual.
 */

import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS } from "./exterior-serving-release.ts";
import {
  clipMultiLineStringToRect,
  multiLineStringBounds,
  multiLineStringL1Length,
  multiLineStringLiesOnRectEdge,
  quantizeMultiLineString,
  rectsTouchOrOverlap,
  type GroundLine,
  type GroundRect,
} from "./ground-geometry.ts";

/**
 * The derivation label Block 835 published, reused verbatim.
 *
 * Reused rather than versioned upward because the derivation IS the same one: a
 * new label would claim a change this task did not make, and would break the
 * equivalence the fixture test asserts.
 */
export const CURB_DERIVATION_ALGORITHM = "pavement-edge-constrained-curb-v1" as const;

/** The Pavement Edge dataset this derivation is constrained by. */
export const CURB_INPUT_DATASET_ID = "x9uq-u3qs" as const;

/**
 * The authored curb profile, byte-identical to Block 835's.
 *
 * `scripts/block835-public-realm-cli.mjs:441-445` writes
 * `{ topElevationMeters: 0.22, roadbedElevationMeters: 0, authoredRiseMeters: 0.22, profileIsEstimated: true }`
 * on every curb record it emits. The values are an authored estimate of a
 * typical New York curb reveal; no source in this pipeline measures curb height,
 * which is exactly why `profileIsEstimated` travels with them and why the
 * embellishment claim ceiling may never say otherwise.
 */
export const CURB_VERTICAL_PROFILE = Object.freeze({
  topElevationMeters: 0.22,
  roadbedElevationMeters: 0,
  authoredRiseMeters: 0.22,
  profileIsEstimated: true,
});

/**
 * The uncertainty Block 835 attaches to a curb, reused verbatim.
 *
 * Horizontal 0.25 m is the planimetric tolerance of the pavement-edge source;
 * vertical 0.1 m is the authored profile's own honesty, not a measurement.
 */
export const CURB_UNCERTAINTY = Object.freeze({
  horizontalMeters: 0.25,
  verticalMeters: 0.1,
  temporal: "Pavement edge constrains horizontal alignment; curb vertical profile is authored estimate, not survey truth.",
});

/**
 * Where a curb stops being drawn, in metres.
 *
 * NOT a new number. It is the live exterior serving near ring
 * (`EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS`, 400 m in
 * `./exterior-serving-release.ts:451`), which `src/app/App.tsx:2620` already
 * uses to decide which cells are in the near ring at all. A curb is a near-field
 * detail layered over buildings that are themselves only detailed inside that
 * ring, so an embellishment ring wider than the building near ring would be
 * detail with nothing to sit next to, and a narrower one would be a second,
 * unexplained distance policy. Aliased rather than restated so raising the
 * exterior ring cannot leave this behind.
 *
 * DRIFT CHECK: `./ground-embellishment.test.ts` asserts this identity, so
 * copying the literal 400 here in future would fail the suite.
 *
 * This module, not `./ground-release.ts`, is where the alias lives: the T005
 * contract module deliberately carries no dependency on the building pipeline
 * (see its header), and a materialization helper may depend on both.
 */
export const GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS = EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS;

/** One source pavement-edge record, read verbatim from a pinned snapshot. */
export interface CurbSourceFeature {
  /** The source's own record id, kept in whatever spelling the snapshot used. */
  sourceRecordId: string;
  /** Source properties, verbatim: they participate in the content address. */
  properties: Record<string, unknown>;
  /** Source MultiLineString coordinates, verbatim and unrounded. */
  lines: readonly GroundLine[];
}

/** A rectangle the derivation may assign a share to: a partition cell, or any other extent. */
export interface CurbTargetRect {
  id: string;
  bounds: GroundRect;
}

/** One canonical curb's share of exactly one rectangle. */
export interface CurbPart {
  rectId: string;
  /** False when the whole source feature fits inside this rectangle and passed through. */
  clipped: boolean;
  /** Shipped alignment: clipped, then rounded to the shipped precision. */
  lines: number[][][];
  /** Every piece runs along one edge of this rectangle, so a neighbour holds it too. */
  boundaryCoincident: boolean;
  /** L1 degrees before rounding. Used for the clip-conservation residual only. */
  clippedL1Length: number;
  /** L1 degrees after rounding. Reported; rounding legitimately changes it. */
  quantizedL1Length: number;
}

/** The derivation record that travels with every curb, in the artifact and in the report. */
export interface CurbDerivationRecord {
  algorithm: typeof CURB_DERIVATION_ALGORITHM;
  inputDataset: typeof CURB_INPUT_DATASET_ID;
  inputSourceFeatureId: string;
  profile: typeof CURB_VERTICAL_PROFILE;
}

export interface CurbDerivation {
  canonicalFeatureId: string;
  sourceRecordId: string;
  claimLevel: "estimated";
  derivation: CurbDerivationRecord;
  sourceBounds: GroundRect;
  /** L1 degrees of the source alignment, in full. */
  sourceL1Length: number;
  parts: CurbPart[];
  /** Rectangles whose envelope overlapped but whose geometry the line never reached. */
  droppedCandidateRects: number;
}

/**
 * The content address of one curb.
 *
 * Hashes the source geometry and properties exactly as
 * `scripts/manhattan-ground-build-cli.mjs` hashes a polygon feature, so the two
 * halves of the ground family mint identity the same way. The class segment is
 * part of the id, so a curb and a hypothetical crosswalk over the same linework
 * are different identities.
 */
export function curbCanonicalFeatureId(citySlug: string, source: CurbSourceFeature): string {
  const digest = sha256HexSync(
    stableSerialize({
      geometry: { type: "MultiLineString", coordinates: source.lines },
      properties: source.properties,
    }),
  ).slice(0, 16);
  return `udt:ground:${citySlug}:curb:${digest}`;
}

/** The derivation record for one source feature. */
export function curbDerivationRecord(source: CurbSourceFeature): CurbDerivationRecord {
  return {
    algorithm: CURB_DERIVATION_ALGORITHM,
    inputDataset: CURB_INPUT_DATASET_ID,
    inputSourceFeatureId: source.sourceRecordId,
    profile: CURB_VERTICAL_PROFILE,
  };
}

function rectContains(inner: GroundRect, outer: GroundRect): boolean {
  return inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;
}

/**
 * Derives one canonical curb and its per-rectangle parts.
 *
 * Throws when the source has no positions: a pavement-edge row with no geometry
 * is a source defect the caller must see, not a curb with an empty alignment.
 * A source that reaches none of the rectangles returns zero parts, which the
 * caller records as a refusal — this function refuses to decide what "outside
 * the world" means on the caller's behalf.
 */
export function deriveCurb(citySlug: string, source: CurbSourceFeature, rects: readonly CurbTargetRect[]): CurbDerivation {
  const sourceBounds = multiLineStringBounds(source.lines);
  if (sourceBounds === null) {
    throw new Error(`Pavement-edge record ${source.sourceRecordId} has no positions; a curb cannot be derived from it.`);
  }
  const candidates = rects.filter((rect) => rectsTouchOrOverlap(sourceBounds, rect.bounds));
  // Containment, not "exactly one candidate": an envelope may overlap one
  // rectangle while extending past it, and shipping that unclipped would put
  // linework outside the cell that owns it. Mirrors the same decision in
  // `scripts/manhattan-ground-build-cli.mjs`.
  const contained = candidates.length === 1 && rectContains(sourceBounds, candidates[0]!.bounds);

  const parts: CurbPart[] = [];
  let droppedCandidateRects = 0;
  for (const rect of candidates) {
    const clippedLines = contained ? source.lines.map((line) => line.map((position) => [position[0]!, position[1]!])) : clipMultiLineStringToRect(source.lines, rect.bounds);
    if (clippedLines.length === 0) {
      droppedCandidateRects += 1;
      continue;
    }
    const shipped = quantizeMultiLineString(clippedLines);
    if (shipped.length === 0) {
      droppedCandidateRects += 1;
      continue;
    }
    parts.push({
      rectId: rect.id,
      clipped: !contained,
      lines: shipped,
      boundaryCoincident: multiLineStringLiesOnRectEdge(shipped, rect.bounds),
      clippedL1Length: multiLineStringL1Length(clippedLines),
      quantizedL1Length: multiLineStringL1Length(shipped),
    });
  }

  return {
    canonicalFeatureId: curbCanonicalFeatureId(citySlug, source),
    sourceRecordId: source.sourceRecordId,
    claimLevel: "estimated",
    derivation: curbDerivationRecord(source),
    sourceBounds,
    sourceL1Length: multiLineStringL1Length(source.lines),
    parts,
    droppedCandidateRects,
  };
}
