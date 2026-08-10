import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DETERMINISTIC_FACADE_LIMITS } from "../domain/deterministic-facade-generator";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_GENERATED_AT,
  EXTERIOR_FULLSNAPSHOT_INPUT_ISSUE_CODES,
} from "../domain/exterior-fullsnapshot-input";
import { EXTERIOR_RUNTIME_BUDGETS } from "../runtime/exterior-cell-runtime";
import { stableSerialize } from "./catalog-release";
import type { ExteriorOwnershipCell, ExteriorOwnershipLedger } from "./exterior-release";
import {
  EXTERIOR_FULLSNAPSHOT_BYTE_MODEL,
  EXTERIOR_FULLSNAPSHOT_LOD_PROFILE,
  EXTERIOR_FULLSNAPSHOT_PILOT_CROSS_CHECK,
  EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES,
  buildFullSnapshotBudgetTable,
  buildFullSnapshotPackagePlan,
  estimateFullSnapshotAssetBytes,
  estimateFullSnapshotBuildingBytes,
  fullSnapshotLodShapes,
  reconcileFullSnapshotGeneration,
  simulateFullSnapshotCache,
  type FullSnapshotOutcome,
  type FullSnapshotPackagePlan,
} from "./exterior-fullsnapshot-plan";
import { EXTERIOR_CELL_MAX_BUILDINGS, EXTERIOR_WAVE_BASE_BUILDING_COUNT, exteriorArtifactChecksum } from "./exterior-wave-ledger";
import { EXTERIOR_LEDGER_RECONCILIATION_CODES } from "./exterior-wave-reconciliation";
import { MULTI_LOD_ASSEMBLY_LIMITS } from "./multi-lod-assembly";

const LEDGER_CHECKSUM = "e".repeat(64);
const PLAN_HASH = "a".repeat(64);

function cell(cellId: string, order: number, buildingIds: string[]): ExteriorOwnershipCell {
  return {
    cellId,
    order,
    bounds: { west: -74, south: 40.7, east: -73.9, north: 40.8 },
    buildingIds,
    membershipChecksumSha256: "b".repeat(64),
  };
}

function ledgerOf(cells: ExteriorOwnershipCell[]): ExteriorOwnershipLedger {
  return {
    schemaVersion: "1.0",
    ledgerId: "test-ledger",
    cityId: "city:manhattan",
    configId: "config:manhattan-exterior",
    immutable: true,
    baseIdentitySet: { id: "base", checksumSha256: "c".repeat(64), buildingCount: cells.reduce((total, entry) => total + entry.buildingIds.length, 0) },
    coverage: { west: -74, south: 40.7, east: -73.9, north: 40.8 },
    cells,
  };
}

const SAMPLE_LEDGER = ledgerOf([
  cell("manhattan-exterior-cell-w00-000000-block-00835", 0, ["doitt:1", "doitt:2"]),
  cell("manhattan-exterior-cell-w01-000001-14-4823-4482", 1, ["doitt:3"]),
]);

function plannedMap(entries: Array<[string, number]>) {
  return new Map(entries.map(([buildingId, placementCount]) => [buildingId, { buildingId, placementCount }]));
}

function samplePlan(): FullSnapshotPackagePlan {
  return buildFullSnapshotPackagePlan({
    ledger: SAMPLE_LEDGER,
    ledgerChecksumSha256: LEDGER_CHECKSUM,
    baseReleaseId: "manhattan-citywide-20260804",
    baseManifestChecksumSha256: "d".repeat(64),
    planned: plannedMap([["doitt:1", 39], ["doitt:2", 100], ["doitt:3", 12]]),
  });
}

