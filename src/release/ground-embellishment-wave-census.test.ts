/**
 * The per-wave promotion gate for the near-tier curb release (Task T011).
 *
 * Two halves, deliberately separated by what they can depend on:
 *
 * 1. **The always-run half** reads the COMMITTED report at
 *    `artifacts/ground-embellishment-promotion-20260826/wave-curb-census.json`
 *    and re-applies every budget gate to it, plus the agreement between
 *    `GROUND_EMBELLISHMENT_CANARY_WAVES` and `EXTERIOR_WAVE_PLAN`. It never
 *    skips. A promotion record whose only check is `skipIf(releasePresent)` is
 *    unchecked on CI and on every fresh clone, which is exactly where drift
 *    survives — the same reason the exterior promotion records recompute from
 *    committed inventories rather than from untracked payload trees.
 * 2. **The re-measurement half** runs only where the 94 MB release tree is
 *    actually on disk (`public/data/` is not in the repository). It hashes every
 *    shipped artifact against the checksum `release.json` declares, measures the
 *    verified bytes with the production render planner, and requires the result
 *    to be byte-identical to the committed report. That is what makes the
 *    committed numbers evidence rather than assertion.
 *
 * Regenerate with `pnpm ground-embellishment:census`, which is this same file
 * run with `UDT_WRITE_GROUND_WAVE_CENSUS=1`. The report has no timestamp and no
 * absolute path in it, so a rerun over unchanged bytes rewrites it identically
 * and any diff is a real change.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { env } from "node:process";
import { beforeAll, describe, expect, it } from "vitest";

import { planGroundEmbellishmentCellRender } from "../features/explorer/ground-embellishment-render-plan.ts";
import {
  GROUND_EMBELLISHMENT_BUDGETS,
  GROUND_EMBELLISHMENT_CANARY_WAVES,
  GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
  MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
  type GroundEmbellishmentCellArtifact,
} from "../runtime/ground-embellishment-runtime.ts";
import { EXTERIOR_WAVE_PLAN, type ExteriorWaveId } from "./exterior-wave-ledger.ts";
import type { GroundOwnershipLedger, GroundReleaseDocument } from "./ground-release.ts";
import {
  GROUND_EMBELLISHMENT_WAVE_CENSUS_SCHEMA_VERSION,
  buildGroundEmbellishmentWaveCensus,
  groundEmbellishmentWaveForCell,
  serializeGroundEmbellishmentWaveCensus,
  type GroundEmbellishmentCellMeasurement,
  type GroundEmbellishmentWaveCensusReport,
} from "./ground-embellishment-wave-census.ts";

/** Repo-relative, the same convention the exterior promotion records read by. */
const RELEASE_ROOT = `public/data/${MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID}`;
const REPORT_DIRECTORY = "artifacts/ground-embellishment-promotion-20260826";
const REPORT_PATH = `${REPORT_DIRECTORY}/wave-curb-census.json`;
const WRITE_REPORT = env.UDT_WRITE_GROUND_WAVE_CENSUS === "1";

function readText(path: string): string {
  return new TextDecoder().decode(readFileSync(path));
}

/** WebCrypto, so this file needs no Node hashing surface it would have to declare. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** The near tier of one asset, by the same rule the runtime loader applies. */
function nearTier(asset: GroundReleaseDocument["assets"][number]) {
  const tier = asset.tiers.find((candidate) => candidate.kind === "near-3d"
    && typeof candidate.maxDistanceMeters === "number"
    && Number.isFinite(candidate.maxDistanceMeters)
    && candidate.maxDistanceMeters > 0);
  if (!tier) throw new Error(`Asset ${asset.assetId} declares no finite near-3d tier.`);
  return { ...tier, maxDistanceMeters: tier.maxDistanceMeters as number };
}

/**
 * Measure the release on disk, refusing to measure a byte it has not verified.
 */
