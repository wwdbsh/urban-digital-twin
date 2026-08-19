/**
 * The P2 "coverage race" that was not a race.
 *
 * T005's first promotion sweep failed one pose of six: a wide oblique Midtown
 * view reported 11,867 of 23,959 loaded massing buildings sitting under DRAWN
 * far-tier tiles without being held at far-tier alpha, and three readings at
 * that pose gave 12,485, then 26, then 11,867. It read exactly like the dense
 * rebuild racing the covered-set re-apply.
 *
 * It was not. Instrumenting the seam showed the selection pass itself finding
 * ZERO uncovered at the same moment the published attribute read thousands, and
 * the published drawn-cell count (839) exceeding the drawn set the last pass had
 * actually selected over (776). `publishFarTierState()` was called at the moment
 * the drawn set advanced — before `farTierCovered` was computed and long before
 * `applyFarTierAlpha` wrote anything — so every building whose tile started
 * drawing in that pass was published as suppressible-but-uncovered, and since
 * the pass never published again, that stale reading stood as the last word.
 * The scene was correct throughout.
 *
 * These tests lock the contract that makes the number trustworthy: the reading
 * is only meaningful when the drawn set and the applied set come from the same
 * pass, and the caller must publish after the write, not before it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
/** The project idiom: node types are not in this tsconfig, so decode explicitly. */
function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

import {
  farTierCoverageReading,
  reconcileDenseFarTierAlpha,
  DENSE_MASSING_BASE_ALPHA,
  type DenseInstanceIndex,
} from "./CesiumViewport";
import { FAR_TIER_MASSING_PICK_ALPHA } from "./far-tier-pick-bracket";

/** A freshly built, fully opaque dense layer: every instance ready, every alpha 1. */
function denseIndexOf(buildingIds: readonly string[]): { index: DenseInstanceIndex; alphaOf: (id: string) => number } {
  const attributes = new Map<string, { color: Uint8Array; show: Uint8Array }>();
  const buildings = new Map<string, unknown>();
  for (const id of buildingIds) {
    attributes.set(id, { color: new Uint8Array([215, 168, 93, Math.round(DENSE_MASSING_BASE_ALPHA * 255)]), show: new Uint8Array([1]) });
    buildings.set(id, { ready: true, getGeometryInstanceAttributes: (key: string) => attributes.get(key) });
  }
  return {
    index: { buildings, points: new Map() } as unknown as DenseInstanceIndex,
    alphaOf: (id: string) => attributes.get(id)!.color[3]!,
  };
}

const OPAQUE_ALPHA = Math.round(DENSE_MASSING_BASE_ALPHA * 255);
const COVERED_ALPHA = Math.round(FAR_TIER_MASSING_PICK_ALPHA * 255);

/** `cellCount` tiles of `perCell` members each, named so ids are stable. */
function tilesOf(cellCount: number, perCell: number): { cellId: string; suppressibleBuildingIds: string[] }[] {
  return Array.from({ length: cellCount }, (_, cell) => ({
    cellId: `cell-${cell}`,
    suppressibleBuildingIds: Array.from({ length: perCell }, (_, member) => `doitt:${cell}-${member}`),
  }));
}

const EMPTY: ReadonlySet<string> = new Set<string>();