describe("full-snapshot structural byte estimator", () => {
  it("is a pure function of quad and material counts", () => {
    const shape = { quadCount: 45, materialCount: 6 };
    expect(estimateFullSnapshotAssetBytes(shape)).toBe(estimateFullSnapshotAssetBytes({ ...shape }));
    expect(estimateFullSnapshotAssetBytes({ quadCount: 46, materialCount: 6 })).toBeGreaterThan(estimateFullSnapshotAssetBytes(shape));
  });

  it("reproduces the documented accessor arithmetic exactly", () => {
    const model = EXTERIOR_FULLSNAPSHOT_BYTE_MODEL;
    const quadCount = 45;
    const materialCount = 6;
    const vertices = quadCount * model.verticesPerQuad;
    const indices = quadCount * model.indicesPerQuad;
    const accessors = materialCount * model.accessorsPerPrimitive;
    const expected = vertices * model.vertexAttributeBytes
      + indices * 2
      + accessors * model.accessorAlignmentBytes
      + model.jsonBaseBytes
      + accessors * model.jsonBytesPerAccessor
      + materialCount * model.bufferViewsPerPrimitive * model.jsonBytesPerBufferView
      + materialCount * model.jsonBytesPerPrimitive
      + materialCount * model.jsonBytesPerMaterial
      + model.nodesPerAsset * model.jsonBytesPerNode
      + model.containerBytes;
    expect(estimateFullSnapshotAssetBytes({ quadCount, materialCount })).toBe(expected);
  });

  it("widens indices past the uint16 vertex ceiling", () => {
    const belowQuads = Math.floor(EXTERIOR_FULLSNAPSHOT_BYTE_MODEL.uint16VertexCeiling / EXTERIOR_FULLSNAPSHOT_BYTE_MODEL.verticesPerQuad);
    const below = estimateFullSnapshotAssetBytes({ quadCount: belowQuads, materialCount: 6 });
    const above = estimateFullSnapshotAssetBytes({ quadCount: belowQuads + 1, materialCount: 6 });
    expect(above - below).toBeGreaterThan(EXTERIOR_FULLSNAPSHOT_BYTE_MODEL.verticesPerQuad * EXTERIOR_FULLSNAPSHOT_BYTE_MODEL.vertexAttributeBytes);
  });

  it("shapes LOD 0 from every placement and LOD 1 from the massing box only", () => {
    const shapes = fullSnapshotLodShapes(39);
    expect(shapes["lod-0"].quadCount).toBe(45);
    expect(shapes["lod-1"].quadCount).toBe(6);
    const bytes = estimateFullSnapshotBuildingBytes(39);
    expect(bytes["lod-0"]).toBeGreaterThan(bytes["lod-1"]);
  });

  it("keeps the pilot rate labelled as a non-gating cross-check", () => {
    expect(EXTERIOR_FULLSNAPSHOT_PILOT_CROSS_CHECK.gating).toBe(false);
    // The pilot is Blender-authored commercial frontage over real outlines; it
    // is a different product from generated rectangular massing, so it may not
    // gate the budget table.
    const perBuilding = EXTERIOR_FULLSNAPSHOT_PILOT_CROSS_CHECK.bytesPerBuildingNumerator / EXTERIOR_FULLSNAPSHOT_PILOT_CROSS_CHECK.bytesPerBuildingDenominator;
    const structural = Object.values(estimateFullSnapshotBuildingBytes(39)).reduce((total, value) => total + value, 0);
    expect(perBuilding).toBeGreaterThan(structural);
  });
});

describe("full-snapshot package plan", () => {
  it("declares itself an estimate and is not shaped like a multi-LOD assembly manifest", () => {
    const plan = samplePlan();
    expect(plan.estimated).toBe(true);
    expect(plan.estimateBasis).toBe("structural-gltf-accessor-arithmetic-v1");
    // T004's manifest requires measured bytes and artifact checksums; nothing
    // here may be mistaken for one.
    expect(Object.keys(plan)).not.toContain("artifacts");
    expect(Object.keys(plan)).not.toContain("assets");
    expect(Object.keys(plan)).not.toContain("declaredTotalBytes");
    // It pins its lineage, but it declares no per-artifact byte size or
    // checksum, which is exactly what T004's manifest requires and this cannot
    // supply.
    expect(Object.keys(plan)).toContain("ledgerChecksumSha256");
    expect(stableSerialize(plan.cells)).not.toMatch(/checksumSha256|relativeRef|byteSize/u);
  });

  it("covers every ledger member once, in ledger order, and is replay-stable", () => {
    const plan = samplePlan();
    expect(plan.assetCount).toBe(3);
    expect(plan.artifactCount).toBe(3 * EXTERIOR_FULLSNAPSHOT_LOD_PROFILE.length);
    expect(plan.cells.map((entry) => entry.order)).toEqual([0, 1]);
    expect(plan.cells[0]!.buildingCount).toBe(2);
    expect(plan.cells.reduce((total, entry) => total + entry.estimatedBytes, 0)).toBe(plan.estimatedTotalBytes);
    expect(stableSerialize(samplePlan())).toBe(stableSerialize(plan));
  });

  it("resolves each cell's wave identity from the cell id", () => {
    const plan = samplePlan();
    expect(plan.cells[0]!.waveIndex).toBe(0);
    expect(plan.cells[0]!.waveId).toBe("block-835");
    expect(plan.cells[1]!.waveIndex).toBe(1);
  });
});

