import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EXTERIOR_REFUSAL_STOP_CODES, exteriorRefusalStatement, exteriorRefusalStopCode, loadExteriorCellRuntime } from "../src/runtime/exterior-cell-runtime.ts";
import { REFUSAL_SUBJECTS } from "./exterior-refusal-journey-constants.mjs";

/**
 * THE CENSUS-INTEGRITY INSTRUMENT for T007's refusal panel.
 *
 * The panel's whole claim is that a refused building can be told WHY it was
 * refused, in the release's own words, with a stop code drawn from a closed
 * vocabulary. That claim rests on three properties of data this task did not
 * generate and must not modify:
 *
 *   1. the island-wide refusal count is 205 and is the same on both sides of the
 *      retention/serving seam;
 *   2. every refusal carries a non-empty reason; and
 *   3. every reason's bracketed code is one of exactly four.
 *
 * If any of those stops being true, the panel starts rendering something it
 * cannot justify — an empty reason, or an unrecognized token presented as a
 * category — so they are asserted here rather than assumed.
 */
const CENSUS_PATHS = [
  "data/manhattan-exterior-cells-20260811-v3-c1/wave-census.json",
  "data/manhattan-midtown-core-cells-20260811-v3-c1/wave-census.json",
  "data/manhattan-lower-manhattan-cells-20260812-c1/wave-census.json",
  "data/manhattan-southern-remainder-cells-20260812-c1/wave-census.json",
  "data/manhattan-central-upper-manhattan-cells-20260812-c1/wave-census.json",
  "data/manhattan-northern-manhattan-cells-20260812-c1/wave-census.json",
];

const ISLAND_WIDE_TOMBSTONE_COUNT = 205;

const censuses = CENSUS_PATHS.map((path) => ({ path, record: JSON.parse(readFileSync(path, "utf8")) }));

describe("committed wave censuses carry a well-formed closed refusal vocabulary", () => {
  it("declares exactly 205 tombstoned parents island-wide", () => {
    const rows = censuses.reduce((sum, entry) => sum + entry.record.tombstones.length, 0);
    expect(rows).toBe(ISLAND_WIDE_TOMBSTONE_COUNT);
    // Each census's own declared count must agree with the rows it ships, or
    // the arithmetic the coverage sentences rest on is already broken.
    for (const { path, record } of censuses) {
      expect(record.tombstones.length, path).toBe(record.tombstonedBuildingCount);
    }
  });

  it("gives every refusal a non-empty reason and a recognized stop code", () => {
    const codes = new Set();
    for (const { path, record } of censuses) {
      for (const row of record.tombstones) {
        expect(typeof row.buildingId, path).toBe("string");
        expect(row.buildingId.length, path).toBeGreaterThan(0);
        // A blank reason would render an empty "Reason" row in the panel: the
        // app would be claiming to explain a refusal while explaining nothing.
        expect(typeof row.reason, path).toBe("string");
        expect(row.reason.trim().length, `${path} ${row.buildingId}`).toBeGreaterThan(0);
        const code = exteriorRefusalStopCode(row.reason);
        expect(code, `${path} ${row.buildingId} reason=${row.reason.slice(0, 120)}`).not.toBeNull();
        // The census's own stopCode field and the code embedded in the prose
        // must agree; if they diverge, the panel and the census are describing
        // the same refusal differently.
        expect(row.stopCode, `${path} ${row.buildingId}`).toBe(code);
        codes.add(code);
      }
    }
    expect([...codes].sort()).toEqual([...EXTERIOR_REFUSAL_STOP_CODES].sort());
  });

  it("leaves a truthful sentence after the arm-dependent clause is removed", () => {
    // H1 over the REAL corpus rather than a sampled shape: whatever the app
    // asserts for any of the 205 must be non-empty and must not carry the
    // clause that is false under ?exteriorScheduler=off.
    for (const { path, record } of censuses) {
      for (const row of record.tombstones) {
        const statement = exteriorRefusalStatement(row.reason);
        expect(statement.length, `${path} ${row.buildingId}`).toBeGreaterThan(0);
        expect(statement, `${path} ${row.buildingId}`).not.toContain("base massing");
        expect(statement, `${path} ${row.buildingId}`).not.toContain("what remains on screen");
      }
    }
  });
});

/**
 * The same 205, read through the ACCESSOR out of the real serving graphs.
 *
 * PAYLOAD-GATED: the `-s1` release trees are untracked symlinks into a sibling
 * worktree, so this cannot run in a checkout that has not materialized them. It
 * skips rather than fails, and the census assertions above still run — but when
 * the payloads ARE present this is the test that proves the accessor reads the
 * shipped graphs and not just a fixture.
 */
