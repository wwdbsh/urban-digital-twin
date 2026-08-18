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
});
