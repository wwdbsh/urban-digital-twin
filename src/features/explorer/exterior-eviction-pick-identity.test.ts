import { describe, expect, it } from "vitest";

import { navigationUrl } from "../../domain/visitor-navigation";
import {
  canonicalExteriorPickId,
  exteriorCellEntityId,
  exteriorCellSignature,
  exteriorOverlayRenderEntries,
  exteriorRetirementSteps,
  exteriorSelectionSilhouetteSize,
  planExteriorOverlayUpdate,
  type ExteriorCellOverlay,
  type ExteriorCellRenderEntry,
  type ExteriorOwnedCellCollection,
} from "./CesiumViewport";
import type { ExteriorCellOutcome } from "../../runtime/exterior-cell-runtime";

/**
 * (3d) PICK IDENTITY ACROSS AN EVICTION.
 *
 * When T003's scheduler evicts a cell whose building the user has selected, four
 * things happen in one viewport pass and they have to happen in this order:
 *
 *   1. the cell's entities are removed from the scene;
 *   2. its `exteriorPickMap` entries are deleted, so a stale entity id can never
 *      resolve to a canonical feature that is no longer drawn;
 *   3. its object URLs are revoked — and only then is the cell reported as
 *      retired, which is gate (d) of the cache release seam;
 *   4. NOTHING happens to the selection. `selectedFeature` is a VALUE COPY
 *      (`setSelectedFeature(toCityFeature(feature))`, App.tsx), not a reference
 *      into the overlay, so the details panel and the deep link survive the
 *      geometry going away.
 *
 * The viewport effect is imperative and needs a real Cesium viewer, so what is
 * replayed here is the effect's own pure plan (`planExteriorOverlayUpdate`) and
 * the two collection mutations the effect performs beside it, written out in the
 * same order. That is stated rather than implied: this is a seam-level proof,
 * not a rendered one.
 *
 * ## What renders in the hole
 *
 * Nothing exterior, and the DENSE base massing that the exterior wave was
 * covering comes back — `exteriorRenderedCanonicalFeatureIds` drives the base
 * pass's coverage, so a canonical feature that stops being exterior-rendered
 * stops being suppressed in the base pass. The user therefore sees the flat
 * extruded footprint again rather than an empty lot. That is a real, visible
 * change of representation with no words attached to it, and it is exactly the
 * user-visible notice question ADR 0041 deferred to T003/T006: a deferred cell
 * is currently indistinguishable from a cell that ships no geometry. T003 does
 * not ship the notice (see ADR 0042); it records that the eviction path makes
 * the question live for a second reason, not only for the deferral path.
 */

const CELL_ID = "manhattan-exterior-cell-w01-000031-17-38598-35863";
const FEATURE_ID = "doitt:778052";
const OTHER_CELL_ID = "manhattan-exterior-cell-w01-000032-17-38599-35863";
const OTHER_FEATURE_ID = "doitt:982383";

function renderedCell(cellId: string, canonicalFeatureId: string): ExteriorCellOutcome {
  return {
    kind: "rendered",
    cellId,
    cellReleaseId: `cell:${cellId}:v1`,
    cellReleaseVersion: "1",
    assemblyPackageId: "pkg",
    representation: "head",
    notice: null,
    assets: [{
      canonicalFeatureId,
      ownerCellId: cellId,
      lodId: "lod_0",
      artifactRef: `public/assets/${canonicalFeatureId.replace(":", "-")}__lod_0.glb`,
      byteSize: 1_024,
      checksumSha256: "a".repeat(64),
      bytes: new Uint8Array(1_024),
      geometricErrorMeters: 1,
      maxDistanceMeters: null,
      provenance: {
        inventoryId: "inventory:x",
        inventoryHashSha256: "b".repeat(64),
        evidenceShardId: "evidence:x",
        truthTiers: [],
        sourceDates: { capturedAt: null, updatedAt: null },
        predecessor: null,
        uncertainty: "designed",
      },
    }],
  };
}

function overlay(cells: readonly ExteriorCellOutcome[]): ExteriorCellOverlay {
  return { releaseId: "manhattan-midtown-core-cells-20260811-v3", snapshotId: "snapshot:v1", origin: "default", profile: "exploration", cells: [...cells] } as ExteriorCellOverlay;
}

/**
 * The viewport effect's own sequence, minus Cesium.
 *
 * The retirement half is NOT restated here: it runs `exteriorRetirementSteps`,
 * the same exported applier the effect executes, so the ordering that makes
 * gate (d) evidence is asserted against the real file rather than against this
 * test's memory of it.
 */
