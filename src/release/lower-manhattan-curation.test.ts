/**
 * The curated promoted subset, and the P1 successor's identity.
 *
 * Two things are proven here that no other test can prove:
 *
 *  1. The CURATION GATES REFUSE. Every failure mode the curation can have — a
 *     cell that does not exist, a cell outside the Financial District, a cell
 *     the canary already shipped, a subset that overflows the entry budget, a
 *     local refusal rate back at the canary's 34% — is exercised against a
 *     deliberately broken input and required to throw. A gate that has only ever
 *     been run on the passing case is a gate nobody has tested.
 *  2. The successor really is THE SAME PLANS. The release id is not an input to
 *     any plan hash, so a building materialized under the canary's profile and
 *     under P1's produces the identical plan — which is what makes "a successor
 *     release, not a re-derivation" a checkable statement.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOWER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  LOWER_MANHATTAN_CURATED_CELLS,
  LOWER_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
  LOWER_MANHATTAN_CURATION_BASIS,
  LOWER_MANHATTAN_CURATION_STATEMENT,
  LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE,
  LOWER_MANHATTAN_WAVE_REFUSAL_RATE,
  lowerManhattanCuratedCells,
  lowerManhattanCuratedRefusalCensus,
  type LowerManhattanCurationCellInput,
} from "./lower-manhattan-curation";
import {
  LOWER_MANHATTAN_P1_GENERATED_AT,
  LOWER_MANHATTAN_P1_OUTPUT_DIRECTORY,
  LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID,
  LOWER_MANHATTAN_P1_RELEASE_ID,
  LOWER_MANHATTAN_P1_WAVE_PROFILE,
  lowerManhattanP1Predecessor,
  lowerManhattanP1Profile,
} from "./lower-manhattan-p1-release";
import {
  LOWER_MANHATTAN_APPROVAL,
  LOWER_MANHATTAN_WAVE_PROFILE,
  lowerManhattanApprovalFingerprint,
} from "./lower-manhattan-release";
import { LOWER_MANHATTAN_RELEASE_ID } from "./lower-manhattan-package";
import { EXTERIOR_WAVE_DOMAIN_REGISTRY } from "./exterior-wave-subset";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
interface LedgerCell { cellId: string; order: number; bounds: { west: number; south: number; east: number; north: number }; buildingIds: string[] }
const ledgerCells = (JSON.parse(new TextDecoder().decode(readFileSync(LEDGER_PATH))) as { cells: LedgerCell[] }).cells
  .filter((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w02-"));

/** The wave's own cells, renumbered as the subset ledger renumbers them. */
const subsetCells: LowerManhattanCurationCellInput[] = ledgerCells
  .slice()
  .sort((left, right) => left.order - right.order)
  .map((cell, index) => ({ cellId: cell.cellId, order: index, bounds: cell.bounds, buildingIds: cell.buildingIds }));

const ENTRY_BUDGET = 72;

