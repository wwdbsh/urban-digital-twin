import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import { EXTERIOR_WAVE_PLAN } from "./exterior-wave-ledger.ts";
import {
  EXTERIOR_WAVE_DOMAIN_REGISTRY,
  assertDistinctWaveDomains,
  buildExteriorWaveSubsetLedger,
  deriveExteriorWaveRenderableCells,
  exteriorWaveArtifactChecksum,
  type ExteriorWaveSubsetIdentity,
} from "./exterior-wave-subset.ts";
import { lowerManhattanRenderableCells } from "./lower-manhattan-release.ts";
import { southernRemainderRenderableCells } from "./southern-remainder-release.ts";
import { centralUpperManhattanRenderableCells } from "./central-upper-manhattan-release.ts";
import { northernManhattanRenderableCells } from "./northern-manhattan-release.ts";
import { MIDTOWN_CORE_SUBSET_IDENTITY } from "./midtown-core-package.ts";
import { LOWER_MANHATTAN_SUBSET_IDENTITY } from "./lower-manhattan-package.ts";
import { SOUTHERN_REMAINDER_SUBSET_IDENTITY } from "./southern-remainder-package.ts";
import { CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY } from "./central-upper-manhattan-package.ts";
import { NORTHERN_MANHATTAN_SUBSET_IDENTITY } from "./northern-manhattan-package.ts";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const parentLedger = JSON.parse(readText(`${LEDGER_ROOT}/ledger.json`)) as ExteriorOwnershipLedger;
const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);

/**
 * A further wave, written the way a further wave actually gets written: by
 * copying the wave above it. Copying the domain strings along with everything
 * else is the specific mistake this guard exists for.
 *
 * IT NAMES A WAVE THAT DOES NOT EXIST, AND THAT IS THE POINT NOW.
 *
 * This hypothetical was wave `w03`, then `w04`, then `w05`, moving on each time
 * the wave it named became real — because a hypothetical that names a REGISTERED
 * wave stops testing what it says it tests: the registry would then have two
 * reasons to refuse it, the borrow and the reassignment of that wave's own
 * registered strings, and which error surfaced would depend on the order of the
 * rows rather than on the defect.
 *
 * T021 registered `northern-manhattan`, which is `w05`, and the committed ledger
 * declares exactly six waves, `w00` through `w05`. So there is no next real wave
 * to move to, and the two wrong ways out are the ones the previous comment named:
 * inventing a seventh wave that the ledger does not declare, or leaving this on a
 * now-registered `w05`. Both were refused.
 *
 * Instead the id is FICTIONAL BY CONSTRUCTION — `hypothetical-wave-w06`, a string
 * no wave plan contains and no wave module will ever claim — so this stays a test
 * about an UNREGISTERED wave permanently, without asserting that a seventh wave
 * exists. Registering it would be registering a wave that owns nothing, which
 * `covers every wave the committed plan declares` below actively refuses.
 *
 * A fictional id changes nothing structurally, and that was checked rather than
 * assumed: `assertDistinctWaveDomains` never consults the wave plan, and every
 * builder-level assertion in this suite throws inside that guard before any
 * ledger work begins, so a `waveIndex` with no plan entry is never reached.
 *
 * ITS DECLARED SHAPE IS ZERO, deliberately. Earlier versions carried the real
 * counts of the real wave they named, because carrying the PREVIOUS wave's counts
 * would have been a copy-paste defect inside the test for copy-paste defects. A
 * wave that does not exist owns no cell and no building, so zero is the only
 * honest declaration; and like `waveIndex`, neither number is ever read, because
 * the guard refuses the identity before the builder selects a single cell.
 */
