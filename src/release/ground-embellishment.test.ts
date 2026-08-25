import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS } from "./exterior-serving-release.ts";
import {
  CURB_DERIVATION_ALGORITHM,
  CURB_INPUT_DATASET_ID,
  CURB_UNCERTAINTY,
  CURB_VERTICAL_PROFILE,
  GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS,
  curbCanonicalFeatureId,
  deriveCurb,
  type CurbSourceFeature,
  type CurbTargetRect,
} from "./ground-embellishment.ts";
import { GROUND_COORDINATE_STEP, multiLineStringL1Length, quantizeMultiLineString } from "./ground-geometry.ts";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { GROUND_BASE_CLASSES, GROUND_OWNED_FEATURE_ID_PATTERN } from "../domain/ground.ts";
import { validateGroundReleaseGraph } from "./ground-release.ts";

/**
 * Paths are repo-relative, as everywhere else in `src/**`: the app tsconfig
 * types neither `node:path` nor `import.meta.dirname`, and vitest runs from the
 * repository root. `src/node-fs.d.ts` types `readFileSync` as bytes only, so
 * decoding is explicit too.
 */
function readJson<T>(path: string): T {
  return JSON.parse(new TextDecoder().decode(readFileSync(path))) as T;
}

function source(overrides: Partial<CurbSourceFeature> = {}): CurbSourceFeature {
  return {
    sourceRecordId: "12226000354",
    properties: { source_id: "12226000354", feat_code: "2260" },
    lines: [
      [
        [0.5, 0.5],
        [2.5, 0.5],
      ],
    ],
    ...overrides,
  };
}

const LEFT: CurbTargetRect = { id: "left", bounds: { west: 0, south: 0, east: 1, north: 1 } };
const RIGHT: CurbTargetRect = { id: "right", bounds: { west: 1, south: 0, east: 3, north: 1 } };

describe("curb derivation constants", () => {
  it("aliases the live exterior near ring instead of restating a distance", () => {
    expect(GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS).toBe(EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS);
  });

  it("carries the Block 835 vertical profile, values and all", () => {
    expect(CURB_VERTICAL_PROFILE).toEqual({
      topElevationMeters: 0.22,
      roadbedElevationMeters: 0,
      authoredRiseMeters: 0.22,
      profileIsEstimated: true,
    });
    expect(Object.isFrozen(CURB_VERTICAL_PROFILE)).toBe(true);
    expect(CURB_DERIVATION_ALGORITHM).toBe("pavement-edge-constrained-curb-v1");
    expect(CURB_INPUT_DATASET_ID).toBe("x9uq-u3qs");
  });
});

describe("curb identity", () => {
  it("mints a ground-owned id that names its own class", () => {
    const id = curbCanonicalFeatureId("manhattan", source());
    const match = GROUND_OWNED_FEATURE_ID_PATTERN.exec(id);
    expect(match?.[1]).toBe("manhattan");
    expect(match?.[2]).toBe("curb");
    expect(id).toBe(curbCanonicalFeatureId("manhattan", source()));
  });

  it("separates identities that differ only in geometry or only in properties", () => {
    const base = curbCanonicalFeatureId("manhattan", source());
    const movedGeometry = curbCanonicalFeatureId("manhattan", source({ lines: [[[0.5, 0.5], [2.5, 0.6]]] }));
    const otherProperties = curbCanonicalFeatureId("manhattan", source({ properties: { source_id: "12226000354", feat_code: "2261" } }));
    expect(new Set([base, movedGeometry, otherProperties]).size).toBe(3);
  });

  it("does not depend on the source record id, which pavement edge does not keep unique", () => {
    expect(curbCanonicalFeatureId("manhattan", source({ sourceRecordId: "0" }))).toBe(curbCanonicalFeatureId("manhattan", source()));
  });
});