function applyOverlayPass(
  entries: readonly ExteriorCellRenderEntry[],
  owned: Map<string, ExteriorOwnedCellCollection>,
  pickMap: Map<string, string>,
  revoked: string[],
  retired: string[],
  removedEntities: string[] = [],
): void {
  const plan = planExteriorOverlayUpdate(entries, owned, (entry) => ({ longitude: -73.98, latitude: 40.755, name: entry.canonicalFeatureId }));
  for (const step of exteriorRetirementSteps(plan)) {
    if (step.op === "remove-entity") removedEntities.push(step.entityId);
    else if (step.op === "forget-pick") pickMap.delete(step.entityId);
    else if (step.op === "revoke-object-url") revoked.push(step.objectUrl);
    else if (step.op === "forget-cell") owned.delete(step.cellId);
    else retired.push(...step.cellIds);
  }
  for (const cell of plan.addCells) {
    const entityIds: string[] = [];
    const objectUrls: string[] = [];
    for (const { entry } of cell.adds) {
      objectUrls.push(`blob:${entry.entityId}`);
      entityIds.push(entry.entityId);
      pickMap.set(entry.entityId, entry.canonicalFeatureId);
    }
    owned.set(cell.cellId, { entityIds, objectUrls, signature: cell.signature, complete: cell.complete });
  }
}

describe("the retirement applier the viewport executes", () => {
  it("revokes every object URL strictly before it reports the retirement", () => {
    // Gate (d) of the cache release seam is only evidence if this holds. It is
    // asserted on the exported applier, which the effect executes step for
    // step, so reordering the effect cannot leave this test passing.
    const steps = exteriorRetirementSteps({
      removeCellIds: ["cell-a", "cell-b"],
      removeEntityIds: ["entity-a", "entity-b"],
      revokeObjectUrls: ["blob:a", "blob:b"],
    });
    const report = steps.findIndex((step) => step.op === "report-retired");
    const lastRevoke = steps.map((step) => step.op).lastIndexOf("revoke-object-url");
    const lastForgetPick = steps.map((step) => step.op).lastIndexOf("forget-pick");
    expect(report).toBeGreaterThan(-1);
    expect(lastRevoke).toBeLessThan(report);
    // The pick map is emptied before the report too: a retirement that arrived
    // while a stale entity id still resolved would let a pick name geometry the
    // scene has stopped drawing.
    expect(lastForgetPick).toBeLessThan(report);
    expect(steps.filter((step) => step.op === "report-retired")).toHaveLength(1);
    expect(steps.at(-1)).toEqual({ op: "report-retired", cellIds: ["cell-a", "cell-b"] });
  });

  it("reports nothing when no cell was removed", () => {
    expect(exteriorRetirementSteps({ removeCellIds: [], removeEntityIds: [], revokeObjectUrls: [] })).toEqual([]);
  });

  it("removes an entity and forgets its pick in the same pair, never one without the other", () => {
    const steps = exteriorRetirementSteps({ removeCellIds: ["cell-a"], removeEntityIds: ["e1", "e2"], revokeObjectUrls: [] });
    expect(steps.slice(0, 4)).toEqual([
      { op: "remove-entity", entityId: "e1" },
      { op: "forget-pick", entityId: "e1" },
      { op: "remove-entity", entityId: "e2" },
      { op: "forget-pick", entityId: "e2" },
    ]);
  });
});