const HYPOTHETICAL_WAVE_BORROWING_MIDTOWN: ExteriorWaveSubsetIdentity = {
  releaseId: "manhattan-hypothetical-wave-w06-cells-00000000",
  waveIndex: 6,
  waveId: "hypothetical-wave-w06",
  cellCount: 0,
  buildingCount: 0,
  ledgerIdDomain: "udt.midtown-core.subset-ledger-id.v1",
  baseIdentityDomain: "udt.midtown-core.subset-base-identity.v1",
  exclusionWaveIndexes: [0, 1, 2, 3, 4, 5],
};

/** Fresh strings for the hypothetical, owned by nothing and by nobody. */
const HYPOTHETICAL_FRESH_DOMAINS = {
  ledgerIdDomain: "udt.hypothetical-wave-w06.subset-ledger-id.v1",
  baseIdentityDomain: "udt.hypothetical-wave-w06.subset-base-identity.v1",
} as const;

describe("exterior wave hash-domain registry", () => {
  it("registers exactly the waves that have issued domains, with no string used twice", () => {
    const strings = EXTERIOR_WAVE_DOMAIN_REGISTRY.flatMap((entry) => [entry.ledgerIdDomain, entry.baseIdentityDomain]);
    expect(new Set(strings).size).toBe(strings.length);
    expect(new Set(EXTERIOR_WAVE_DOMAIN_REGISTRY.map((entry) => entry.waveId)).size).toBe(EXTERIOR_WAVE_DOMAIN_REGISTRY.length);
  });

  /**
   * THE REGISTRY IS NOW COMPLETE FOR THE COMMITTED LEDGER, AND THAT IS ASSERTED
   * RATHER THAN NOTED IN PROSE.
   *
   * Every wave the declared plan contains issues subset domains EXCEPT wave `w00`
   * (Block 835), which predates this machinery and derives no subset ledger at
   * all. So the registry's wave ids must be exactly the plan's, minus that one.
   *
   * It fails in both directions on purpose. A future ledger that declared a
   * seventh wave would go red here until that wave got a row — which is the whole
   * job of the closed table, applied to the plan rather than to whoever remembered
   * — and a row invented for a wave the plan does not contain would go red too,
   * which is what stops the hypothetical above from being "fixed" by registering
   * it.
   */
  it("covers every wave the committed plan declares that derives a subset, and no other", () => {
    const expected = EXTERIOR_WAVE_PLAN.filter((wave) => wave.waveIndex !== 0).map((wave) => wave.waveId).sort();
    expect(EXTERIOR_WAVE_DOMAIN_REGISTRY.map((entry) => entry.waveId).sort()).toEqual(expected);
    expect(expected).toHaveLength(5);
    // The fictional wave the hypothetical names is not in the plan, so it can
    // never be registered without failing the assertion above.
    expect(EXTERIOR_WAVE_PLAN.some((wave) => wave.waveId === HYPOTHETICAL_WAVE_BORROWING_MIDTOWN.waveId)).toBe(false);
  });

  /**
   * The registry is the authority, and each wave module is CHECKED against it
   * rather than trusted to agree. A wave whose module drifted from its row would
   * otherwise move ids that are already committed.
   */
  it("agrees with what the five live wave modules declare", () => {
    const live = [MIDTOWN_CORE_SUBSET_IDENTITY, LOWER_MANHATTAN_SUBSET_IDENTITY, SOUTHERN_REMAINDER_SUBSET_IDENTITY, CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY, NORTHERN_MANHATTAN_SUBSET_IDENTITY];
    // Every row has a live module, not merely every live module a row: a row for
    // a wave no module declares would otherwise sit here unchecked forever.
    expect(live.map((identity) => identity.waveId).sort()).toEqual(EXTERIOR_WAVE_DOMAIN_REGISTRY.map((entry) => entry.waveId).sort());
    for (const identity of live) {
      const registered = EXTERIOR_WAVE_DOMAIN_REGISTRY.find((entry) => entry.waveId === identity.waveId);
      expect(registered).toBeDefined();
      expect(registered!.ledgerIdDomain).toBe(identity.ledgerIdDomain);
      expect(registered!.baseIdentityDomain).toBe(identity.baseIdentityDomain);
      expect(() => { assertDistinctWaveDomains(identity); }).not.toThrow();
    }
  });

  /** The failure this guard was added for, named by its owner rather than merely refused. */
  it("refuses a further wave that borrows the midtown domains, naming midtown-core", () => {
    expect(() => { assertDistinctWaveDomains(HYPOTHETICAL_WAVE_BORROWING_MIDTOWN); })
      .toThrow(/borrows hash domain "udt\.midtown-core\.subset-ledger-id\.v1", which is issued to wave midtown-core/u);
  });

  it("refuses a borrowed base-identity domain even when the ledger domain is fresh", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: HYPOTHETICAL_FRESH_DOMAINS.ledgerIdDomain,
      });
    }).toThrow(/issued to wave midtown-core/u);
  });

  it("refuses borrowing from the lower-manhattan wave too, not just from the first one registered", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: HYPOTHETICAL_FRESH_DOMAINS.ledgerIdDomain,
        baseIdentityDomain: "udt.lower-manhattan.subset-base-identity.v1",
      });
    }).toThrow(/issued to wave lower-manhattan/u);
  });

  /**
   * The row this task added, checked the only way that means anything: by
   * proving the registry now REFUSES what it used to allow. Before
   * `southern-remainder` had a row, both of these strings were unowned and a
   * fourth wave could have taken them silently.
   */
  it("refuses borrowing from the southern-remainder wave, naming southern-remainder", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: "udt.southern-remainder.subset-ledger-id.v1",
        baseIdentityDomain: HYPOTHETICAL_FRESH_DOMAINS.baseIdentityDomain,
      });
    }).toThrow(/borrows hash domain "udt\.southern-remainder\.subset-ledger-id\.v1", which is issued to wave southern-remainder/u);
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: HYPOTHETICAL_FRESH_DOMAINS.ledgerIdDomain,
        baseIdentityDomain: "udt.southern-remainder.subset-base-identity.v1",
      });
    }).toThrow(/issued to wave southern-remainder/u);
  });

  /**
   * The row T019 added, checked the only way that means anything: by proving the
   * registry now REFUSES what it used to allow. Before
   * `central-upper-manhattan` had a row, both of these strings were unowned.
   */
  it("refuses borrowing from the central-upper-manhattan wave, naming central-upper-manhattan", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: "udt.central-upper-manhattan.subset-ledger-id.v1",
        baseIdentityDomain: HYPOTHETICAL_FRESH_DOMAINS.baseIdentityDomain,
      });
    }).toThrow(/borrows hash domain "udt\.central-upper-manhattan\.subset-ledger-id\.v1", which is issued to wave central-upper-manhattan/u);
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: HYPOTHETICAL_FRESH_DOMAINS.ledgerIdDomain,
        baseIdentityDomain: "udt.central-upper-manhattan.subset-base-identity.v1",
      });
    }).toThrow(/issued to wave central-upper-manhattan/u);
  });

  /**
   * THE ROW THIS TASK ADDED, and the one whose absence was most likely to go
   * unnoticed, because `udt.northern-manhattan.*` was this suite's own STANDING
   * EXAMPLE of a fresh, unowned domain. Every borrow test above used one of these
   * two strings as the half of the identity that was fine. Any of them could have
   * been copied into a real sixth wave module and the registry would have said
   * nothing.
   *
   * Both strings are now issued, and the same two calls that used to pass now
   * name `northern-manhattan` as their owner.
   */
  it("refuses borrowing from the northern-manhattan wave, naming northern-manhattan", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: "udt.northern-manhattan.subset-ledger-id.v1",
        baseIdentityDomain: HYPOTHETICAL_FRESH_DOMAINS.baseIdentityDomain,
      });
    }).toThrow(/borrows hash domain "udt\.northern-manhattan\.subset-ledger-id\.v1", which is issued to wave northern-manhattan/u);
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: HYPOTHETICAL_FRESH_DOMAINS.ledgerIdDomain,
        baseIdentityDomain: "udt.northern-manhattan.subset-base-identity.v1",
      });
    }).toThrow(/issued to wave northern-manhattan/u);
  });

  it("refuses one domain doing both jobs", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN,
        ledgerIdDomain: "udt.hypothetical-wave-w06.subset.v1",
        baseIdentityDomain: "udt.hypothetical-wave-w06.subset.v1",
      });
    }).toThrow(/for both derived ids/u);
  });

  /**
   * The case the closed table exists for, and the one it used to miss.
   *
   * A new wave module written in isolation, with perfectly fresh domains,
   * collided with nothing and passed silently — so the table's completeness was
   * enforced by whoever remembered to add a row and by nothing else. The check
   * runs LAST, so a module copied from another wave still reports the borrow
   * rather than the missing row: the borrow names the wave to fix.
   */
  it("refuses a wave that has no row at all, however fresh its domains", () => {
    const unregistered = { ...HYPOTHETICAL_WAVE_BORROWING_MIDTOWN, ...HYPOTHETICAL_FRESH_DOMAINS };
    expect(() => { assertDistinctWaveDomains(unregistered); })
      .toThrow(/hypothetical-wave-w06 is not in the closed domain registry/u);
    // And the builder refuses it before it derives anything, as with a borrow.
    // This is also the assertion that proves a `waveIndex` with no plan entry is
    // never reached: index 6 does not exist in `EXTERIOR_WAVE_PLAN`, and what
    // surfaces is the registry error rather than a plan lookup failure.
    expect(() => buildExteriorWaveSubsetLedger(unregistered, {
      parentLedger,
      parentLedgerChecksumSha256,
      baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
      baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    })).toThrow(/not in the closed domain registry/u);
  });

  /** A borrow still wins over the missing row, because it names the wave to fix. */
  it("reports the borrow rather than the missing row when both are true", () => {
    expect(() => { assertDistinctWaveDomains(HYPOTHETICAL_WAVE_BORROWING_MIDTOWN); })
      .toThrow(/borrows hash domain/u);
  });

  /** A registered wave may not quietly reassign its own strings either. */
  it("refuses a registered wave that arrives with different domains", () => {
    expect(() => {
      assertDistinctWaveDomains({ ...LOWER_MANHATTAN_SUBSET_IDENTITY, ledgerIdDomain: "udt.lower-manhattan.subset-ledger-id.v2" });
    }).toThrow(/differ from its registered ones/u);
    expect(() => {
      assertDistinctWaveDomains({ ...SOUTHERN_REMAINDER_SUBSET_IDENTITY, baseIdentityDomain: "udt.southern-remainder.subset-base-identity.v2" });
    }).toThrow(/differ from its registered ones/u);
    expect(() => {
      assertDistinctWaveDomains({ ...CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY, ledgerIdDomain: "udt.central-upper-manhattan.subset-ledger-id.v2" });
    }).toThrow(/differ from its registered ones/u);
    expect(() => {
      assertDistinctWaveDomains({ ...NORTHERN_MANHATTAN_SUBSET_IDENTITY, baseIdentityDomain: "udt.northern-manhattan.subset-base-identity.v2" });
    }).toThrow(/differ from its registered ones/u);
  });

  /**
   * The guard has to run inside the builder, not merely be available beside it.
   * It is asserted BEFORE any ledger work, so a borrowed identity never reaches
   * the point of deriving an id.
   */
  it("is enforced by the subset builder itself", () => {
    expect(() => buildExteriorWaveSubsetLedger(HYPOTHETICAL_WAVE_BORROWING_MIDTOWN, {
      parentLedger,
      parentLedgerChecksumSha256,
      baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
      baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    })).toThrow(/borrows hash domain/u);
  });
});

