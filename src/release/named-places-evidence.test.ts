/**
 * The named-place recognizability checklist (Task T014), structural half.
 *
 * Two halves, split by what they can depend on, exactly like the ground
 * embellishment census gate:
 *
 * 1. **The always-run half** reads the COMMITTED record at
 *    `artifacts/named-places-20260826/named-places-evidence.json` and re-applies
 *    every claim to it: one entry per registry place, the shipped deep link, the
 *    pose, the framing, the imagery accounting, the provenance. It never skips,
 *    because a check gated only on a local release tree is unchecked on CI and
 *    on every fresh clone.
 * 2. **The re-measurement half** runs only where `public/data/` actually holds
 *    the ground and zone-imagery releases, which the repository does not carry.
 *    It re-derives the whole record from the release bytes and requires it to be
 *    identical to the committed one, and additionally reads each place's NAME
 *    back out of its source properties.
 *
 * WHAT IS NOT PROVEN HERE: that any of this looks right. No screenshots were
 * captured this cycle; visual confirmation is deferred to the P3 browser batch.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { NAMED_PLACES, NAMED_PLACE_GROUND_RELEASE_ID, NAMED_PLACE_ZONE_IMAGERY_RELEASE_ID, boundsIntersect } from "../domain/named-places.ts";
import {
  NAMED_PLACES_EVIDENCE_SCHEMA_VERSION,
  NAMED_PLACE_DEEP_LINK_BASE,
  buildNamedPlacesEvidence,
  groundCellBounds,
  relativeDeepLink,
  type NamedPlacesEvidenceDocument,
} from "./named-places-evidence.ts";
import {
  GROUND_RELEASE_DIRECTORY,
  NAMED_PLACES_EVIDENCE_PATH,
  namedPlaceReleasesPresent,
  readNamedPlaceReleaseInput,
} from "./named-places-evidence-io.ts";

const committed = JSON.parse(new TextDecoder().decode(readFileSync(NAMED_PLACES_EVIDENCE_PATH))) as NamedPlacesEvidenceDocument;
const byKey = new Map(committed.places.map((place) => [place.placeKey, place]));

describe("named place evidence record", () => {
  it("covers the registry exactly, in registry order", () => {
    expect(committed.schemaVersion).toBe(NAMED_PLACES_EVIDENCE_SCHEMA_VERSION);
    expect(committed.groundReleaseId).toBe(NAMED_PLACE_GROUND_RELEASE_ID);
    expect(committed.zoneImageryReleaseId).toBe(NAMED_PLACE_ZONE_IMAGERY_RELEASE_ID);
    expect(committed.deepLinkBase).toBe(NAMED_PLACE_DEEP_LINK_BASE);
    expect(committed.places.map((place) => place.placeKey)).toEqual(NAMED_PLACES.map((place) => place.placeKey));
  });

  it("carries no generation timestamp and no absolute path, so a rerun is a no-op diff", () => {
    // The `capturedAt` and `updatedAt` strings ARE timestamps, but they are the
    // source snapshot's own and are stable across runs. What must never appear
    // is a wall-clock stamp of the generator, or a machine-local path.
    const serialized = JSON.stringify(committed);
    expect(serialized).not.toMatch(/"generated(At|On)"/u);
    expect(serialized).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/u);
    expect(committed.deepLinkBase).toBe(NAMED_PLACE_DEEP_LINK_BASE);
  });
});

describe.each(NAMED_PLACES.map((place) => [place.placeKey, place] as const))("named place %s", (placeKey, place) => {
  const evidence = byKey.get(placeKey)!;

  it("(a) is the expected canonical identity, class and identity origin", () => {
    expect(evidence).toBeDefined();
    expect(evidence.canonicalFeatureId).toBe(place.canonicalFeatureId);
    expect(evidence.groundClass).toBe(place.groundClass);
    expect(evidence.identityOrigin).toBe(place.identityOrigin);
    // Parks reuse a civic identity; the plaza and the rivers are ground-owned.
    expect(evidence.identityOrigin).toBe(place.groundClass === "park" ? "referenced-existing" : "ground-owned");
  });

  it("(b) owns cells that the pose actually looks at, and is itself in frame", () => {
    expect(evidence.ownerCellIds.length).toBeGreaterThan(0);
    expect(evidence.ownerCellIdsInView.length).toBeGreaterThan(0);
    expect(evidence.geometryInView).toBe(true);
    expect(boundsIntersect(evidence.viewFootprint, evidence.geometryBounds)).toBe(true);
    for (const cellId of evidence.ownerCellIdsInView) {
      expect(evidence.ownerCellIds).toContain(cellId);
      expect(boundsIntersect(evidence.viewFootprint, groundCellBounds(cellId))).toBe(true);
    }
    // Every class the pose is expected to show is present in at least one cell
    // the pose looks at, counted from the release's own parts.
    for (const expectedClass of place.expectedClasses) {
      const cells = evidence.ownerCellIdsInView.filter((cellId) => (evidence.classCensus[cellId]?.[expectedClass] ?? 0) > 0);
      expect(cells.length, `${placeKey} shows no ${expectedClass} in any viewed cell`).toBeGreaterThan(0);
    }
  });

  it("(c) carries the provenance the details panel renders", () => {
    expect(evidence.sourceRefs.length).toBeGreaterThan(0);
    for (const source of evidence.sourceRefs) {
      expect(source.provider).not.toBe("");
      expect(source.datasetId).not.toBe("");
      expect(source.licenseRefId).not.toBe("");
      expect(source.capturedAt).not.toBe("");
      expect(source.updatedAt).not.toBe("");
    }
    expect(evidence.sourceRefs.map((source) => source.sourceRecordId)).toContain(place.sourceRecordId);
    // A park's canonical id IS its NYC Parks record; a ground-owned id is a
    // content hash, so only the source record can tie it back.
    if (place.identityOrigin === "referenced-existing") expect(place.canonicalFeatureId.endsWith(place.sourceRecordId)).toBe(true);
    expect(evidence.sourceDisplayName).toBe(place.sourceDisplayName);
    expect(evidence.displayNameField).toBe(place.displayNameField);
  });

  it("(d) has every (cell, class) pair accounted for by the imagery index", () => {
    expect(evidence.imagery.map((entry) => entry.cellId)).toEqual(evidence.ownerCellIds);
    expect(evidence.imagerySummary.unaccounted).toBe(0);
    expect(evidence.imagerySummary.textured + evidence.imagerySummary.refused).toBe(evidence.ownerCellIds.length);
    for (const entry of evidence.imagery) {
      expect(entry.zoneRef).toBe(`${entry.cellId}/${place.groundClass}`);
      expect(entry.status).not.toBe("unaccounted");
      // A refusal is only accounted for if it says why. Textured cells carry no
      // reason, so the two states stay distinguishable.
      if (entry.status === "refused") expect(entry.reason ?? "").not.toBe("");
      else expect(entry.reason).toBeUndefined();
    }
  });

  it("(e) ships the deep link the registry builds", () => {
    expect(evidence.deepLink).toBe(relativeDeepLink(place));
    expect(evidence.pose).toEqual(place.pose);
    const params = new URL(evidence.deepLink, NAMED_PLACE_DEEP_LINK_BASE).searchParams;
    expect(params.get("groundFeature")).toBe(place.canonicalFeatureId);
  });
});

/**
 * The two rivers are the honest edge of the imagery wave: their cells run past
 * the retained orthoimagery footprint, so some are refused rather than draped.
 * Pinning the counts here means a silent change in either direction fails.
 */