async function measureShippedRelease(): Promise<GroundEmbellishmentCellMeasurement[]> {
  const document = JSON.parse(readText(`${RELEASE_ROOT}/release.json`)) as GroundReleaseDocument;
  if (document.releaseId !== MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID) {
    throw new Error(`Release root holds ${document.releaseId}, not the embellishment release.`);
  }
  const ledger = JSON.parse(readText(`${RELEASE_ROOT}/ledger.json`)) as GroundOwnershipLedger;
  const cellById = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
  const measurements: GroundEmbellishmentCellMeasurement[] = [];
  for (const asset of document.assets) {
    if (asset.class !== "curb") throw new Error(`Asset ${asset.assetId} is class ${asset.class}; this census measures curbs.`);
    const cell = cellById.get(asset.cellId);
    if (!cell) throw new Error(`Asset ${asset.assetId} names a cell outside the ownership ledger.`);
    const tier = nearTier(asset);
    const bytes = readFileSync(`${RELEASE_ROOT}/${tier.artifactRef}`);
    const digest = await sha256Hex(bytes);
    if (digest !== tier.checksumSha256) {
      throw new Error(`Artifact ${tier.artifactRef} hashes to ${digest}, not the declared ${tier.checksumSha256}; the census refuses to measure unverified bytes.`);
    }
    const artifact = JSON.parse(new TextDecoder().decode(bytes)) as GroundEmbellishmentCellArtifact;
    const plan = planGroundEmbellishmentCellRender(artifact);
    measurements.push({
      cellId: asset.cellId,
      order: cell.order,
      bounds: cell.bounds,
      maxDistanceMeters: tier.maxDistanceMeters,
      artifactBytes: bytes.byteLength,
      curbParts: artifact.partCount,
      drawnWalls: plan.walls.length,
      drawnSegments: plan.segments,
      refusedParts: plan.refusals.length,
    });
  }
  return measurements;
}

const releasePresent = existsSync(`${RELEASE_ROOT}/release.json`);

let committed: GroundEmbellishmentWaveCensusReport;

// Regeneration is a side effect of the one entrypoint that asks for it
// (`pnpm ground-embellishment:census`), and it happens before the drift gate
// reads the file so a single command both measures and records.
beforeAll(async () => {
  if (WRITE_REPORT) {
    if (!releasePresent) throw new Error(`Cannot regenerate the wave census: ${RELEASE_ROOT} is not on this machine.`);
    mkdirSync(REPORT_DIRECTORY, { recursive: true });
    writeFileSync(REPORT_PATH, serializeGroundEmbellishmentWaveCensus(buildGroundEmbellishmentWaveCensus(await measureShippedRelease())));
  }
  committed = JSON.parse(readText(REPORT_PATH)) as GroundEmbellishmentWaveCensusReport;
}, 120_000);