describe("farTierCoverageReading", () => {
  it("reads zero uncovered when the drawn set and the applied set are the same pass's", () => {
    const tiles = tilesOf(30, 40);
    const drawnCells = new Set(tiles.map((tile) => tile.cellId));
    const members = tiles.flatMap((tile) => tile.suppressibleBuildingIds);
    const { index } = denseIndexOf(members);
    const covered = new Set(members);

    const reading = farTierCoverageReading({
      tiles,
      drawnCells,
      denseIndexBuildingIds: index.buildings,
      applied: covered,
      desired: covered,
      hiddenByOwnership: EMPTY,
    });

    expect(reading.suppressible).toBe(1_200);
    expect(reading.covered).toBe(1_200);
    expect(reading.uncovered).toBe(0);
    expect(reading.uncoveredSample).toEqual([]);
  });

  it("counts only massing that is actually loaded, never the whole island's membership", () => {
    // The first version of this metric compared full member lists against the
    // applied set and read 41,405 "uncovered" at a pose where the truth was 0,
    // because most members of the island's tiles have no primitive loaded.
    const tiles = tilesOf(10, 100);
    const drawnCells = new Set(tiles.map((tile) => tile.cellId));
    const loaded = tiles.flatMap((tile) => tile.suppressibleBuildingIds.slice(0, 5));
    const { index } = denseIndexOf(loaded);
    const covered = new Set(loaded);

    const reading = farTierCoverageReading({
      tiles,
      drawnCells,
      denseIndexBuildingIds: index.buildings,
      applied: covered,
      desired: covered,
      hiddenByOwnership: EMPTY,
    });

    expect(reading.suppressible).toBe(50);
    expect(reading.uncovered).toBe(0);
  });

  it("classifies a stale publish as notDesired, which is the P2 signature", () => {
    // Pass N drew 20 cells and its alpha landed. Pass N+1 drew 30. Publishing at
    // the moment the drawn set advanced pairs 30 drawn cells with pass N's
    // applied set: 400 buildings read as uncovered, and every one of them is
    // `notDesired` because the covered set for pass N+1 does not exist yet.
    const tiles = tilesOf(30, 40);
    const passNMembers = tiles.slice(0, 20).flatMap((tile) => tile.suppressibleBuildingIds);
    const { index } = denseIndexOf(tiles.flatMap((tile) => tile.suppressibleBuildingIds));
    const appliedFromPassN = new Set(passNMembers);

    const stale = farTierCoverageReading({
      tiles,
      drawnCells: new Set(tiles.map((tile) => tile.cellId)),
      denseIndexBuildingIds: index.buildings,
      applied: appliedFromPassN,
      desired: appliedFromPassN,
      hiddenByOwnership: EMPTY,
    });

    expect(stale.uncovered).toBe(400);
    expect(stale.uncoveredNotDesired).toBe(400);
    // Not a lost write: nothing was ever asked for and refused.
    expect(stale.uncoveredDesired).toBe(0);
    expect(stale.uncoveredHidden).toBe(0);
  });

  it("separates a genuinely lost alpha write from a stale reading", () => {
    const tiles = tilesOf(5, 10);
    const members = tiles.flatMap((tile) => tile.suppressibleBuildingIds);
    const { index } = denseIndexOf(members);
    const desired = new Set(members);
    const applied = new Set(members.slice(0, 45)); // five writes did not land

    const reading = farTierCoverageReading({
      tiles,
      drawnCells: new Set(tiles.map((tile) => tile.cellId)),
      denseIndexBuildingIds: index.buildings,
      applied,
      desired,
      hiddenByOwnership: EMPTY,
    });

    expect(reading.uncovered).toBe(5);
    expect(reading.uncoveredDesired).toBe(5);
    expect(reading.uncoveredNotDesired).toBe(0);
  });

  it("does not count ownership-suppressed massing as a coverage defect", () => {
    // A building hidden by `show === false` draws nothing at any alpha, so it
    // cannot read as tan and must not inflate an uncovered count.
    const tiles = tilesOf(4, 10);
    const members = tiles.flatMap((tile) => tile.suppressibleBuildingIds);
    const { index } = denseIndexOf(members);
    const hidden = new Set(members.slice(0, 8));
    const covered = new Set(members.filter((id) => !hidden.has(id)));

    const reading = farTierCoverageReading({
      tiles,
      drawnCells: new Set(tiles.map((tile) => tile.cellId)),
      denseIndexBuildingIds: index.buildings,
      applied: covered,
      desired: covered,
      hiddenByOwnership: hidden,
    });

    expect(reading.uncovered).toBe(8);
    expect(reading.uncoveredHidden).toBe(8);
    expect(reading.uncoveredDesired).toBe(0);
    expect(reading.uncoveredNotDesired).toBe(0);
  });
});