describe("imagery refusals at the river margins", () => {
  it("records refusals where the orthoimagery footprint runs out", () => {
    expect(byKey.get("hudson-river")!.imagerySummary).toEqual({ textured: 22, refused: 8, unaccounted: 0 });
    expect(byKey.get("east-river")!.imagerySummary).toEqual({ textured: 3, refused: 5, unaccounted: 0 });
    expect(byKey.get("the-battery")!.imagerySummary).toEqual({ textured: 1, refused: 1, unaccounted: 0 });
    for (const placeKey of ["central-park", "bryant-park", "washington-square-park", "times-square"]) {
      expect(byKey.get(placeKey)!.imagerySummary.refused).toBe(0);
    }
  });

  it("states a partial-coverage or no-coverage reason for every refusal", () => {
    const refusals = committed.places.flatMap((place) => place.imagery.filter((entry) => entry.status === "refused"));
    expect(refusals.length).toBe(14);
    for (const refusal of refusals) {
      expect(refusal.reason).toMatch(/retained (2024 )?orthoimagery/u);
    }
  });
});

describe.skipIf(!namedPlaceReleasesPresent())("re-measured from the local release tree", () => {
  const input = namedPlaceReleasesPresent() ? readNamedPlaceReleaseInput() : null;

  it("re-derives the committed record byte for byte", () => {
    expect(buildNamedPlacesEvidence(input!)).toEqual(committed);
  });

  it("reads each place's name back out of its own source properties", () => {
    for (const place of NAMED_PLACES) {
      const observed = input!.observedNames.get(place.canonicalFeatureId) ?? [];
      expect(observed, `${place.placeKey} has no source name`).toContain(place.sourceDisplayName);
    }
  });

  it("derives cell extents that agree with the release's own cellBounds", () => {
    for (const place of NAMED_PLACES) {
      const evidence = byKey.get(place.placeKey)!;
      for (const cellId of evidence.ownerCellIds) {
        const artifact = JSON.parse(new TextDecoder().decode(readFileSync(`${GROUND_RELEASE_DIRECTORY}/artifacts/${cellId}/${place.groundClass}.json`))) as { cellBounds: { west: number; south: number; east: number; north: number } };
        const derived = groundCellBounds(cellId);
        expect(derived.west).toBeCloseTo(artifact.cellBounds.west, 9);
        expect(derived.east).toBeCloseTo(artifact.cellBounds.east, 9);
        expect(derived.south).toBeCloseTo(artifact.cellBounds.south, 9);
        expect(derived.north).toBeCloseTo(artifact.cellBounds.north, 9);
      }
    }
  });

  it("finds each canonical id in the ground release with the declared class", () => {
    const featureById = new Map(input!.features.map((feature) => [feature.canonicalFeatureId, feature]));
    for (const place of NAMED_PLACES) {
      const feature = featureById.get(place.canonicalFeatureId);
      expect(feature, `${place.placeKey} is not in ${NAMED_PLACE_GROUND_RELEASE_ID}`).toBeDefined();
      expect(feature!.class).toBe(place.groundClass);
      expect(feature!.identityOrigin.kind).toBe(place.identityOrigin);
      if (place.identityOrigin === "referenced-existing") expect(feature!.identityOrigin.existingFeatureId).toBe(place.canonicalFeatureId);
    }
  });
});
