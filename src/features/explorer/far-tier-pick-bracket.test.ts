/**
 * The Route D bracket, and the pin that stops it being bypassed.
 *
 * These tests encode two measured CesiumJS facts that no unit test can
 * rediscover on its own — the alpha cutoff and the non-pickable occluder — so
 * that a future edit which "simplifies" either one fails here instead of
 * silently swallowing every far-range click.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
/** The project idiom: node types are not in this tsconfig, so decode explicitly. */
function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

import { createFarTierPickBracket, FAR_TIER_MASSING_PICK_ALPHA, type FarTierHideable } from "./far-tier-pick-bracket";
import { applyDenseFarTierAlphaDelta, reconcileDenseFarTierAlpha, DENSE_MASSING_BASE_ALPHA, type DenseInstanceIndex } from "./CesiumViewport";

/** A dense index of freshly built, fully opaque massing instances. */
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

const COVERED_ALPHA = Math.round(FAR_TIER_MASSING_PICK_ALPHA * 255);
const OPAQUE_ALPHA = Math.round(DENSE_MASSING_BASE_ALPHA * 255);

function fakeScene(observe: (visible: boolean[]) => void, hideables: FarTierHideable[]) {
  return {
    pick: () => { observe(hideables.map((entry) => entry.show)); return "picked"; },
    drillPick: () => { observe(hideables.map((entry) => entry.show)); return ["drilled"]; },
  };
}

describe("FAR_TIER_MASSING_PICK_ALPHA", () => {
  it("is exactly the measured Cesium cutoff, and is not zero", () => {
    // The T003 Stage 0 spike measured this directly: alpha 0 and 0.002 leave the
    // pick pass, 0.004 and above stay in it. Zero destroys far-range picking.
    expect(FAR_TIER_MASSING_PICK_ALPHA).toBe(0.004);
    expect(FAR_TIER_MASSING_PICK_ALPHA).toBeGreaterThan(0);
  });

  it("keeps the reason and the evidence next to the constant", () => {
    const source = readText("src/features/explorer/far-tier-pick-bracket.ts");
    // A bare 0.004 with no explanation is an invitation to delete it.
    expect(source).toContain("DO NOT \"CLEAN THIS UP\" TO ZERO");
    expect(source).toContain("a95723fd0973760ff7d539fcc3ccc851bbd0dc053bcb1cf872aebd217f73aa5b");
    // The Cesium citation is what the next upgrade needs in order to remove this.
    expect(source).toContain("index.js:48744-48765");
  });
});

describe("createFarTierPickBracket", () => {
  it("hides every far-tier primitive for the duration of a pick", () => {
    const hideables: FarTierHideable[] = [{ show: true }, { show: true }];
    let duringPick: boolean[] = [];
    const bracket = createFarTierPickBracket(fakeScene((visible) => { duringPick = visible; }, hideables), () => hideables);

    expect(bracket.pick({})).toBe("picked");
    expect(duringPick).toEqual([false, false]);
    // Restored the moment the pick returns, so no presented frame is affected.
    expect(hideables.map((entry) => entry.show)).toEqual([true, true]);
  });

  it("brackets drillPick too, not only pick", () => {
    const hideables: FarTierHideable[] = [{ show: true }];
    let duringPick: boolean[] = [];
    const bracket = createFarTierPickBracket(fakeScene((visible) => { duringPick = visible; }, hideables), () => hideables);

    expect(bracket.drillPick({}, 12)).toEqual(["drilled"]);
    expect(duringPick).toEqual([false]);
    expect(hideables[0]!.show).toBe(true);
  });

  it("restores visibility even when the pick throws", () => {
    // A pick that throws must never leave the far tier hidden for the rest of
    // the session, which is why the restore is in a `finally`.
    const hideables: FarTierHideable[] = [{ show: true }, { show: true }];
    const scene = { pick: () => { throw new Error("pick exploded"); }, drillPick: () => [] };
    const bracket = createFarTierPickBracket(scene, () => hideables);

    expect(() => bracket.pick({})).toThrow("pick exploded");
    expect(hideables.map((entry) => entry.show)).toEqual([true, true]);
  });

  it("restores the PRIOR show state, not a blanket true", () => {
    // A tile hidden for its own reason must stay hidden after a pick.
    const hideables: FarTierHideable[] = [{ show: true }, { show: false }];
    const bracket = createFarTierPickBracket(fakeScene(() => {}, hideables), () => hideables);

    bracket.pick({});
    expect(hideables.map((entry) => entry.show)).toEqual([true, false]);
  });

  it("reads the primitive list at call time, so tiles added later are covered", () => {
    // Capturing at construction would stop covering everything that streamed in
    // afterwards — the silent regression this bracket exists to prevent.
    const hideables: FarTierHideable[] = [];
    let duringPick: boolean[] = [];
    const bracket = createFarTierPickBracket(fakeScene((visible) => { duringPick = visible; }, hideables), () => hideables);

    hideables.push({ show: true });
    bracket.pick({});
    expect(duringPick).toEqual([false]);
  });
});