describe("near-tier curb promotion census (T011)", () => {
  it("promotes exactly the row-owning waves of the exterior plan, and says why the sixth is absent", () => {
    const rowOwning = EXTERIOR_WAVE_PLAN.filter((wave) => wave.tileRowRange !== null).map((wave) => wave.waveId);
    const withoutRows = EXTERIOR_WAVE_PLAN.filter((wave) => wave.tileRowRange === null).map((wave) => wave.waveId);
    // The constant is hand-written so that deleting one line is a per-wave
    // rollback; this is the drift gate that keeps it equal to the plan anyway.
    expect([...GROUND_EMBELLISHMENT_CANARY_WAVES]).toEqual(rowOwning);
    expect(withoutRows).toEqual(["block-835"]);
    expect(committed.wavesWithoutTileRows.map((wave) => wave.waveId)).toEqual(withoutRows);
    for (const wave of committed.wavesWithoutTileRows) expect(wave.reason.length).toBeGreaterThan(80);
    expect(committed.promotedWaves).toEqual([...GROUND_EMBELLISHMENT_CANARY_WAVES]);
  });

  it("covers the whole island's level-14 rows, 4471 to 4488, with no gap and no overlap", () => {
    const rows: number[] = [];
    for (const wave of committed.waves) {
      for (let rowY = wave.tileRowRange.northRowY; rowY <= wave.tileRowRange.southRowY; rowY += 1) rows.push(rowY);
    }
    const sorted = [...rows].sort((left, right) => left - right);
    expect(new Set(rows).size).toBe(rows.length);
    expect(sorted[0]).toBe(4471);
    expect(sorted.at(-1)).toBe(4488);
    expect(sorted).toEqual(Array.from({ length: 4488 - 4471 + 1 }, (_, index) => 4471 + index));
  });

  /**
   * The two budget gates, re-applied to the committed numbers.
   *
   * A wave that breached would have to be left out of
   * `GROUND_EMBELLISHMENT_CANARY_WAVES` with the reason recorded; this test is
   * what would make that non-optional.
   */
  it("keeps every promoted wave inside the serving ceiling and the active-cell ceiling", () => {
    expect(committed.servingCeilingBytes).toBe(GROUND_EMBELLISHMENT_BUDGETS.maxArtifactBytes);
    expect(committed.maxActiveCells).toBe(GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS);
    for (const wave of committed.waves) {
      expect(wave.largestArtifact?.overServingCeiling ?? false).toBe(false);
      expect(wave.worstCaseActiveSet.cells).toBeLessThanOrEqual(GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS);
      expect(wave.breachesBudget).toBe(false);
    }
    expect(committed.promotedRelease.largestArtifact?.overServingCeiling ?? false).toBe(false);
    expect(committed.promotedRelease.worstCaseActiveSet.cells).toBeLessThanOrEqual(GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS);
    expect(committed.budgetBreaches).toEqual([]);
  });

  it("reports the promoted release as the sum of its promoted waves, and nothing else", () => {
    const promoted = committed.waves.filter((wave) => wave.promoted);
    expect(promoted).toHaveLength(GROUND_EMBELLISHMENT_CANARY_WAVES.length);
    const sum = (pick: (wave: (typeof promoted)[number]) => number) => promoted.reduce((total, wave) => total + pick(wave), 0);
    expect(committed.promotedRelease.cellsWithCurbArtifacts).toBe(sum((wave) => wave.cellsWithCurbArtifacts));
    expect(committed.promotedRelease.totalArtifactBytes).toBe(sum((wave) => wave.totalArtifactBytes));
    expect(committed.promotedRelease.curbParts).toBe(sum((wave) => wave.curbParts));
    expect(committed.promotedRelease.drawnSegments).toBe(sum((wave) => wave.drawnSegments));
    expect(committed.promotedRelease.drawnTriangles).toBe(committed.promotedRelease.drawnSegments * 2);
    // Cells south of every wave ship curbs and are never promoted; the report
    // states them rather than letting them vanish into a total.
    for (const cellId of committed.shippedCellsInNoWaveRow.cellIds) {
      expect(groundEmbellishmentWaveForCell(cellId)).toBeNull();
    }
  });

  /**
   * Rollback, rehearsed on the evidence rather than only on the constant.
   *
   * Dropping one wave from the promoted set must remove exactly that wave's
   * cells and bytes from the promoted release and leave every other wave's
   * numbers untouched — which is the property that makes a one-line revert a
   * safe operation.
   */
  it("rehearses a single-wave rollback as an exact subtraction", () => {
    const dropped: ExteriorWaveId = "northern-manhattan";
    const remaining: readonly ExteriorWaveId[] = GROUND_EMBELLISHMENT_CANARY_WAVES.filter((waveId) => waveId !== dropped);
    const droppedWave = committed.waves.find((wave) => wave.waveId === dropped)!;
    expect(droppedWave.cellsWithCurbArtifacts).toBeGreaterThan(0);
    expect(committed.promotedRelease.cellsWithCurbArtifacts - droppedWave.cellsWithCurbArtifacts)
      .toBe(committed.waves.filter((wave) => remaining.includes(wave.waveId)).reduce((total, wave) => total + wave.cellsWithCurbArtifacts, 0));
    expect(committed.promotedRelease.totalArtifactBytes - droppedWave.totalArtifactBytes)
      .toBe(committed.waves.filter((wave) => remaining.includes(wave.waveId)).reduce((total, wave) => total + wave.totalArtifactBytes, 0));
  });

  it("is a report this repository can read: schema, release and shape pinned", () => {
    expect(committed.schemaVersion).toBe(GROUND_EMBELLISHMENT_WAVE_CENSUS_SCHEMA_VERSION);
    expect(committed.releaseId).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID);
    expect(committed.waves.map((wave) => wave.waveIndex)).toEqual([...committed.waves].map((wave) => wave.waveIndex).sort((left, right) => left - right));
  });
});

describe.skipIf(!releasePresent)("near-tier curb promotion census, re-measured from the shipped bytes", () => {
  /**
   * The committed report is exactly what the verified release measures to.
   *
   * Every artifact is re-hashed against its declared checksum inside
   * `measureShippedRelease`, so a byte-identical result also proves the release
   * tree on this machine is the one the report describes.
   */
  it("re-measures byte-identically from the checksum-verified release tree", async () => {
    const measurements = await measureShippedRelease();
    expect(measurements.length).toBeGreaterThan(0);
    const rebuilt = buildGroundEmbellishmentWaveCensus(measurements);
    expect(serializeGroundEmbellishmentWaveCensus(rebuilt)).toBe(readText(REPORT_PATH));
    expect(rebuilt.budgetBreaches).toEqual([]);
  }, 120_000);
});