describe("curb derivation over rectangles", () => {
  it("passes a contained feature through unclipped", () => {
    const derived = deriveCurb("manhattan", source({ lines: [[[0.25, 0.5], [0.75, 0.5]]] }), [LEFT, RIGHT]);
    expect(derived.parts).toHaveLength(1);
    expect(derived.parts[0]!.clipped).toBe(false);
    expect(derived.parts[0]!.lines).toEqual([[[0.25, 0.5], [0.75, 0.5]]]);
    expect(derived.claimLevel).toBe("estimated");
  });

  it("splits a spanning feature and conserves L1 length across the parts", () => {
    const derived = deriveCurb("manhattan", source(), [LEFT, RIGHT]);
    expect(derived.parts.map((part) => part.rectId)).toEqual(["left", "right"]);
    expect(derived.parts.every((part) => part.clipped)).toBe(true);
    const clipped = derived.parts.reduce((total, part) => total + part.clippedL1Length, 0);
    expect(clipped).toBe(derived.sourceL1Length);
  });

  it("returns no part for a feature that reaches no rectangle", () => {
    const derived = deriveCurb("manhattan", source({ lines: [[[10, 10], [11, 11]]] }), [LEFT, RIGHT]);
    expect(derived.parts).toEqual([]);
  });

  it("flags a piece that runs along a shared edge, because both cells keep it", () => {
    const derived = deriveCurb("manhattan", source({ lines: [[[1, 0.25], [1, 0.75]]] }), [LEFT, RIGHT]);
    expect(derived.parts).toHaveLength(2);
    expect(derived.parts.every((part) => part.boundaryCoincident)).toBe(true);
  });

  it("refuses a source with no positions rather than emitting an empty curb", () => {
    expect(() => deriveCurb("manhattan", source({ lines: [] }), [LEFT])).toThrow(/no positions/u);
  });

  it("carries the profile and the input record id on every derivation record", () => {
    const derived = deriveCurb("manhattan", source(), [LEFT, RIGHT]);
    expect(derived.derivation).toEqual({
      algorithm: CURB_DERIVATION_ALGORITHM,
      inputDataset: CURB_INPUT_DATASET_ID,
      inputSourceFeatureId: "12226000354",
      profile: CURB_VERTICAL_PROFILE,
    });
  });
});

/**
 * The equivalence claim, checked against the promoted Block 835 release.
 *
 * "Generalized" is only meaningful if the general derivation still produces the
 * block's own curbs. The fixture reads the pinned Block 835 raw pavement-edge
 * snapshot (checksum-verified against that release's own raw manifest), runs the
 * citywide derivation over the block's clip rectangle, and compares every record
 * against `public/data/manhattan-esb-block-public-realm-20260806/curbs.json`.
 *
 * Two differences are EXPECTED and are asserted as such rather than papered
 * over:
 *
 *  - Geometry: Block 835 ships full source precision; the ground family rounds
 *    to `GROUND_COORDINATE_DECIMALS`. Equivalence is therefore against the
 *    promoted geometry PUT THROUGH the same rounding, plus a bound proving no
 *    vertex moved more than half a step.
 *  - Record id spelling: Block 835 strips a trailing ".0" from `source_id`; the
 *    ground family keeps the snapshot's own spelling, as T006 does for roadbed.
 *    The comparison strips it explicitly so the difference is visible.
 *
 * Nothing here writes: the promoted release is read-only in this test, and its
 * bytes are proven unchanged by the CLI's own byte-identity check.
 */