/**
 * THE EXTRACTED RENDERABLE-CELL WALK, PINNED TO THE THREE COPIES IT REPLACES.
 *
 * Waves `w02`, `w03` and `w04` each carry a private copy of this walk inside their
 * own release module. Those copies are NOT edited by this task: they are the code
 * three shipped releases were emitted by, and rewriting them to delegate would
 * change modules that describe frozen bytes for no behavioural reason.
 *
 * That leaves the risk the extraction was meant to remove — four implementations
 * of one rule, free to drift — so the anti-drift guarantee is supplied by
 * assertion instead. Every copy is run beside the generic function over the same
 * inputs and required to agree on the cells chosen, the buildings owned, the spare
 * entries, and on whether the budget is refusable at all.
 *
 * Only the ERROR TEXT is allowed to differ, and deliberately: the generic version
 * names the leading cell's size, because "no cell fits" alone sends a reader
 * looking for a bug in the walk when the actual fact is that a wave's first cell is
 * larger than the whole budget. That is exactly the case wave `w05` hit.
 */
describe("wave-generic renderable-cell walk", () => {
  const cells = [
    { cellId: "a", buildingIds: Array.from({ length: 25 }, (_, index) => `a${index}`) },
    { cellId: "b", buildingIds: Array.from({ length: 51 }, (_, index) => `b${index}`) },
    { cellId: "c", buildingIds: Array.from({ length: 2 }, (_, index) => `c${index}`) },
    { cellId: "d", buildingIds: Array.from({ length: 50 }, (_, index) => `d${index}`) },
  ];
  const copies = [
    { waveId: "lower-manhattan", walk: lowerManhattanRenderableCells },
    { waveId: "southern-remainder", walk: southernRemainderRenderableCells },
    { waveId: "central-upper-manhattan", walk: centralUpperManhattanRenderableCells },
  ];

  it("agrees with all three per-wave copies over every budget, including the refusing ones", () => {
    for (let entryBudget = 1; entryBudget <= 200; entryBudget += 1) {
      let generic: { cells: { cellId: string }[]; ownedBuildingCount: number; spareEntries: number } | null = null;
      let genericThrew = false;
      try { generic = deriveExteriorWaveRenderableCells(cells, entryBudget, "any-wave"); } catch { genericThrew = true; }
      for (const copy of copies) {
        let mirror: { cells: { cellId: string }[]; ownedBuildingCount: number; spareEntries: number } | null = null;
        let mirrorThrew = false;
        try { mirror = copy.walk(cells, entryBudget); } catch { mirrorThrew = true; }
        expect(mirrorThrew, `${copy.waveId} at budget ${entryBudget}`).toBe(genericThrew);
        if (genericThrew) continue;
        expect(mirror!.cells.map((cell) => cell.cellId)).toEqual(generic!.cells.map((cell) => cell.cellId));
        expect(mirror!.ownedBuildingCount).toBe(generic!.ownedBuildingCount);
        expect(mirror!.spareEntries).toBe(generic!.spareEntries);
      }
    }
  });

  /**
   * The one thing the generic version adds, and the reason it was worth extracting
   * rather than copying: the walk now says WHY it stopped. A one-cell subset can
   * mean the budget ran out or the wave did, and the chosen list cannot tell them
   * apart.
   */
  it("reports the first cell the budget could not admit, and null when every cell fit", () => {
    expect(deriveExteriorWaveRenderableCells(cells, 80, "any-wave").stoppedAt)
      .toEqual({ cellId: "d", buildingCount: 50, wouldHaveTotalled: 128 });
    expect(deriveExteriorWaveRenderableCells(cells, 128, "any-wave").stoppedAt).toBeNull();
    expect(deriveExteriorWaveRenderableCells(cells, 128, "any-wave").cells.map((cell) => cell.cellId)).toEqual(["a", "b", "c", "d"]);
  });

  /**
   * THE SAME AGREEMENT, AT LEDGER SCALE AND AGAINST WHAT EACH WAVE ACTUALLY
   * SHIPPED.
   *
   * The case above compares four synthetic cells. That proves the implementations
   * agree; it does not prove the generic walk would have produced the subsets three
   * releases were emitted with, which is the claim the extraction actually rests on.
   *
   * So each wave's real cells are derived from the committed parent ledger, the
   * generic walk and that wave's own copy are run over them at the entry budget
   * that wave's committed inventory records, and both are required to reproduce the
   * `renderableCellIds` in those committed bytes exactly. A drift in the generic
   * walk that the synthetic fixture happened not to exercise would fail here
   * against three frozen records.
   *
   * The `w04` P1 successor is deliberately absent: its subset is a CURATED list,
   * not a walk of the ledger order, so it is not this function's output and
   * comparing against it would assert something false.
   */
  it("reproduces the committed renderable subset of every order-derived wave canary", () => {
    const canaries = [
      { waveIndex: 2, waveId: "lower-manhattan", identity: LOWER_MANHATTAN_SUBSET_IDENTITY, walk: lowerManhattanRenderableCells, recordRoot: "data/lower-manhattan-20260812" },
      { waveIndex: 3, waveId: "southern-remainder", identity: SOUTHERN_REMAINDER_SUBSET_IDENTITY, walk: southernRemainderRenderableCells, recordRoot: "data/southern-remainder-20260812" },
      { waveIndex: 4, waveId: "central-upper-manhattan", identity: CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY, walk: centralUpperManhattanRenderableCells, recordRoot: "data/central-upper-manhattan-20260812" },
      { waveIndex: 5, waveId: "northern-manhattan", identity: NORTHERN_MANHATTAN_SUBSET_IDENTITY, walk: northernManhattanRenderableCells, recordRoot: "data/northern-manhattan-20260812" },
    ];
    for (const canary of canaries) {
      const inventory = JSON.parse(readText(`${canary.recordRoot}/payload-inventory.json`)) as {
        occupancy: { entryBudget: number };
        renderableCellIds: string[];
      };
      const subset = buildExteriorWaveSubsetLedger(canary.identity, {
        parentLedger,
        parentLedgerChecksumSha256,
        baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
        baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
      });
      const budget = inventory.occupancy.entryBudget;
      const generic = deriveExteriorWaveRenderableCells(subset.ledger.cells, budget, canary.waveId);
      const mirror = canary.walk(subset.ledger.cells, budget);
      expect(generic.cells.map((cell) => cell.cellId), canary.waveId).toEqual(inventory.renderableCellIds);
      expect(mirror.cells.map((cell) => cell.cellId), canary.waveId).toEqual(inventory.renderableCellIds);
      expect(mirror.ownedBuildingCount, canary.waveId).toBe(generic.ownedBuildingCount);
      expect(mirror.spareEntries, canary.waveId).toBe(generic.spareEntries);
      // Every one of these subsets was budget-limited rather than wave-limited, so
      // the generic walk has a cell to report stopping at in all four cases.
      expect(generic.stoppedAt, canary.waveId).not.toBeNull();
      expect(generic.stoppedAt!.wouldHaveTotalled, canary.waveId).toBeGreaterThan(budget);
    }
  });

  /** The refusal names the wave and the leading cell, which the copies do not. */
  it("names the wave and the leading cell's size when nothing fits", () => {
    expect(() => deriveExteriorWaveRenderableCells(cells, 24, "northern-manhattan"))
      .toThrow(/Wave northern-manhattan: no cell fits the 24-entry renderable budget; the first cell in priority order, a, owns 25 buildings\./u);
    expect(() => deriveExteriorWaveRenderableCells([], 24, "northern-manhattan"))
      .toThrow(/no cell was supplied at all/u);
  });
});