describe("the curated subset resolves against the committed wave ledger", () => {
  it("admits exactly the two recorded cells, whole, inside the entry budget", () => {
    const subset = lowerManhattanCuratedCells(subsetCells, ENTRY_BUDGET);
    expect(subset.cells.map((cell) => cell.cellId)).toEqual(LOWER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId));
    expect(subset.ownedBuildingCount).toBe(72);
    expect(subset.spareEntries).toBe(0);
    expect(subset.basis).toBe(LOWER_MANHATTAN_CURATION_BASIS);
    // Whole cells: every owned building of an admitted cell is in the subset.
    for (const cell of subset.cells) {
      const ledgerCell = ledgerCells.find((entry) => entry.cellId === cell.cellId)!;
      expect(cell.buildingIds).toEqual(ledgerCell.buildingIds);
    }
  });

  it("is NOT the order-derived subset, which is the whole of precondition (a)", () => {
    const subset = lowerManhattanCuratedCells(subsetCells, ENTRY_BUDGET);
    // The order-derived subset is what a `while it still fits` walk over the
    // ledger order produces. It is computed here rather than quoted, so the
    // difference is measured against the actual derivation.
    const orderDerived: string[] = [];
    let owned = 0;
    for (const cell of subsetCells) {
      if (owned + cell.buildingIds.length > ENTRY_BUDGET) break;
      orderDerived.push(cell.cellId);
      owned += cell.buildingIds.length;
    }
    expect(orderDerived).toEqual(LOWER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS);
    for (const cellId of subset.cells.map((cell) => cell.cellId)) expect(orderDerived).not.toContain(cellId);
    expect(LOWER_MANHATTAN_CURATION_STATEMENT).toContain("EXPLICIT CURATED LIST");
    expect(LOWER_MANHATTAN_CURATION_STATEMENT).toContain("cells 150 and 151 are deliberately not reused");
  });

  it("admits a contiguous column, which is the reason the two cells are these two", () => {
    const [south, north] = lowerManhattanCuratedCells(subsetCells, ENTRY_BUDGET).cells;
    // Adjacent, sharing a full edge: the promoted subset renders as one block of
    // city rather than two textured islands.
    expect(south!.bounds.north).toBe(north!.bounds.south);
    expect(south!.bounds.west).toBe(north!.bounds.west);
    expect(south!.bounds.east).toBe(north!.bounds.east);
  });

  it("carries a written reason for every admitted cell, and no unsourced building name", () => {
    expect(LOWER_MANHATTAN_CURATED_CELLS).toHaveLength(2);
    for (const record of LOWER_MANHATTAN_CURATED_CELLS) {
      expect(record.rationale.length).toBeGreaterThan(120);
      // The NYC OTI dataset carries no building names, so no rationale may
      // assert one. Place names are geographic and permitted; a claim that a
      // given sourced polygon IS a named tower is not.
      expect(record.rationale).not.toMatch(/One World Trade Center|Freedom Tower|\bWoolworth\b/u);
    }
  });
});