describe("Block 835 curb equivalence", () => {
  const blockRoot = "data/raw/manhattan-esb-block-public-realm-20260806";
  const promotedRoot = "public/data/manhattan-esb-block-public-realm-20260806";

  it("reproduces every promoted Block 835 curb record from the same pinned snapshot", () => {
    const manifest = readJson<{
      clip: { clipBounds: { west: number; south: number; east: number; north: number } };
      sourceSnapshots: { datasetId: string; rawRelativePath: string; rawSha256: string; featureCount: number }[];
    }>(`${blockRoot}/manifest.json`);
    const snapshot = manifest.sourceSnapshots.find((entry) => entry.datasetId === CURB_INPUT_DATASET_ID);
    expect(snapshot).toBeDefined();
    const rawBytes = readFileSync(`${blockRoot}/${snapshot!.rawRelativePath}`);
    expect(sha256HexBytes(rawBytes)).toBe(snapshot!.rawSha256);

    const rows = (JSON.parse(new TextDecoder().decode(rawBytes)) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: number[][][] } }[] }).features;
    expect(rows).toHaveLength(snapshot!.featureCount);

    const promoted = readJson<{
      features: {
        sourceFeatureIndex: number;
        sourceFeatureId: string;
        claimLevel: string;
        derivation: { algorithm: string; inputDataset: string; inputSourceFeatureId: string; profile: Record<string, unknown> };
        uncertainty: Record<string, unknown>;
        geometry: { type: string; coordinates: number[][][] };
        sourceGeometry: { type: string; coordinates: number[][][] };
      }[];
    }>(`${promotedRoot}/curbs.json`).features;
    expect(promoted).toHaveLength(rows.length);

    const rect: CurbTargetRect = { id: "block-835", bounds: manifest.clip.clipBounds };
    const promotedByIndex = new Map(promoted.map((record) => [record.sourceFeatureIndex, record]));
    const seen = new Set<string>();

    rows.forEach((row, index) => {
      const record = promotedByIndex.get(index);
      expect(record, `promoted release has no curb for source row ${index}`).toBeDefined();
      const derived = deriveCurb("manhattan", { sourceRecordId: String(row.properties.source_id), properties: row.properties, lines: row.geometry.coordinates }, [rect]);

      // One identity per source record, and no two source records collide.
      expect(seen.has(derived.canonicalFeatureId)).toBe(false);
      seen.add(derived.canonicalFeatureId);

      // Claim level, derivation label, input dataset, profile: identical.
      expect(derived.claimLevel).toBe(record!.claimLevel);
      expect(derived.derivation.algorithm).toBe(record!.derivation.algorithm);
      expect(derived.derivation.inputDataset).toBe(record!.derivation.inputDataset);
      expect(derived.derivation.profile).toEqual(record!.derivation.profile);
      expect(CURB_UNCERTAINTY).toEqual(record!.uncertainty);
      expect(derived.derivation.inputSourceFeatureId.replace(/\.0$/u, "")).toBe(record!.derivation.inputSourceFeatureId);
      expect(derived.sourceRecordId.replace(/\.0$/u, "")).toBe(record!.sourceFeatureId);

      // Block 835 keeps the source alignment verbatim; so does this, modulo the
      // ground family's disclosed rounding.
      expect(record!.geometry).toEqual(record!.sourceGeometry);
      expect(derived.parts).toHaveLength(1);
      expect(derived.parts[0]!.clipped).toBe(false);
      expect(derived.parts[0]!.lines).toEqual(quantizeMultiLineString(record!.geometry.coordinates));

      // No vertex moved further than half a rounding step, and the alignment
      // kept every distinct vertex the source had.
      const sourceLines = record!.geometry.coordinates;
      derived.parts[0]!.lines.forEach((line, lineIndex) => {
        expect(line).toHaveLength(sourceLines[lineIndex]!.length);
        line.forEach((position, positionIndex) => {
          expect(Math.abs(position[0]! - sourceLines[lineIndex]![positionIndex]![0]!)).toBeLessThanOrEqual(GROUND_COORDINATE_STEP / 2);
          expect(Math.abs(position[1]! - sourceLines[lineIndex]![positionIndex]![1]!)).toBeLessThanOrEqual(GROUND_COORDINATE_STEP / 2);
        });
      });

      // Rounding changes length; it must not change it by more than the vertex
      // count times one step, which is the arithmetic bound of the operation.
      const vertices = sourceLines.reduce((total, line) => total + line.length, 0);
      expect(Math.abs(derived.parts[0]!.quantizedL1Length - multiLineStringL1Length(sourceLines))).toBeLessThanOrEqual(vertices * GROUND_COORDINATE_STEP);
    });

    expect(seen.size).toBe(rows.length);
  });
});

/**
 * T009 regression: the shipped flat release is untouched.
 *
 * The tier amendment changed a rule every ground release passes through, so the
 * one already published has to be re-validated against the amended contract, not
 * assumed compatible. `public/data` is gitignored, so this runs wherever the T006
 * release is materialized and is skipped — visibly, by name — where it is not.
 */
const T006_ROOT = "public/data/manhattan-ground-20260824";
const T006_PRESENT = existsSync(`${T006_ROOT}/release.json`);

describe("shipped flat ground release (skipped when public/data/manhattan-ground-20260824 is not materialized)", () => {
  it.skipIf(!T006_PRESENT)("still validates unchanged under the amended tier contract", () => {
    const read = (name: string): unknown => readJson<unknown>(`${T006_ROOT}/${name}`);
    const document = read("release.json") as { releaseId: string; assets: { class: string; tiers: { kind: string; maxDistanceMeters: number | null }[] }[] };
    const result = validateGroundReleaseGraph({ ledger: read("ledger.json"), document, features: read("features.json"), parts: read("parts.json") });
    expect(result.ok, result.ok ? "" : result.issues.slice(0, 4).map((issue) => `${issue.path}: ${issue.message}`).join("; ")).toBe(true);
    expect(document.releaseId).toBe("manhattan-ground-20260824");
    // Every asset in it is still a flat base class with one unbounded tier: the
    // amendment gave embellishments a different rule, it did not relax this one.
    for (const asset of document.assets) {
      expect(GROUND_BASE_CLASSES).toContain(asset.class);
      expect(asset.tiers.filter((tier) => tier.kind === "flat" && tier.maxDistanceMeters === null)).toHaveLength(1);
    }
  });
});