describe("no bypass", () => {
  it("calls scene.pick and scene.drillPick ONLY inside the bracket module", () => {
    // Constraint (c) of the Route D adjudication. A future direct call must fail
    // CI rather than silently swallow far-range clicks.
    const allowed = new Set([
      "src/features/explorer/far-tier-pick-bracket.ts",
      // The Stage 0 spike is a dev-only harness that is not part of the shipped
      // application and whose entire purpose is to call the raw scene API.
      "src/picking-spike-main.tsx",
    ]);
    const offenders: string[] = [];
    for (const entry of readdirSync("src", { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) continue;
      const path = `${entry.parentPath}/${entry.name}`;
      if (allowed.has(path)) continue;
      if (/\bscene\.(drillPick|pick)\s*\(/u.test(readText(path))) offenders.push(path);
    }
    expect(offenders, "these files pick without the far-tier bracket and will swallow far-range clicks").toEqual([]);
  });

  it("removes the one pick this repository CANNOT see: Cesium's own double-click handler", () => {
    // The source scan above is blind to picks inside CesiumJS. `Viewer` installs
    // `pickAndTrackObject` on LEFT_DOUBLE_CLICK, which calls `scene.pick`
    // unbracketed, so a double click over a far-tier tile picks against a scene
    // with the tile still in the pick pass.
    const viewport = readText("src/features/explorer/CesiumViewport.tsx");
    expect(viewport).toContain("removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)");
    // And the module header must not claim a completeness it does not have.
    const bracket = readText("src/features/explorer/far-tier-pick-bracket.ts");
    expect(bracket).toContain("pickAndTrackObject");
    expect(bracket).not.toContain("The ONE place this application is allowed to pick");
  });
});

describe("the far-tier alpha survives a dense render-plan rebuild", () => {
  const covered = new Set(["doitt:1"]);

  it("re-applies the covered set against the layer the commit installs", () => {
    // THE DEFECT THIS PINS. The applied set is only meaningful against the
    // instance index it was written into. A rebuild replaces every instance
    // with a fresh, fully opaque one, so an applied set carried across the
    // rebuild makes the next delta EMPTY: the tan massing under every drawn
    // far-tier tile comes back at full opacity and never heals, because nothing
    // will produce a delta again until the covered set itself changes.
    const first = denseIndexOf(["doitt:1"]);
    const applied = reconcileDenseFarTierAlpha(first.index, new Set(), covered);
    expect(applied.writes).toBe(1);
    expect(first.alphaOf("doitt:1")).toBe(COVERED_ALPHA);

    // The rebuild: a new index, brand new instances, all fully opaque.
    const rebuilt = denseIndexOf(["doitt:1"]);
    expect(rebuilt.alphaOf("doitt:1")).toBe(OPAQUE_ALPHA);

    // Carrying the applied set across it writes NOTHING — the bug, reproduced.
    const stale = reconcileDenseFarTierAlpha(rebuilt.index, applied.applied, covered);
    expect(stale.writes).toBe(0);
    expect(rebuilt.alphaOf("doitt:1"), "the massing is back at full opacity under a drawn tile").toBe(OPAQUE_ALPHA);

    // The fix: the commit path clears the applied set first, exactly as the
    // `show`-based ownership path already did, and writes the desired set again.
    const healed = reconcileDenseFarTierAlpha(rebuilt.index, new Set(), covered);
    expect(healed.writes).toBe(1);
    expect(rebuilt.alphaOf("doitt:1")).toBe(COVERED_ALPHA);
  });

  it("still advances the applied set only over writes that landed", () => {
    // The skipped contract is unchanged by the reset: an id that did not write
    // is retried next pass rather than recorded as flipped.
    const index = denseIndexOf([]);
    const result = reconcileDenseFarTierAlpha(index.index, new Set(), covered);
    expect(result.writes).toBe(0);
    expect([...result.applied]).toEqual([]);
  });

  it("resets the applied set everywhere the index it describes is discarded", () => {
    // A structural pin, deliberately: the three reset sites and the commit
    // re-apply are glue inside an effect that no unit test can reach, and their
    // absence is precisely the defect above. The `show` path has exactly the
    // same three sites, which is what makes this checkable at all.
    const viewport = readText("src/features/explorer/CesiumViewport.tsx");
    const resets = viewport.match(/denseFarTierAlphaAppliedRef\.current = new Set<string>\(\)/gu) ?? [];
    expect(resets.length, "viewer teardown, rebuild commit and dense teardown must each reset it").toBeGreaterThanOrEqual(3);
    expect(viewport).toContain("applyFarTierAlpha(denseDesiredFarTierCoveredRef.current)");
  });
});

describe("far-tier massing is hidden by ALPHA, never by show", () => {
  it("writes colour and leaves show untouched, so the instance stays pickable", () => {
    // The bug this pins actually shipped for one revision: far-tier ids were
    // routed into the show-based ownership set, which takes the massing out of
    // the pick pass — exactly what Stage 0 measured — leaving the merged tile,
    // which has no per-building ids, as the only thing under the cursor.
    const attributes = { color: new Uint8Array([215, 168, 93, 209]), show: new Uint8Array([1]) };
    const primitive = { ready: true, getGeometryInstanceAttributes: () => attributes } as unknown as Parameters<typeof applyDenseFarTierAlphaDelta>[0]["buildings"] extends Map<string, infer P> ? P : never;
    const index = { buildings: new Map([["doitt:1", primitive]]), points: new Map() };

    const covered = applyDenseFarTierAlphaDelta(index, { added: [], removed: ["doitt:1"] });
    expect(covered.writes).toBe(1);
    expect(covered.skipped).toEqual([]);
    // Alpha dropped to the measured cutoff, and `show` is untouched.
    expect(attributes.color[3]).toBe(Math.round(FAR_TIER_MASSING_PICK_ALPHA * 255));
    expect(attributes.show[0]).toBe(1);

    const restored = applyDenseFarTierAlphaDelta(index, { added: ["doitt:1"], removed: [] });
    expect(restored.writes).toBe(1);
    expect(attributes.color[3]).toBe(Math.round(DENSE_MASSING_BASE_ALPHA * 255));
  });

  it("reports ids it could not write as skipped, never as written", () => {
    const index = { buildings: new Map(), points: new Map() };
    const result = applyDenseFarTierAlphaDelta(index, { added: [], removed: ["doitt:absent"] });
    expect(result.writes).toBe(0);
    expect(result.skipped).toEqual(["doitt:absent"]);
  });

  it("skips an instance whose primitive is not ready yet", () => {
    const primitive = { ready: false, getGeometryInstanceAttributes: () => ({ color: new Uint8Array(4) }) };
    const index = { buildings: new Map([["doitt:1", primitive]]), points: new Map() } as never;
    const result = applyDenseFarTierAlphaDelta(index, { added: [], removed: ["doitt:1"] });
    expect(result.skipped).toEqual(["doitt:1"]);
  });
});