describe("a dense rebuild under a large covered set", () => {
  it("leaves zero covered members at full alpha once the commit re-applies", () => {
    // The brief's regression: rebuild the dense index while a large covered set
    // is in force, and assert that after the commit path clears the applied set
    // and re-applies the desired one, no covered member is still opaque.
    const tiles = tilesOf(40, 50);
    const drawnCells = new Set(tiles.map((tile) => tile.cellId));
    const members = tiles.flatMap((tile) => tile.suppressibleBuildingIds);
    const covered = new Set(members);

    const first = denseIndexOf(members);
    const afterFirst = reconcileDenseFarTierAlpha(first.index, EMPTY, covered);
    expect(afterFirst.writes).toBe(2_000);
    expect(members.every((id) => first.alphaOf(id) === COVERED_ALPHA)).toBe(true);

    // The rebuild: brand new, fully opaque instances.
    const rebuilt = denseIndexOf(members);
    expect(members.every((id) => rebuilt.alphaOf(id) === OPAQUE_ALPHA)).toBe(true);

    // What `commitDenseLayer` does: clear the applied set, then re-apply the
    // desired one against the NEW index. Carrying the old applied set across
    // would produce an empty delta and leave every building opaque forever.
    const carriedAcross = reconcileDenseFarTierAlpha(rebuilt.index, afterFirst.applied, covered);
    expect(carriedAcross.writes).toBe(0);
    expect(members.every((id) => rebuilt.alphaOf(id) === OPAQUE_ALPHA)).toBe(true);

    const afterCommit = reconcileDenseFarTierAlpha(rebuilt.index, EMPTY, covered);
    expect(afterCommit.writes).toBe(2_000);

    const stillOpaque = members.filter((id) => rebuilt.alphaOf(id) !== COVERED_ALPHA);
    expect(stillOpaque).toEqual([]);

    const reading = farTierCoverageReading({
      tiles,
      drawnCells,
      denseIndexBuildingIds: rebuilt.index.buildings,
      applied: afterCommit.applied,
      desired: covered,
      hiddenByOwnership: EMPTY,
    });
    expect(reading.uncovered).toBe(0);
  });
});

describe("the publish ordering the reading depends on", () => {
  const source = readText("src/features/explorer/CesiumViewport.tsx");

  it("does not publish at the moment the drawn set advances", () => {
    // The defect, exactly: `farTierDrawnCellsRef.current = nowDrawn` followed by
    // `publishFarTierState()` inside the same block, before the covered set is
    // even computed. If that pairing comes back, so does the phantom.
    expect(source).toContain("THE DRAWN SET ADVANCES HERE. THE PUBLISH DOES NOT.");
    const advance = source.indexOf("farTierDrawnCellsRef.current = nowDrawn");
    expect(advance).toBeGreaterThan(0);
    const nextPublish = source.indexOf("publishFarTierState()", advance);
    const alphaWrite = source.indexOf("applyFarTierAlpha(farTierCovered)", advance);
    expect(alphaWrite).toBeGreaterThan(0);
    expect(nextPublish).toBeGreaterThan(alphaWrite);
  });

  it("publishes again at the rebuild commit, after the alpha is re-applied", () => {
    const reapply = source.indexOf("applyFarTierAlpha(denseDesiredFarTierCoveredRef.current)");
    expect(reapply).toBeGreaterThan(0);
    const publishAfter = source.indexOf("publishFarTierState()", reapply);
    expect(publishAfter).toBeGreaterThan(reapply);
    // And nothing else may slip between the re-apply and the publish that could
    // change what is on screen without being reported.
    expect(source.slice(reapply, publishAfter)).not.toContain("applyDenseOwnership");
  });
});