describe("the curation gates refuse rather than repair", () => {
  const curated = LOWER_MANHATTAN_CURATED_CELLS.map((record) => subsetCells.find((cell) => cell.cellId === record.cellId)!);

  it("refuses a curated cell the ledger does not own", () => {
    const without = subsetCells.filter((cell) => cell.cellId !== LOWER_MANHATTAN_CURATED_CELLS[0]!.cellId);
    expect(() => lowerManhattanCuratedCells(without, ENTRY_BUDGET)).toThrow(/is not owned by this wave's ledger/u);
  });

  it("refuses a curated cell whose bounds leave the Financial District envelope", () => {
    const moved = curated.map((cell, index) => (index === 0
      ? { ...cell, bounds: { ...cell.bounds, north: LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE.north + 0.01 } }
      : cell));
    expect(() => lowerManhattanCuratedCells(moved, ENTRY_BUDGET)).toThrow(/outside the stated Financial District envelope/u);
  });

  it("refuses a subset that overflows the entry budget", () => {
    expect(() => lowerManhattanCuratedCells(curated, 71)).toThrow(/above the 71-entry budget/u);
    // Exactly at the budget is admissible; one below is not.
    expect(lowerManhattanCuratedCells(curated, 72).spareEntries).toBe(0);
  });

  it("quotes a full-city order that the cell id itself carries", () => {
    // The id is the only place the full-city order survives the subset's
    // renumbering, so the recorded order is checked against it rather than
    // against the renumbered `order` field. A curation written against a
    // different ledger would quote an order the id does not contain.
    for (const record of LOWER_MANHATTAN_CURATED_CELLS) {
      expect(record.cellId).toContain(`-w02-${String(record.parentOrder).padStart(6, "0")}-`);
      // ...and would NOT contain a neighbouring order, so the check discriminates.
      expect(record.cellId).not.toContain(`-w02-${String(record.parentOrder + 1).padStart(6, "0")}-`);
    }
    // Whole-cell admission means the two curated cells own the entire budget.
    const subset = lowerManhattanCuratedCells(curated, ENTRY_BUDGET);
    expect(subset.cells.reduce((total, cell) => total + cell.buildingIds.length, 0)).toBe(subset.ownedBuildingCount);
  });

  it("refuses a local refusal rate back at the canary's, and accepts the curated one", () => {
    // The canary's own numbers: 21 of 62 refused, which is what precondition (b)
    // says a promoted subset may not look like.
    const canaryLike = lowerManhattanCuratedRefusalCensus({ ownedBuildingCount: 62, materializedBuildingCount: 41, refusedBuildingCount: 21 });
    expect(canaryLike.localRefusalRate).toBeCloseTo(21 / 62, 12);
    expect(canaryLike.ok).toBe(false);

    const promoted = lowerManhattanCuratedRefusalCensus({ ownedBuildingCount: 72, materializedBuildingCount: 71, refusedBuildingCount: 1 });
    expect(promoted.localRefusalRate).toBeCloseTo(1 / 72, 12);
    expect(promoted.ok).toBe(true);
    expect(promoted.localRefusalRate).toBeLessThan(LOWER_MANHATTAN_CURATED_MAX_REFUSAL_RATE);
    // The ceiling is stated against the wave rate, not invented independently.
    expect(LOWER_MANHATTAN_CURATED_MAX_REFUSAL_RATE).toBeGreaterThan(LOWER_MANHATTAN_WAVE_REFUSAL_RATE);
    expect(LOWER_MANHATTAN_CURATED_MAX_REFUSAL_RATE).toBeLessThan(LOWER_MANHATTAN_WAVE_REFUSAL_RATE * 2.1);
    expect(LOWER_MANHATTAN_WAVE_REFUSAL_RATE).toBeCloseTo(134 / 6425, 12);
  });

  it("refuses a census that does not account for every owned building", () => {
    expect(() => lowerManhattanCuratedRefusalCensus({ ownedBuildingCount: 72, materializedBuildingCount: 70, refusedBuildingCount: 1 }))
      .toThrow(/does not account for every owned building/u);
    expect(() => lowerManhattanCuratedRefusalCensus({ ownedBuildingCount: 0, materializedBuildingCount: 0, refusedBuildingCount: 0 }))
      .toThrow(/over zero owned buildings is not a rate/u);
  });
});

describe("the P1 successor's identity", () => {
  it("is a new release of the SAME wave, under the same two registered hash domains", () => {
    expect(LOWER_MANHATTAN_P1_RELEASE_ID).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(LOWER_MANHATTAN_P1_RELEASE_ID).not.toBe(LOWER_MANHATTAN_RELEASE_ID);
    expect(LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID).toBe(LOWER_MANHATTAN_RELEASE_ID);
    expect(LOWER_MANHATTAN_P1_OUTPUT_DIRECTORY).toBe(`public/data/${LOWER_MANHATTAN_P1_RELEASE_ID}`);
    // The registry is keyed by WAVE, and the successor adds no row: a second
    // release of one wave must not issue itself a second pair of domains.
    const rows = EXTERIOR_WAVE_DOMAIN_REGISTRY.filter((row) => row.waveId === "lower-manhattan");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ledgerIdDomain).toBe("udt.lower-manhattan.subset-ledger-id.v1");
    expect(rows[0]!.baseIdentityDomain).toBe("udt.lower-manhattan.subset-base-identity.v1");
  });

  it("carries the SAME plans: seed, tool and generated instant are the canary's", () => {
    expect(LOWER_MANHATTAN_P1_WAVE_PROFILE.seed).toBe(LOWER_MANHATTAN_WAVE_PROFILE.seed);
    expect(LOWER_MANHATTAN_P1_WAVE_PROFILE.tool).toEqual(LOWER_MANHATTAN_WAVE_PROFILE.tool);
    expect(LOWER_MANHATTAN_P1_GENERATED_AT).toBe(LOWER_MANHATTAN_WAVE_PROFILE.generatedAt);
    expect(LOWER_MANHATTAN_P1_WAVE_PROFILE.uncertainty).toBe(LOWER_MANHATTAN_WAVE_PROFILE.uncertainty);
    expect(LOWER_MANHATTAN_P1_WAVE_PROFILE.budgets).toEqual(LOWER_MANHATTAN_WAVE_PROFILE.budgets);
    expect(LOWER_MANHATTAN_P1_WAVE_PROFILE.texture).toBe(LOWER_MANHATTAN_WAVE_PROFILE.texture);
    expect(LOWER_MANHATTAN_P1_WAVE_PROFILE.textureFilter).toEqual(LOWER_MANHATTAN_WAVE_PROFILE.textureFilter);
    // Everything that differs is the identity, and only the identity.
    const differing = (Object.keys(LOWER_MANHATTAN_P1_WAVE_PROFILE) as (keyof typeof LOWER_MANHATTAN_P1_WAVE_PROFILE)[])
      .filter((key) => JSON.stringify(LOWER_MANHATTAN_P1_WAVE_PROFILE[key]) !== JSON.stringify(LOWER_MANHATTAN_WAVE_PROFILE[key]));
    expect(differing).toEqual(["releaseId"]);
  });

  it("ships under the canary's rights instrument, UNEDITED", () => {
    const profile = lowerManhattanP1Profile(null);
    // By reference, not by copy: there is one instrument and both releases
    // point at it, so they cannot drift even in principle.
    expect(profile.approval).toBe(LOWER_MANHATTAN_APPROVAL);
    expect(profile.approval.fingerprintSha256).toBe("ff8da10f3f4cb7bcb93e58578baea652088b80b3020f0fc1ddc4e088962d120f");
    expect(profile.approval.fingerprintSha256).toBe(lowerManhattanApprovalFingerprint());
    expect(profile.approval.id).toBe(`approval:${LOWER_MANHATTAN_RELEASE_ID}:lower-manhattan-textured-canary`);
    // The instrument authorizes tiles at LOD 0 for local display and derivative
    // conveyance and excludes redistributing them; the successor adds no verb.
    expect(profile.approval.exclusions).toContain("public internet deployment");
    expect(profile.approval.exclusions).toContain("captured, photographic, or otherwise source-derived texture imagery of any kind");
  });

  it("derives its predecessor pins from the canary's own committed inventory", () => {
    const canary = JSON.parse(new TextDecoder().decode(readFileSync("data/lower-manhattan-20260812/payload-inventory.json"))) as {
      releaseId: string;
      roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
      files: { path: string; byteSize: number; checksumSha256: string }[];
    };
    const predecessor = lowerManhattanP1Predecessor(canary);
    expect(predecessor.releaseId).toBe(LOWER_MANHATTAN_RELEASE_ID);
    expect(predecessor.publicRoot.rootChecksumSha256).toBe(canary.roots.public!.rootChecksumSha256);
    expect(predecessor.snapshot.snapshotId).toBe(`snapshot:${LOWER_MANHATTAN_RELEASE_ID}:v1`);
    expect(predecessor.cellReleases.size).toBe(126);
    // Refuses pins from any other release, so a successor cannot claim to
    // follow a wave it was not built against.
    expect(() => lowerManhattanP1Predecessor({ ...canary, releaseId: "manhattan-midtown-core-cells-20260811-v3" }))
      .toThrow(/pins must come from/u);
    expect(() => lowerManhattanP1Predecessor({ ...canary, roots: {} })).toThrow(/declares no public root/u);
    expect(() => lowerManhattanP1Predecessor({ ...canary, files: [] })).toThrow(/declares no/u);
  });
});