const SERVING_RELEASES = [
  "manhattan-exterior-cells-20260811-v3-s1",
  "manhattan-midtown-core-cells-20260811-v3-s1",
  "manhattan-lower-manhattan-cells-20260812-s1",
  "manhattan-southern-remainder-cells-20260812-s1",
  "manhattan-central-upper-manhattan-cells-20260812-s1",
  "manhattan-northern-manhattan-cells-20260812-s1",
];

const payloadsPresent = SERVING_RELEASES.every((releaseId) => existsSync(`public/data/${releaseId}/release-graph.json`));

/** Serves the three boot documents off disk; no artifact is ever requested. */
function filesystemFetcher(releaseId) {
  return async (url) => {
    const fileName = String(url).slice(`/data/${releaseId}/`.length);
    const path = `public/data/${releaseId}/${fileName}`;
    if (!existsSync(path)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const text = readFileSync(path, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text), arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

/**
 * J7's pre-registered subjects, checked against the graphs they claim to come
 * from.
 *
 * This exists because writing them by hand got three of four cell ids wrong on
 * the first attempt — they were plausible and completely invented. A journey
 * that navigates to an invented cell would still produce a screenshot, and the
 * screenshot would look fine, which is exactly the sort of evidence that is
 * worse than none. Every field is therefore re-read from the shipped graph.
 */
/**
 * The identity half of the subject check, WITHOUT the payloads.
 *
 * The `-c1` wave censuses are committed, so a checkout with no `public/data`
 * symlinks can still prove that every pre-registered subject is a real refused
 * building with the stop code J7 claims for it. Only the cell/bounds half needs
 * the serving graphs, and that stays gated below. Splitting the check this way
 * means the invented-identifier failure mode is caught everywhere, not just on
 * a machine that happens to have the payload trees.
 */
describe("J7 pre-registered subjects are real refusals in the committed censuses", () => {
  const tombstoneByBuildingId = new Map();
  for (const { record } of censuses) {
    for (const row of record.tombstones) tombstoneByBuildingId.set(row.buildingId, { row, releaseId: record.releaseId });
  }

  /**
   * The JSDOM fixture's identifiers, checked against the pre-registered subject.
   *
   * Checked HERE, on the component test's source text, rather than by importing
   * the subjects into the `.tsx`: that file is type-checked and the constants
   * module is untyped `.mjs`, so the import fails `tsc` with TS7016. Reading the
   * source is the same guard without dragging a `declare module` shim or an
   * `allowJs` flag into the build for one assertion.
   *
   * It exists because the fixture's cell id WAS invented once, and a component
   * test with a plausible-but-fictional cell id still passes.
   */
  it("keeps the JSDOM fixture's identifiers equal to the pre-registered subject", () => {
    const source = readFileSync("src/app/ExteriorSelectedFeatureDetail.test.tsx", "utf8");
    const subject = REFUSAL_SUBJECTS[0];
    expect(source).toContain(`buildingId: "${subject.buildingId}"`);
    expect(source).toContain(`cellId: "${subject.cellId}"`);
    expect(source).toContain(`tombstoneId: "${subject.tombstoneId}"`);
    expect(source).toContain(`releaseId: "${subject.releaseId}"`);
  });

  it("names one real tombstoned building per stop code", () => {
    const codes = new Set();
    for (const subject of REFUSAL_SUBJECTS) {
      const found = tombstoneByBuildingId.get(subject.buildingId);
      expect(found, `${subject.buildingId} is not tombstoned in any committed census`).toBeDefined();
      expect(found.row.stopCode, subject.buildingId).toBe(subject.stopCode);
      expect(exteriorRefusalStopCode(found.row.reason), subject.buildingId).toBe(subject.stopCode);
      expect(found.row.reason.trim().length, subject.buildingId).toBeGreaterThan(0);
      codes.add(subject.stopCode);
    }
    // Every branch of the closed vocabulary exercised, none twice.
    expect(codes.size).toBe(REFUSAL_SUBJECTS.length);
    expect([...codes].sort()).toEqual([...EXTERIOR_REFUSAL_STOP_CODES].sort());
  });
});

describe.skipIf(!payloadsPresent)("J7 pre-registered subjects exist in the serving graphs as declared", () => {
  it("names one real refused building per stop code, with the right cell, release and tombstone", () => {
    const codes = new Set();
    for (const subject of REFUSAL_SUBJECTS) {
      const graph = JSON.parse(readFileSync(`public/data/${subject.releaseId}/release-graph.json`, "utf8"));
      let found = null;
      for (const cellRelease of graph.cellReleases) {
        for (const detail of cellRelease.buildingDetails ?? []) {
          if (detail.buildingId === subject.buildingId && detail.status === "unavailable") found = { detail, cellRelease };
        }
      }
      expect(found, `${subject.buildingId} is not refused in ${subject.releaseId}`).not.toBeNull();
      expect(found.cellRelease.cellId, subject.buildingId).toBe(subject.cellId);
      expect(found.detail.tombstoneId, subject.buildingId).toBe(subject.tombstoneId);
      expect(exteriorRefusalStopCode(found.detail.reason), subject.buildingId).toBe(subject.stopCode);
      // The camera pose must sit inside the owning cell, or the journey drives
      // somewhere else and selects nothing.
      const bounds = found.cellRelease.bounds;
      expect(subject.lon, subject.buildingId).toBeGreaterThanOrEqual(bounds.west);
      expect(subject.lon, subject.buildingId).toBeLessThanOrEqual(bounds.east);
      expect(subject.lat, subject.buildingId).toBeGreaterThanOrEqual(bounds.south);
      expect(subject.lat, subject.buildingId).toBeLessThanOrEqual(bounds.north);
      codes.add(subject.stopCode);
    }
    // Every branch of the closed vocabulary is exercised, and none twice.
    expect(codes.size).toBe(REFUSAL_SUBJECTS.length);
    expect([...codes].sort()).toEqual([...EXTERIOR_REFUSAL_STOP_CODES].sort());
  });
});

describe.skipIf(!payloadsPresent)("the refusal accessor over the real serving graphs", () => {
  it("indexes all 205 refusals across the six promoted waves, with non-empty reasons", async () => {
    let total = 0;
    const codes = new Set();
    /** buildingId -> releases that refuse it / declare it available. */
    const refusedIn = new Map();
    const availableIn = new Map();
    for (const releaseId of SERVING_RELEASES) {
      const { runtime } = await loadExteriorCellRuntime(`/data/${releaseId}/`, {
        fetcher: filesystemFetcher(releaseId),
        baseIdentity: { releaseId: "manhattan-citywide-20260804", has: () => true },
      });
      const refused = runtime.refusedBuildings();
      total += refused.size;
      for (const entry of refused.values()) {
        expect(entry.reason.trim().length, entry.buildingId).toBeGreaterThan(0);
        expect(entry.tombstoneId, entry.buildingId).toContain("tombstone:");
        expect(entry.releaseId, entry.buildingId).toBe(releaseId);
        expect(entry.cellId.length, entry.buildingId).toBeGreaterThan(0);
        const code = exteriorRefusalStopCode(entry.reason);
        expect(code, entry.buildingId).not.toBeNull();
        codes.add(code);
        // Nothing the panel asserts may carry the arm-dependent clause.
        expect(exteriorRefusalStatement(entry.reason)).not.toContain("base massing");
      }
      // Refusals and shipped buildings stay disjoint in the real graphs too.
      const promoted = runtime.promotedBuildingIds();
      for (const buildingId of refused.keys()) expect(promoted).not.toContain(buildingId);

      // ADR 0054 D-4's premise: NO cell in any serving wave is fully
      // tombstoned, which is why the not-shipped coverage sentence is never
      // produced on the shipped default and why no coverage string is currently
      // false. If a future wave ships an empty cell, that argument stops
      // holding and this fails rather than the ADR quietly going stale.
      expect(runtime.declaredNotShippedCellCount(), releaseId).toBe(0);

      for (const buildingId of refused.keys()) {
        refusedIn.set(buildingId, [...(refusedIn.get(buildingId) ?? []), releaseId]);
      }
      for (const buildingId of promoted) {
        availableIn.set(buildingId, [...(availableIn.get(buildingId) ?? []), releaseId]);
      }
    }
    expect(total).toBe(ISLAND_WIDE_TOMBSTONE_COUNT);
    expect([...codes].sort()).toEqual([...EXTERIOR_REFUSAL_STOP_CODES].sort());

    // CROSS-WAVE DISJOINTNESS. The panel prefers the recoverable answer when a
    // building is refused by one wave and shipped by another; this asserts that
    // situation does not exist today, so the ordering currently changes no
    // rendered answer and is purely a safety margin.
    const overlaps = [...refusedIn.keys()].filter((buildingId) => availableIn.has(buildingId));
    expect(overlaps).toEqual([]);
    // ...and no building is refused by two waves either, which would make
    // "the" stop code for a building ambiguous.
    const doublyRefused = [...refusedIn.entries()].filter(([, releases]) => releases.length > 1);
    expect(doublyRefused).toEqual([]);
  });
});