describe("evicting a selected cell", () => {
  it("removes the entity and its pick-map entry, revokes before reporting retirement, and restores both on re-admission", () => {
    const owned = new Map<string, ExteriorOwnedCellCollection>();
    const pickMap = new Map<string, string>();
    const revoked: string[] = [];
    const retired: string[] = [];
    const entityId = exteriorCellEntityId(CELL_ID, FEATURE_ID);

    // Resident: two cells, the selected building among them.
    applyOverlayPass(exteriorOverlayRenderEntries(overlay([renderedCell(CELL_ID, FEATURE_ID), renderedCell(OTHER_CELL_ID, OTHER_FEATURE_ID)])), owned, pickMap, revoked, retired);
    expect(pickMap.get(entityId)).toBe(FEATURE_ID);
    expect(canonicalExteriorPickId(entityId, pickMap)).toBe(FEATURE_ID);
    expect(exteriorSelectionSilhouetteSize(FEATURE_ID, FEATURE_ID)).toBe(3);

    // The scheduler evicts the selected cell; the other stays resident.
    applyOverlayPass(exteriorOverlayRenderEntries(overlay([renderedCell(OTHER_CELL_ID, OTHER_FEATURE_ID)])), owned, pickMap, revoked, retired);
    expect(owned.has(CELL_ID)).toBe(false);
    expect(owned.has(OTHER_CELL_ID)).toBe(true);
    // The pick-map entry is GONE, so a stale entity id resolves to itself and
    // never to a canonical feature the scene is no longer drawing.
    expect(pickMap.has(entityId)).toBe(false);
    expect(canonicalExteriorPickId(entityId, pickMap)).toBe(entityId);
    // The Blob was revoked, and the retirement names exactly the evicted cell.
    expect(revoked).toEqual([`blob:${entityId}`]);
    expect(retired).toEqual([CELL_ID]);
    // The other cell is untouched: an eviction isolates to its own cell.
    expect(pickMap.get(exteriorCellEntityId(OTHER_CELL_ID, OTHER_FEATURE_ID))).toBe(OTHER_FEATURE_ID);

    // Re-admission restores the entity, the pick map and the silhouette.
    applyOverlayPass(exteriorOverlayRenderEntries(overlay([renderedCell(CELL_ID, FEATURE_ID), renderedCell(OTHER_CELL_ID, OTHER_FEATURE_ID)])), owned, pickMap, revoked, retired);
    expect(pickMap.get(entityId)).toBe(FEATURE_ID);
    expect(exteriorSelectionSilhouetteSize(pickMap.get(entityId)!, FEATURE_ID)).toBe(3);
    // A second Blob for the re-admitted cell; the first stays revoked.
    expect(revoked).toEqual([`blob:${entityId}`]);
    expect(owned.get(CELL_ID)!.objectUrls).toEqual([`blob:${entityId}`]);
  });

  it("leaves the selection and its deep link intact, because the selection is a value copy", () => {
    // App.tsx: `setSelectedFeature(toCityFeature(feature))`. The selected
    // feature is a COPY of the base feature record, not a reference into the
    // exterior overlay, so nothing about it can be invalidated by geometry
    // going away. The deep link is built from `featureId` and the camera pose,
    // neither of which the overlay owns.
    const before = navigationUrl({ featureId: FEATURE_ID, query: "", cameraMode: "explore", pose: { longitude: -73.98, latitude: 40.755, height: 300, heading: 0, pitch: -45, roll: 0 }, poseInvalid: false, dataMode: "real-pilot", releaseId: "manhattan-citywide-20260804", visibleLayers: ["buildings"], facets: [] }, "https://example.test/");

    const owned = new Map<string, ExteriorOwnedCellCollection>();
    const pickMap = new Map<string, string>();
    const revoked: string[] = [];
    const retired: string[] = [];
    applyOverlayPass(exteriorOverlayRenderEntries(overlay([renderedCell(CELL_ID, FEATURE_ID)])), owned, pickMap, revoked, retired);
    applyOverlayPass(exteriorOverlayRenderEntries(overlay([])), owned, pickMap, revoked, retired);
    expect(pickMap.size).toBe(0);

    const after = navigationUrl({ featureId: FEATURE_ID, query: "", cameraMode: "explore", pose: { longitude: -73.98, latitude: 40.755, height: 300, heading: 0, pitch: -45, roll: 0 }, poseInvalid: false, dataMode: "real-pilot", releaseId: "manhattan-citywide-20260804", visibleLayers: ["buildings"], facets: [] }, "https://example.test/");
    expect(after).toBe(before);
    expect(after).toContain(encodeURIComponent(FEATURE_ID));
  });

  it("does not retire a cell it merely re-renders", () => {
    // A signature-identical pass retains the cell, so nothing is revoked and
    // nothing is reported retired. Gate (d) must not fire for a redraw: it
    // would let the release seam free bytes a live Blob still holds.
    const owned = new Map<string, ExteriorOwnedCellCollection>();
    const pickMap = new Map<string, string>();
    const revoked: string[] = [];
    const retired: string[] = [];
    const entries = exteriorOverlayRenderEntries(overlay([renderedCell(CELL_ID, FEATURE_ID)]));
    applyOverlayPass(entries, owned, pickMap, revoked, retired);
    expect(owned.get(CELL_ID)!.signature).toBe(exteriorCellSignature(entries));
    applyOverlayPass(entries, owned, pickMap, revoked, retired);
    expect(revoked).toEqual([]);
    expect(retired).toEqual([]);
    expect(pickMap.get(exteriorCellEntityId(CELL_ID, FEATURE_ID))).toBe(FEATURE_ID);
  });
});
