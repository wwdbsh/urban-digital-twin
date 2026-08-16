import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "../src/release/exterior-wave-ledger.ts";
import { ISLAND_OWNED_PARENTS, RECORD_ID } from "./mass-generation-coverage-cli.mjs";
import { WAVE_OWNED_PARENTS } from "./mass-generation-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coveragePath = join(repositoryRoot, "data", RECORD_ID, "coverage.json");
const coverageText = readFileSync(coveragePath, "utf8");
const coverage = JSON.parse(coverageText);

const ledger = JSON.parse(readFileSync(join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID, "ledger.json"), "utf8"));

describe("the T004 stage-4 coverage record", () => {
  it("carries a sidecar that matches its own bytes", () => {
    const sidecar = readFileSync(coveragePath.replace(/\.json$/u, ".sha256"), "utf8").trim().split(/\s+/u)[0];
    expect(sha256HexSync(coverageText)).toBe(sidecar);
  });

  it("closes the island against the IMMUTABLE ledger rather than against itself", () => {
    // Recomputed here from the ledger's own cell membership, so a coverage
    // record that drifted could not agree with it by restating its own totals.
    const ownedFromLedger = ledger.cells.reduce((total, cell) => total + cell.buildingIds.length, 0);
    expect(ownedFromLedger).toBe(ISLAND_OWNED_PARENTS);
    expect(coverage.ledger.ownedParents).toBe(ownedFromLedger);
    expect(coverage.island.owned).toBe(ownedFromLedger);
    expect(coverage.island.materialized + coverage.island.tombstoned).toBe(ownedFromLedger);
    expect(coverage.island.shippedPlusTombstonedEqualsOwned).toBe(true);
  });

  it("has six wave rows whose per-wave owned counts are the ledger's", () => {
    expect(coverage.waves).toHaveLength(6);
    const ownedByWave = new Map();
    for (const cell of ledger.cells) {
      const wave = /^manhattan-exterior-cell-(w\d{2})-/u.exec(cell.cellId)[1];
      ownedByWave.set(wave, (ownedByWave.get(wave) ?? 0) + cell.buildingIds.length);
    }
    for (const row of coverage.waves) {
      expect(row.owned).toBe(ownedByWave.get(row.waveId));
      expect(row.owned).toBe(WAVE_OWNED_PARENTS[row.waveId]);
      expect(row.materialized + row.tombstoned).toBe(row.owned);
      expect(row.c1ReleaseId.endsWith("-c1")).toBe(true);
      expect(row.c1ReleaseId).toBe(`${row.predecessorReleaseId}-c1`);
    }
  });

  it("sums its own rows to its island totals", () => {
    const sum = (key) => coverage.waves.reduce((total, row) => total + row[key], 0);
    expect(sum("materialized")).toBe(coverage.island.materialized);
    expect(sum("tombstoned")).toBe(coverage.island.tombstoned);
    expect(sum("recovered")).toBe(coverage.island.recovered);
    expect(sum("lod1FallbackCount")).toBe(coverage.island.lod1FallbackCount);
    expect(sum("payloadByteSize")).toBe(coverage.island.payloadByteSize);
  });

  it("accounts every tombstone under a per-category count", () => {
    const total = Object.values(coverage.tombstoneCategories).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(coverage.island.tombstoned);
    // The stop-code vocabulary is closed; a new key here means the grammar
    // started refusing for a reason no committed record names.
    expect(Object.keys(coverage.tombstoneCategories).sort()).toEqual([
      "ring-area-below-floor",
      "ring-neck-below-grammar-minimum",
      "ring-not-simple",
      "volume-identity-failed",
    ]);
  });

  it("agrees byte for byte with every committed wave census and inventory it cites", () => {
    for (const row of coverage.waves) {
      const recordRoot = join(repositoryRoot, "data", row.c1ReleaseId);
      const censusText = readFileSync(join(recordRoot, "wave-census.json"), "utf8");
      const inventoryText = readFileSync(join(recordRoot, "payload-inventory.json"), "utf8");
      expect(sha256HexSync(censusText)).toBe(row.waveCensusSha256);
      expect(sha256HexSync(inventoryText)).toBe(row.payloadInventorySha256);

      const census = JSON.parse(censusText);
      expect(census.generatedBuildingCount).toBe(row.materialized);
      expect(census.tombstonedBuildingCount).toBe(row.tombstoned);
      expect(census.tombstones).toHaveLength(row.tombstoned);
      expect(census.lod1FallbackCount).toBe(row.lod1FallbackCount);
      expect(census.lod1Policy).toBe("measured-fallback");

      const inventory = JSON.parse(inventoryText);
      expect(inventory.totals.byteSize).toBe(row.payloadByteSize);
      expect(inventory.totals.fileCount).toBe(row.payloadFileCount);
      expect(inventory.retentionRoot.rootChecksumSha256).toBe(row.retentionRootChecksumSha256);
      expect(inventory.cellManifestCount).toBe(row.cellManifestCount);
    }
  });

  it("names every tombstone with a stop code, so a refusal is never a bare number", () => {
    for (const row of coverage.waves) {
      const census = JSON.parse(readFileSync(join(repositoryRoot, "data", row.c1ReleaseId, "wave-census.json"), "utf8"));
      for (const tombstone of census.tombstones) {
        expect(typeof tombstone.buildingId).toBe("string");
        expect(tombstone.stopCode.length).toBeGreaterThan(0);
        expect(tombstone.reason.length).toBeGreaterThan(0);
        expect(tombstone.ownerCellId.length).toBeGreaterThan(0);
      }
    }
  });

  it("folds in the VALIDATOR's own output, completely and per wave (F4)", () => {
    for (const row of coverage.waves) {
      const v = row.validation;
      // Walked everything it declared, and declared everything the inventory has.
      expect(v.validatedCellCount).toBe(v.declaredCellCount);
      expect(v.declaredCellCount).toBe(row.cellManifestCount);
      // One silhouette record per generated building, fallbacks included.
      expect(v.silhouetteRecords).toBe(row.materialized);
      expect(v.packagedBuildingCount).toBe(row.materialized);
      expect(v.lod1FallbackCount).toBe(row.lod1FallbackCount);
      expect(v.textureAdmissionPolicy).toBe("procedural-replay");
      // Completeness was actually established, not merely offered.
      expect(v.completenessSources).toContain("payload-inventory");
      expect(v.completenessSources).toContain("wave-census");
    }
  });

  it("pins the committed validator and replay records by checksum (F12)", () => {
    for (const row of coverage.waves) {
      const recordRoot = join(repositoryRoot, "data", row.c1ReleaseId);
      for (const [file, pinned] of [["retention-validation.json", row.retentionValidationSha256], ["determinism-replay.json", row.determinismReplaySha256]]) {
        const text = readFileSync(join(recordRoot, file), "utf8");
        expect(sha256HexSync(text)).toBe(pinned);
        // And the record agrees with its own committed sidecar.
        const sidecar = readFileSync(join(recordRoot, file.replace(/\.json$/u, ".sha256")), "utf8").trim().split(/\s+/u)[0];
        expect(sidecar).toBe(pinned);
      }
    }
  });

  it("carries no host timing in its hashed bytes (F11)", () => {
    // A wall-clock number inside the record would make a byte-identical re-run
    // impossible on another machine, which is what the sidecar promises a reader.
    expect(coverage.elapsedSeconds).toBeUndefined();
    expect(JSON.stringify(coverage)).not.toMatch(/elapsedSeconds/u);
  });

  it("ties the PAYLOAD RETENTION HOLD to the Blender agreement rather than to a declaration", () => {
    // The hold existed for one reason and can be released for one reason. It is
    // released here ONLY if the agreement record it names actually agreed, and
    // the record is re-hashed from its own bytes so a released hold cannot rest
    // on a stale or edited one.
    if (coverage.payloadRetentionHold.status === "released") {
      expect(coverage.blenderAgreementRecord.status).toBe("agreed");
      expect(coverage.blenderAgreementRecord.failingSamples).toBe(0);
      expect(coverage.payloadRetentionHold.releasedBy.checksumSha256).toBe(coverage.blenderAgreementRecord.checksumSha256);
      const text = readFileSync(join(repositoryRoot, coverage.payloadRetentionHold.releasedBy.recordRef), "utf8");
      expect(sha256HexSync(text)).toBe(coverage.payloadRetentionHold.releasedBy.checksumSha256);
      expect(coverage.payloadRetentionHold.reason).toMatch(/Samples complete/u);
    } else {
      expect(coverage.payloadRetentionHold.status).toBe("HOLD");
      expect(coverage.payloadRetentionHold.reason).toMatch(/Blender/u);
    }
  });

  it("records a byte-identical determinism replay for every wave", () => {
    for (const row of coverage.waves) {
      expect(row.determinismReplay.compared).toBeGreaterThan(0);
      expect(row.determinismReplay.byteIdentical).toBe(row.determinismReplay.compared);
    }
  });

  it("carries the same Blender-agreement status its censuses do, never a better one", () => {
    for (const row of coverage.waves) {
      const census = JSON.parse(readFileSync(join(repositoryRoot, "data", row.c1ReleaseId, "wave-census.json"), "utf8"));
      expect(row.blenderAgreement).toBe(census.blenderAgreement.status);
    }
    expect(coverage.notClaimedHere.join(" ")).toMatch(/Blender agreement/u);
  });

  it("states explicitly that nothing served, pinned or promoted changed", () => {
    expect(coverage.rights.servingSurfaceChange).toBe("none");
    expect(coverage.rights.pinnedReleaseIdChange).toBe("none");
    expect(coverage.rights.promotedDefaultChange).toBe("none");
    expect(coverage.rights.conveyance).toBe("none");
    expect(coverage.rights.runtimeRollbackSurface).toBe("zero");
  });

  it("claims no visual, geographic or performance acceptance", () => {
    expect(coverage.notClaimedHere.join(" ")).toMatch(/visual, geographic, architectural, accessibility or performance acceptance/u);
  });
});