describe("full-snapshot budget table", () => {
  const budgetInput = () => ({
    plan: samplePlan(),
    maximumPlacementCount: 8_308,
    maximumCellBuildingCount: 120,
    placementCap: DETERMINISTIC_FACADE_LIMITS.maxPlacements,
  });

  it("checks every accepted assembly limit against the gating structural estimate", () => {
    const table = buildFullSnapshotBudgetTable(budgetInput());
    expect(table.gatingBasis).toBe("structural-gltf-accessor-arithmetic-v1");
    expect(table.checks.map((entry) => entry.id)).toEqual([
      "total-bytes", "artifact-bytes", "assets", "artifacts", "cells", "lods-per-asset", "placements-per-plan", "cell-membership",
    ]);
    expect(table.checks.find((entry) => entry.id === "assets")!.limit).toBe(MULTI_LOD_ASSEMBLY_LIMITS.assets);
    expect(table.checks.find((entry) => entry.id === "artifacts")!.limit).toBe(MULTI_LOD_ASSEMBLY_LIMITS.artifacts);
    expect(table.checks.find((entry) => entry.id === "total-bytes")!.limit).toBe(MULTI_LOD_ASSEMBLY_LIMITS.totalBytes);
    expect(table.checks.find((entry) => entry.id === "artifact-bytes")!.limit).toBe(MULTI_LOD_ASSEMBLY_LIMITS.artifactBytes);
    expect(table.checks.find((entry) => entry.id === "cell-membership")!.limit).toBe(EXTERIOR_CELL_MAX_BUILDINGS);
    expect(table.ok).toBe(true);
  });

  it("fails closed when any single ceiling is breached", () => {
    for (const [field, value] of [["maximumPlacementCount", DETERMINISTIC_FACADE_LIMITS.maxPlacements + 1], ["maximumCellBuildingCount", EXTERIOR_CELL_MAX_BUILDINGS + 1]] as const) {
      const table = buildFullSnapshotBudgetTable({ ...budgetInput(), [field]: value });
      expect(table.ok).toBe(false);
      expect(table.checks.filter((entry) => !entry.ok)).toHaveLength(1);
    }
    const oversized = samplePlan();
    oversized.estimatedTotalBytes = MULTI_LOD_ASSEMBLY_LIMITS.totalBytes + 1;
    const table = buildFullSnapshotBudgetTable({ ...budgetInput(), plan: oversized });
    expect(table.ok).toBe(false);
    expect(table.checks.find((entry) => entry.id === "total-bytes")!.ok).toBe(false);
  });

  it("reports the non-gating pilot total beside the gating one", () => {
    const table = buildFullSnapshotBudgetTable(budgetInput());
    expect(table.nonGatingPilotTotalBytes).toBe(samplePlan().pilotCrossCheckTotalBytes);
    expect(table.checks.some((entry) => entry.observed === table.nonGatingPilotTotalBytes)).toBe(false);
  });
});

describe("full-snapshot cache simulation", () => {
  it("restates ADR 0024 D4 against generator-derived sizes", () => {
    const plan = buildFullSnapshotPackagePlan({
      ledger: ledgerOf([cell("manhattan-exterior-cell-w01-000000-14-4823-4482", 0, Array.from({ length: EXTERIOR_CELL_MAX_BUILDINGS }, (_, index) => `doitt:${index}`))]),
      ledgerChecksumSha256: LEDGER_CHECKSUM,
      baseReleaseId: "manhattan-citywide-20260804",
      baseManifestChecksumSha256: "d".repeat(64),
      planned: plannedMap(Array.from({ length: EXTERIOR_CELL_MAX_BUILDINGS }, (_, index) => [`doitt:${index}`, 39] as [string, number])),
    });
    const simulation = simulateFullSnapshotCache({ plan, maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries, maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes });
    expect(simulation.maximumSingleCellEntries).toBe(EXTERIOR_CELL_MAX_BUILDINGS);
    expect(simulation.singleCellFitsCache).toBe(true);
    // The predecessor-fallback path re-runs verifyCellRelease, so a full cell
    // can cost 240 of the shared 256 entries: within budget, but saturating.
    expect(simulation.maximumPredecessorFallbackEntries).toBe(EXTERIOR_CELL_MAX_BUILDINGS * 2);
    expect(simulation.predecessorFallbackFitsCache).toBe(true);
    expect(simulation.maximumPredecessorFallbackEntries / EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBeGreaterThan(0.9);
    expect(simulation.cellsOverCachedBytes).toBe(0);
  });
});

describe("full-snapshot generation reconciliation", () => {
  const outcomes: FullSnapshotOutcome[] = [
    { kind: "planned", buildingId: "doitt:1", cellId: SAMPLE_LEDGER.cells[0]!.cellId, planHashSha256: PLAN_HASH },
    { kind: "planned", buildingId: "doitt:2", cellId: SAMPLE_LEDGER.cells[0]!.cellId, planHashSha256: PLAN_HASH },
    { kind: "planned", buildingId: "doitt:3", cellId: SAMPLE_LEDGER.cells[1]!.cellId, planHashSha256: PLAN_HASH },
  ];
  const reconcile = (input: FullSnapshotOutcome[]) => reconcileFullSnapshotGeneration(SAMPLE_LEDGER, {
    ledgerChecksumSha256: LEDGER_CHECKSUM,
    outcomes: input,
    stopCodes: EXTERIOR_FULLSNAPSHOT_INPUT_ISSUE_CODES,
  });

  it("owns a vocabulary distinct from the ADR 0024 ledger codes", () => {
    expect(EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES).toEqual(["missing", "duplicate", "unclassified"]);
    for (const code of EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES) {
      if (code === "missing" || code === "duplicate") continue;
      expect(EXTERIOR_LEDGER_RECONCILIATION_CODES as readonly string[]).not.toContain(code);
    }
    // T011's vocabulary is closed and pinned by committed artifacts.
    expect(EXTERIOR_LEDGER_RECONCILIATION_CODES).toEqual(["missing", "duplicate", "cross-cell-duplicate", "stale", "changed"]);
  });

  it("reports zero of every code when each enumerated member produced one plan", () => {
    const report = reconcile(outcomes);
    expect(report.counts).toEqual({ missing: 0, duplicate: 0, unclassified: 0 });
    expect(report.ok).toBe(true);
    expect(report.plannedBuildingCount).toBe(3);
    expect(report.stoppedBuildingCount).toBe(0);
    expect(report.enumeratedBuildingCount).toBe(3);
  });

  it("counts an explicit deterministic stop as accounted for, not unclassified", () => {
    const report = reconcile([outcomes[0]!, outcomes[1]!, { kind: "stopped", buildingId: "doitt:3", cellId: SAMPLE_LEDGER.cells[1]!.cellId, stopCode: "degenerate-footprint" }]);
    expect(report.counts).toEqual({ missing: 0, duplicate: 0, unclassified: 0 });
    expect(report.stoppedBuildingCount).toBe(1);
    expect(report.ok).toBe(true);
  });

  it("names a missing, a duplicate, and each unclassified referent", () => {
    expect(reconcile([outcomes[0]!, outcomes[1]!]).counts.missing).toBe(1);
    expect(reconcile([...outcomes, outcomes[0]!]).counts.duplicate).toBe(1);
    expect(reconcile([...outcomes, { kind: "planned", buildingId: "doitt:99", cellId: SAMPLE_LEDGER.cells[0]!.cellId, planHashSha256: PLAN_HASH }]).counts.unclassified).toBe(1);
    expect(reconcile([outcomes[0]!, outcomes[1]!, { kind: "planned", buildingId: "doitt:3", cellId: SAMPLE_LEDGER.cells[0]!.cellId, planHashSha256: PLAN_HASH }]).counts.unclassified).toBe(1);
    expect(reconcile([outcomes[0]!, outcomes[1]!, { kind: "planned", buildingId: "doitt:3", cellId: SAMPLE_LEDGER.cells[1]!.cellId, planHashSha256: "not-a-hash" }]).counts.unclassified).toBe(1);
    expect(reconcile([outcomes[0]!, outcomes[1]!, { kind: "stopped", buildingId: "doitt:3", cellId: SAMPLE_LEDGER.cells[1]!.cellId, stopCode: "invented-code" }]).counts.unclassified).toBe(1);
  });

  it("orders findings deterministically regardless of outcome order", () => {
    const shuffled = [outcomes[2]!, outcomes[0]!];
    const forward = reconcile([outcomes[0]!, outcomes[2]!]);
    const backward = reconcile(shuffled);
    expect(stableSerialize(backward.findings)).toBe(stableSerialize(forward.findings));
    expect(forward.findings.map((finding) => finding.buildingId)).toEqual(["doitt:2"]);
  });
});

describe("committed T012 dry-run evidence", () => {
  const evidenceRoot = "data/normalized/manhattan-exterior-fullsnapshot-dryrun-20260810";
  const evidenceText = new TextDecoder().decode(readFileSync(`${evidenceRoot}/evidence.json`));
  const committedLedger = JSON.parse(new TextDecoder().decode(readFileSync("data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json"))) as ExteriorOwnershipLedger;
  const evidence = JSON.parse(evidenceText) as {
    evidenceId: string;
    taskId: string;
    runKind: string;
    activatedRelease: boolean;
    publishedArtifacts: boolean;
    runDigestSha256: string;
    summary: {
      baseManifestChecksumSha256: string;
      ledgerChecksumSha256: string;
      generatedAt: string;
      counts: { enumerated: number; planned: number; stopped: number; cells: number; heightUnknown: number; forcedTwoFloor: number; forcedTwoBay: number; subThreeMeterHeight: number; holeRingsDropped: number; buildingsWithDroppedHoles: number };
      grammar: { maximumFloorCount: number; maximumBayCount: number; maximumPlacementCount: number; capsReached: number };
      quantization: { medianHeightResidualMm: number; maximumHeightResidualMm: number };
      footprintProxy: { medianAreaRatioPartsPerMillion: number; medianAxisAlignedAreaRatioPartsPerMillion: number; maximumSpanMm: number; maximumProjectionScaleErrorMm: number };
      bytes: { gatingBasis: string; structuralTotalBytes: number; nonGatingPilotTotalBytes: number };
    };
    budgetTable: { ok: boolean; gatingBasis: string; checks: Array<{ id: string; ok: boolean; limit: number; observed: number }> };
    cacheSimulation: { singleCellFitsCache: boolean; cellsOverCachedBytes: number; maximumSingleCellEntries: number };
    reconciliation: { ok: boolean; counts: Record<string, number>; plannedBuildingCount: number; findings: unknown[] };
  };

  it("matches its committed checksum sidecar", () => {
    const recorded = new TextDecoder().decode(readFileSync(`${evidenceRoot}/evidence.sha256`)).trim().split(/\s+/u)[0];
    expect(recorded).toBe(exteriorArtifactChecksum(JSON.parse(evidenceText)));
  });

  it("carries no host-observed field, so any later --evidence run rewrites identical bytes", () => {
    // A wall clock, an RSS reading, or a hostname inside the checksummed
    // artifact would make the sidecar above go stale on the next run. Host
    // observations live in docs/implementation/ instead.
    expect(evidenceText).not.toMatch(/"observedRun"|wallClock|peakRss|peakMemory|hostname|"nodeVersion"|"platform"/u);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) { keys.add(key); walk(child); }
    };
    walk(JSON.parse(evidenceText));
    for (const forbidden of ["observedRun", "wallClockSeconds", "peakRssBytes", "nodeVersion", "platform", "generatedAtWallClock"]) {
      expect([...keys]).not.toContain(forbidden);
    }
    expect((JSON.parse(evidenceText) as { deterministic: boolean }).deterministic).toBe(true);
  });

  it("records a dry run that activated and published nothing", () => {
    expect(evidence.taskId).toBe("T012");
    expect(evidence.runKind).toBe("dry-run");
    expect(evidence.activatedRelease).toBe(false);
    expect(evidence.publishedArtifacts).toBe(false);
    expect(evidence.runDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("plans every accepted parent exactly once with no stop and no clamp", () => {
    const counts = evidence.summary.counts;
    expect(counts.enumerated).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(counts.planned).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(counts.stopped).toBe(0);
    expect(counts.cells).toBe(committedLedger.cells.length);
    expect(evidence.summary.grammar.capsReached).toBe(0);
    expect(evidence.summary.grammar.maximumFloorCount).toBeLessThan(DETERMINISTIC_FACADE_LIMITS.maxFloors);
    expect(evidence.summary.grammar.maximumBayCount).toBeLessThan(DETERMINISTIC_FACADE_LIMITS.maxBays);
    expect(evidence.summary.grammar.maximumPlacementCount).toBeLessThan(DETERMINISTIC_FACADE_LIMITS.maxPlacements);
  });

  it("reconciles to zero missing, duplicate, and unclassified outcomes", () => {
    expect(evidence.reconciliation.counts).toEqual({ missing: 0, duplicate: 0, unclassified: 0 });
    expect(evidence.reconciliation.findings).toEqual([]);
    expect(evidence.reconciliation.ok).toBe(true);
    expect(evidence.reconciliation.plannedBuildingCount).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
  });

  it("discloses the truth substitutions it made rather than hiding them", () => {
    const counts = evidence.summary.counts;
    expect(counts.heightUnknown).toBe(76);
    expect(counts.forcedTwoFloor).toBe(1_393);
    expect(counts.subThreeMeterHeight).toBe(140);
    // The bay-grammar floor is far more common than the floor-count one and is
    // disclosed on the same footing rather than left implicit.
    expect(counts.forcedTwoBay).toBeGreaterThan(counts.forcedTwoFloor);
    expect(counts.buildingsWithDroppedHoles).toBe(797);
    expect(counts.holeRingsDropped).toBe(1_048);
    expect(evidence.summary.quantization.maximumHeightResidualMm).toBeGreaterThan(0);
    expect(evidence.summary.footprintProxy.medianAreaRatioPartsPerMillion).toBeGreaterThan(1_000_000);
    expect(evidence.summary.footprintProxy.maximumProjectionScaleErrorMm).toBeGreaterThan(0);
    // The rotated rectangle must beat the axis-aligned box it replaces, from
    // committed numbers rather than a one-off offline measurement.
    expect(evidence.summary.footprintProxy.medianAxisAlignedAreaRatioPartsPerMillion).toBeGreaterThan(evidence.summary.footprintProxy.medianAreaRatioPartsPerMillion);
  });

  it("passes every budget check on the structural estimate, with the pilot rate labelled non-gating", () => {
    expect(evidence.budgetTable.ok).toBe(true);
    expect(evidence.budgetTable.gatingBasis).toBe("structural-gltf-accessor-arithmetic-v1");
    expect(evidence.budgetTable.checks.every((check) => check.ok)).toBe(true);
    expect(evidence.budgetTable.checks.find((check) => check.id === "assets")!.observed).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(evidence.budgetTable.checks.find((check) => check.id === "artifacts")!.observed).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT * EXTERIOR_FULLSNAPSHOT_LOD_PROFILE.length);
    expect(evidence.summary.bytes.gatingBasis).toBe("structural-gltf-accessor-arithmetic-v1");
    expect(evidence.summary.bytes.structuralTotalBytes).toBeLessThan(MULTI_LOD_ASSEMBLY_LIMITS.totalBytes);
    // The pilot cross-check is reported and is deliberately not what gates: it
    // would consume most of the 8 GiB cap for a product this is not.
    expect(evidence.summary.bytes.nonGatingPilotTotalBytes).toBeGreaterThan(evidence.summary.bytes.structuralTotalBytes);
  });

  it("keeps one cell atomically loadable under the accepted runtime cache budgets", () => {
    expect(evidence.cacheSimulation.singleCellFitsCache).toBe(true);
    expect(evidence.cacheSimulation.cellsOverCachedBytes).toBe(0);
    expect(evidence.cacheSimulation.maximumSingleCellEntries).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
  });

  it("pins the snapshot and ledger the run was derived from", () => {
    expect(evidence.summary.ledgerChecksumSha256).toBe(exteriorArtifactChecksum(committedLedger));
    expect(evidence.summary.baseManifestChecksumSha256).toBe(EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
    expect(evidence.summary.generatedAt).toBe(EXTERIOR_FULLSNAPSHOT_GENERATED_AT);
  });
});
