import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLOCK835_MEMBERSHIP_BUILDING_IDS,
  CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION,
  EXTERIOR_DEFAULT_ACTIVATIONS,
  EXTERIOR_SERVING_ROLLBACKS,
  EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION,
  EXTERIOR_TWO_LOD_SERVING_ROLLBACKS,
  LOWER_MANHATTAN_TWO_LOD_ACTIVATION,
  MIDTOWN_CORE_TWO_LOD_ACTIVATION,
  NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION,
  SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION,
  exteriorAcceptedCellsDigest,
  exteriorAcceptedIdsDigest,
  exteriorDefaultActivations,
  exteriorRolledBackReleaseNotice,
  exteriorUnavailableDetail,
  exteriorUnavailableStatements,
  resolveExteriorActivation,
  resolveExteriorActivationSet,
  restoresPromotedDefault,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
  type ExteriorDefaultActivationRecord,
  type ExteriorStreamingOverride,
} from "./exterior-default-activation";

const FIXTURE_RELEASE_ID = "udt-fixture-exterior-cells";
const CITYWIDE_BASE = "manhattan-citywide-20260804";
const PROMOTED = EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION.enabled ? EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION : null;
/**
 * A wave withdrawn all the way to BASE.
 *
 * No promoted wave's own predecessor is this shape any more — since the T005
 * serving promotion every one of the six rolls back to a curated release, where
 * four of them used to roll back to base massing — but the base-only withdrawal
 * is still representable and is still what the per-wave rules below need: they
 * prove that ONE wave going dark leaves the others streaming, and base is the
 * strongest form of "gone" to prove that against.
 */
const ROLLED_BACK: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: PROMOTED ? PROMOTED.releaseId : null };

/**
 * What a per-wave rollback exports, taken from the SHIPPED constant.
 *
 * A rollback is one record swap, and the record it swaps in has two jobs:
 * restore the previous verified representation, and refuse promotion-era
 * `?exteriorCells=` links into the release it withdrew. Every curated wave ships
 * both halves as one constant — `BLOCK835_V2_EXTERIOR_ROLLBACK` is the V2 record
 * plus `rolledBackReleaseId: <V3>` — and the serving promotion now does too, in
 * `EXTERIOR_SERVING_ROLLBACKS`.
 *
 * This resolves to that shipped constant rather than constructing one, so every
 * rehearsal below exercises the text an operator would actually export. A
 * record with no shipped rollback target is a defect and throws here rather than
 * being quietly synthesized: a rehearsal that invented its own target would
 * prove the rehearsal correct and say nothing about the build.
 */
function withdrawingRollback(record: ExteriorDefaultActivationRecord): ExteriorDefaultActivationRecord {
  if (!record.enabled) return record;
  // A `-s2` wave's shipped withdrawal lives in the two-LOD list and restores the
  // `-s1` record; an `-s1` wave's lives one rung down and restores the curated
  // record. Searching both keeps the deeper-swap rehearsals on shipped text.
  const shipped = [...EXTERIOR_TWO_LOD_SERVING_ROLLBACKS, ...EXTERIOR_SERVING_ROLLBACKS].find((entry) => entry.rolledBackReleaseId === record.releaseId);
  if (!shipped) throw new Error(`no shipped rollback target withdraws ${record.releaseId}`);
  return shipped;
}

const BLOCK835_SERVING_RELEASE_ID = "manhattan-exterior-cells-20260811-v3-s1";
const BLOCK835_TWO_LOD_RELEASE_ID = "manhattan-exterior-cells-20260811-v3-s2";
const BLOCK835_V3_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
/** The Block 835 rollback this build ships: back to the curated V3 release. */
const ROLLED_BACK_TO_PREDECESSOR: ExteriorDefaultActivationRecord = withdrawingRollback(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION);
const MIDTOWN = MIDTOWN_CORE_TWO_LOD_ACTIVATION.enabled ? MIDTOWN_CORE_TWO_LOD_ACTIVATION : null;
/**
 * The Midtown rollback this build ships: back to the curated V3 release.
 *
 * Enabled, as it has been since the P3 V3 repromotion, but one release later:
 * the previous verified representation of the serving wave is the curated V3
 * wave, which nobody withdrew. Restoring it is a large FALL in what renders —
 * 7,179 served buildings back to the curated 156, with the rest of the area
 * returning to base massing — and it is still verified geometry rather than
 * nothing, which is why it is the rollback target.
 */
const MIDTOWN_ROLLED_BACK: ExteriorDefaultActivationRecord = withdrawingRollback(MIDTOWN_CORE_TWO_LOD_ACTIVATION);
const MIDTOWN_SERVING_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3-s1";
const MIDTOWN_TWO_LOD_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3-s2";
const MIDTOWN_V3_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
/** A Midtown withdrawal all the way to base, kept representable and tested. */
const ROLLED_BACK_MIDTOWN_TO_BASE: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: MIDTOWN ? MIDTOWN.releaseId : null };
const LOWER_MANHATTAN = LOWER_MANHATTAN_TWO_LOD_ACTIVATION.enabled ? LOWER_MANHATTAN_TWO_LOD_ACTIVATION : null;
const LOWER_MANHATTAN_SERVING_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-s1";
const LOWER_MANHATTAN_TWO_LOD_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-s2";
const LOWER_MANHATTAN_P1_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-p1";
const LOWER_MANHATTAN_CANARY_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812";
/**
 * The Lower-Manhattan rollback this build ships: back to the curated P1 release.
 *
 * Wave w02's promotion record used to have a base-only predecessor, because the
 * wave had never been promoted in any form before its P1 promotion. It has now,
 * so the rollback target is a release: 6,382 served buildings fall back to the
 * curated 71, and the rest of the wave's area returns to base massing. Rolling
 * all the way to base is a SECOND swap, rehearsed separately below.
 */
const LOWER_MANHATTAN_ROLLED_BACK: ExteriorDefaultActivationRecord = withdrawingRollback(LOWER_MANHATTAN_TWO_LOD_ACTIVATION);
/**
 * The second step: the curated P1 record's own base-only predecessor, which is
 * the record this build ships for that withdrawal and which names the P1 release
 * it refuses. One `rolledBackReleaseId` can name ONE release, so this step
 * refuses the curated link and the first step refuses the serving one; a
 * two-step rollback is two swaps and cannot be collapsed into one record.
 */
const LOWER_MANHATTAN_ROLLED_BACK_TO_BASE: ExteriorDefaultActivationRecord = LOWER_MANHATTAN && LOWER_MANHATTAN.predecessor.enabled && LOWER_MANHATTAN.predecessor.predecessor.enabled
  ? LOWER_MANHATTAN.predecessor.predecessor.predecessor
  : LOWER_MANHATTAN_TWO_LOD_ACTIVATION;
const SOUTHERN_REMAINDER_SERVING_RELEASE_ID = "manhattan-southern-remainder-cells-20260812-s1";
const SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID = "manhattan-southern-remainder-cells-20260812-s2";
const SOUTHERN_REMAINDER_P1_RELEASE_ID = "manhattan-southern-remainder-cells-20260812-p1";
const SOUTHERN_REMAINDER_CANARY_RELEASE_ID = "manhattan-southern-remainder-cells-20260812";
/**
 * The Southern-remainder rollback this build ships: back to the curated P1
 * release. Same shape and same reason as Lower-Manhattan's — 9,560 served
 * buildings back to the curated 179, with the rest returning to base massing.
 */
const SOUTHERN_REMAINDER_ROLLED_BACK: ExteriorDefaultActivationRecord = withdrawingRollback(SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION);
const CENTRAL_UPPER_MANHATTAN_SERVING_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-s1";
const CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-s2";
const CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-p1";
const CENTRAL_UPPER_MANHATTAN_CANARY_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812";
/**
 * The Central-and-upper-Manhattan rollback this build ships: back to the curated
 * P1 release. 11,682 served buildings back to the curated 40 — the steepest fall
 * of the six — with the rest of the area returning to base massing.
 */
const CENTRAL_UPPER_MANHATTAN_ROLLED_BACK: ExteriorDefaultActivationRecord = withdrawingRollback(CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION);
const NORTHERN_MANHATTAN_SERVING_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812-s1";
const NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812-s2";
const NORTHERN_MANHATTAN_P1_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812-p1";
const NORTHERN_MANHATTAN_CANARY_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812";
/**
 * The Northern-Manhattan rollback this build ships: back to the curated P1
 * release. 10,172 served buildings back to the curated 24, with the rest of the
 * area returning to base massing.
 *
 * It no longer un-completes the ledger's promoted coverage the way it did when
 * the predecessor was base-only — every wave still has an enabled record — and
 * the mechanics are unchanged either way: one record swap, silent about every
 * other wave.
 */
const NORTHERN_MANHATTAN_ROLLED_BACK: ExteriorDefaultActivationRecord = withdrawingRollback(NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION);
/**
 * The head and cells the promoted Block 835 serving release declares.
 *
 * That record states all three acceptance sets as digests, so it carries no list
 * to build a resolve from. These come from the release's own committed
 * `payload-inventory.json` — the record `exterior-serving-promotion-record.test.ts`
 * re-derives every serving pin from — because a set invented here would prove
 * the gate agrees with a fixture and nothing about the release. The payload
 * directory is gitignored; this file is committed, so it reads on a fresh clone.
 */
const SERVING_INVENTORY = JSON.parse(
  new TextDecoder().decode(readFileSync(`data/${BLOCK835_TWO_LOD_RELEASE_ID}/payload-inventory.json`)),
) as { assemblyPackageIds: string[]; cellReleases: ExteriorAcceptedCell[] };
const SERVING_PACKAGE_IDS: readonly string[] = SERVING_INVENTORY.assemblyPackageIds;
const SERVING_CELLS: readonly ExteriorAcceptedCell[] = SERVING_INVENTORY.cellReleases;

/** The six releases the shipped set streams, in wave order. */
const SHIPPED_TARGET_RELEASE_IDS = [
  BLOCK835_TWO_LOD_RELEASE_ID,
  MIDTOWN_TWO_LOD_RELEASE_ID,
  LOWER_MANHATTAN_TWO_LOD_RELEASE_ID,
  SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
  CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
  NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
];

/** A second, independent wave, used only to prove the per-wave rules. */
const SECOND_WAVE: ExteriorDefaultActivationRecord = {
  enabled: true,
  releaseId: "test-second-exterior-wave",
  snapshotId: "snapshot:test-second-exterior-wave:v1",
  snapshotChecksumSha256: "1".repeat(64),
  assemblyPackageIds: ["test-second-assembly"],
  membership: {
    cells: [{ cellId: "cell:test:second", cellReleaseId: "cell-release:test-second-exterior-wave:v1", checksumSha256: "2".repeat(64) }],
    cellsDigestSha256: null,
    cellCount: 1,
    buildingIds: ["doitt:111111"],
  },
  approvalRef: "test-only record",
  predecessor: { enabled: false, releaseId: null, rolledBackReleaseId: "test-second-exterior-wave" },
};

const OVERRIDES: readonly ExteriorStreamingOverride[] = [null, "on", "off", "off-unpinned"];
const EXPLICIT: readonly (string | null)[] = [null, FIXTURE_RELEASE_ID, PROMOTED?.releaseId ?? FIXTURE_RELEASE_ID, "unknown-release"];
const BASES: readonly (string | null)[] = [CITYWIDE_BASE, null];

/** Every URL/toggle state the app can actually reach, plus the unreachable ones. */
function matrix(): { override: ExteriorStreamingOverride; explicitReleaseId: string | null; activeRealBaseReleaseId: string | null }[] {
  return OVERRIDES.flatMap((override) => EXPLICIT.flatMap((explicitReleaseId) => BASES.map((activeRealBaseReleaseId) => ({ override, explicitReleaseId, activeRealBaseReleaseId }))));
}

describe("the promoted set", () => {
  it("orders all SIX declared waves, Block 835 first and Northern-Manhattan last, from the records the build exports", () => {
    expect(EXTERIOR_DEFAULT_ACTIVATIONS).toHaveLength(6);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[0]).toBe(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[1]).toBe(MIDTOWN_CORE_TWO_LOD_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[2]).toBe(LOWER_MANHATTAN_TWO_LOD_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[3]).toBe(SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[4]).toBe(CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION);
    // Composition, not a second copy: a build that swapped a record orders the
    // swapped record rather than a stale duplicate of the promoted one. Each
    // parameter is independent, which is what makes a per-wave rollback one edit.
    expect(exteriorDefaultActivations(ROLLED_BACK)).toEqual([ROLLED_BACK, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION, CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION, NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_ROLLED_BACK)).toEqual([EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_ROLLED_BACK, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION, CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION, NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_ROLLED_BACK))
      .toEqual([EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_ROLLED_BACK, SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION, CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION, NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_ROLLED_BACK))
      .toEqual([EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_ROLLED_BACK, CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION, NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION, CENTRAL_UPPER_MANHATTAN_ROLLED_BACK))
      .toEqual([EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION, CENTRAL_UPPER_MANHATTAN_ROLLED_BACK, NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION, CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION, NORTHERN_MANHATTAN_ROLLED_BACK))
      .toEqual([EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION, CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION, NORTHERN_MANHATTAN_ROLLED_BACK]);
  });

  /**
   * A withdrawal and a promotion of the same release cannot coexist in one set.
   *
   * `resolveExteriorActivationSet` states a PRECEDENCE for this — a record that
   * publishes X governs X ahead of a record that withdrew X — and that precedence
   * exists so the resolution stays deterministic if it ever happened. It is not a
   * licence for it to happen: a build where one wave withdrew a release another
   * wave is actively serving would refuse promotion-era links into bytes it is
   * simultaneously rendering, and no reader of the records could tell which
   * statement was the intended one. The precedence keeps the resolver total; this
   * invariant keeps the SET honest, and the two are different jobs.
   */
  it("never lets one record withdraw a release another enabled record publishes", () => {
    const published = new Map<string, number>();
    EXTERIOR_DEFAULT_ACTIVATIONS.forEach((record, index) => {
      if (record.enabled) published.set(record.releaseId, index);
    });
    const collisions: string[] = [];
    EXTERIOR_DEFAULT_ACTIVATIONS.forEach((record, index) => {
      const withdrawn = record.rolledBackReleaseId ?? null;
      if (withdrawn === null) return;
      const publisher = published.get(withdrawn);
      if (publisher !== undefined) collisions.push(`record ${index} withdrew ${withdrawn}, which record ${publisher} publishes`);
      // A record may never withdraw its OWN release either, which the
      // per-record suite pins; restated at set level so one loop covers both.
      if (record.enabled && withdrawn === record.releaseId) collisions.push(`record ${index} withdrew its own release ${withdrawn}`);
    });
    expect(collisions).toEqual([]);

    // The invariant is checkable rather than vacuous: a set that DOES collide is
    // detected by the same loop. The withdrawn id is read off the promoted
    // record, so the probe cannot go stale by naming a release this build no
    // longer publishes.
    const colliding = [
      EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION,
      { enabled: false as const, releaseId: null, rolledBackReleaseId: PROMOTED!.releaseId },
    ];
    const publishedIds = new Set(colliding.filter((record) => record.enabled).map((record) => record.releaseId));
    expect(colliding.some((record) => record.rolledBackReleaseId !== null && record.rolledBackReleaseId !== undefined && publishedIds.has(record.rolledBackReleaseId))).toBe(true);
  });

  it("promotes disjoint cell ids, so no wave can claim another wave's cell", () => {
    // Resolves the multi-wave collision risk directly: the scene diffs owned
    // collections by cell id, so two waves sharing one would merge into a
    // single collection and one wave's geometry would replace the other's.
    //
    // The walk covers each promoted record AND the curated record it rolls back
    // to, because a rollback puts that curated record into this same set and its
    // cells have to be disjoint from every other wave's too.
    const seen = new Map<string, string>();
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      // The chain is one link longer since the two-LOD promotion: a first
      // rollback restores the -s1 record and a second restores the curated one,
      // so BOTH live in this same set across rollbacks and stay disjoint.
      for (const entry of [record, record.predecessor, ...(record.predecessor.enabled ? [record.predecessor.predecessor] : [])]) {
        if (!entry.enabled) continue;
        for (const cell of entry.membership.cells) {
          expect(seen.has(cell.cellId), `${cell.cellId} is claimed twice`).toBe(false);
          seen.set(cell.cellId, entry.releaseId);
        }
      }
    }
    // Only the curated Block 835 record still states cells literally. All six
    // PROMOTED records state a digest, so this loop can no longer see a single
    // promoted cell — the disjointness of the 883 serving cells is asserted
    // against the committed inventories and the wave-partitioned ledger they
    // were digested from, in exterior-serving-promotion-record.test.ts, and the
    // curated waves' in their own per-wave record suites.
    expect([...seen.keys()]).toEqual(["cell:manhattan:block-835"]);
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      expect(record.membership.cells, record.releaseId).toEqual([]);
      expect(record.membership.cellsDigestSha256 ?? "", record.releaseId).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("states each wave's accepted cells in exactly one form", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      if (record.membership.cellsDigestSha256 === null) {
        expect(record.membership.cells.length, record.releaseId).toBe(record.membership.cellCount);
        expect(record.membership.cells.length).toBeGreaterThan(0);
      } else {
        // The unused form is empty, so nothing can be read as an accepted cell
        // list that the gate is not actually comparing against.
        expect(record.membership.cells, record.releaseId).toEqual([]);
        expect(record.membership.cellCount).toBeGreaterThan(0);
        expect(record.membership.cellsDigestSha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("keeps the partial-rollback impossibility PER RECORD", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) {
        // A disabled record carries no pin, no membership, and no release at all.
        expect(record.releaseId).toBeNull();
        continue;
      }
      // The whole PREVIOUS RECORD is the rollback target: there is no way to keep
      // the pin while dropping the default, or the membership while keeping both.
      // The predecessor may be base-only (a first promotion) or the previous
      // verified release (a repromotion); either way it is one indivisible record
      // carrying its own release, pin and membership.
      if (record.predecessor.enabled) {
        expect(record.predecessor.releaseId).not.toBe(record.releaseId);
        expect(record.predecessor.membership.cellCount).toBeGreaterThan(0);
        // Every enabled predecessor in this build is now an -s1 SERVING record,
        // and the rule that a rollback target NAMES the release it withdraws
        // holds via the SHIPPED -s1 rollback list (the -s1 records' own
        // predecessors are enabled curated records, so the withdrawal statement
        // lives in the shipped rollback constant rather than on the chain).
        const servingRollback = EXTERIOR_SERVING_ROLLBACKS.find((entry) => entry.rolledBackReleaseId === record.predecessor.releaseId);
        expect(servingRollback, record.predecessor.releaseId).toBeDefined();
        // One link further down, the curated rung keeps the original property:
        // its own predecessor names the curated release it withdraws.
        const curated = record.predecessor.predecessor;
        if (curated.enabled) {
          expect(curated.predecessor.rolledBackReleaseId, curated.releaseId).toBe(curated.releaseId);
        }
      } else {
        expect(record.predecessor).toEqual({ enabled: false, releaseId: null, rolledBackReleaseId: record.releaseId });
      }
      // Membership is stated, in whichever form the wave uses; a record that
      // stated neither would be a pin with no accepted contents behind it.
      expect(record.membership.cellCount).toBeGreaterThan(0);
      expect(record.membership.cells.length > 0 || record.membership.cellsDigestSha256 !== null).toBe(true);
      expect(record.membership.buildingCount ?? record.membership.buildingIds.length).toBeGreaterThan(0);
      expect(record.membership.buildingIds.length > 0 || typeof record.membership.buildingIdsDigestSha256 === "string").toBe(true);
    }
  });

  /**
   * The two halves of a serving rollback, and why they are two SEPARATE
   * constants rather than one.
   *
   * A promotion record's `predecessor` is the previous verified representation,
   * stated verbatim. A verbatim curated record states no withdrawal, so the
   * predecessor alone restores geometry and refuses nothing — the withdrawn
   * `-s1` bytes stay on disk, stay in the pinned allowlist, and a promotion-era
   * `?exteriorCells=<-s1>` bookmark keeps streaming them UNGATED, because
   * `promotedDefault` is false and neither the pin nor the identity gate runs.
   *
   * That is exactly why the six `EXTERIOR_SERVING_ROLLBACKS` are shipped: the
   * rollback target is the predecessor PLUS the withdrawal statement, and this
   * asserts both facts side by side — the bare predecessor's silence, and the
   * shipped target's refusal.
   */
  it("ships a rollback target that restores the predecessor AND refuses the withdrawn release", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      // Half one, on its own: a verbatim predecessor withdraws nothing.
      expect(record.predecessor.rolledBackReleaseId ?? null, record.releaseId).toBeNull();
      expect(exteriorRolledBackReleaseNotice(record.releaseId, record.predecessor)).toBeNull();
      expect(resolveExteriorActivation({
        override: "on",
        explicitReleaseId: record.releaseId,
        activeRealBaseReleaseId: CITYWIDE_BASE,
        fallbackReleaseId: FIXTURE_RELEASE_ID,
        record: record.predecessor,
      })).toMatchObject({ streaming: true, releaseId: record.releaseId, promotedDefault: false });

      // The shipped target: the same record, one statement richer.
      const rollback = withdrawingRollback(record);
      expect({ ...rollback, rolledBackReleaseId: null }).toEqual({ ...record.predecessor, rolledBackReleaseId: null });
      expect(rollback.enabled && rollback.rolledBackReleaseId, record.releaseId).toBe(record.releaseId);
      expect(exteriorRolledBackReleaseNotice(record.releaseId, rollback))
        .toContain(`${record.releaseId} was rolled back in this build`);
    }
  });

  /**
   * THE REHEARSAL THE ROLLBACK EXISTS FOR: a bookmark handed out while the
   * serving release was the default, opened after the rollback.
   *
   * Asserted as the resolver's own verdict rather than as a field: the link
   * names the withdrawn `-s1` release explicitly, the swapped-in record is the
   * shipped rollback target, and what comes back must be "no exterior stream at
   * all" — not the withdrawn wave, and not the restored one silently substituted
   * under the withdrawn release's name.
   */
  it("refuses a withdrawn -s2 bookmark on every wave, while the restored -s1 link still opens", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      const rollback = withdrawingRollback(record);
      if (!rollback.enabled) throw new Error(`rollback target for ${record.releaseId} is not an enabled record`);

      const withdrawnBookmark = resolveExteriorActivation({
        override: "on",
        explicitReleaseId: record.releaseId,
        activeRealBaseReleaseId: CITYWIDE_BASE,
        fallbackReleaseId: FIXTURE_RELEASE_ID,
        record: rollback,
      });
      expect(withdrawnBookmark.streaming, record.releaseId).toBe(false);
      expect(withdrawnBookmark.reason, record.releaseId).toBe("rolled-back-release");
      expect(withdrawnBookmark.promotedDefault, record.releaseId).toBe(false);
      // `releaseId` survives the refusal on purpose — it is the URL-serialization
      // primary, so a link write and a re-enable have something to name. What it
      // is NOT is a streaming release, and `streaming: false` above is the only
      // field that says whether anything loads.
      expect(withdrawnBookmark.releaseId, record.releaseId).toBe(record.releaseId);

      // And the fall is bounded: the release the rollback RESTORED is still
      // reachable by its own link, so the rehearsal proves a refusal rather than
      // a build that refuses everything.
      const restored = resolveExteriorActivation({
        override: "on",
        explicitReleaseId: rollback.releaseId,
        activeRealBaseReleaseId: CITYWIDE_BASE,
        fallbackReleaseId: FIXTURE_RELEASE_ID,
        record: rollback,
      });
      expect(restored, rollback.releaseId).toMatchObject({ streaming: true, releaseId: rollback.releaseId });

      // The default with no parameters at all is the restored curated release,
      // which is what "rollback" has to mean for a user who bookmarked nothing.
      const bare = resolveExteriorActivation({
        override: null,
        explicitReleaseId: null,
        activeRealBaseReleaseId: CITYWIDE_BASE,
        fallbackReleaseId: FIXTURE_RELEASE_ID,
        record: rollback,
      });
      expect(bare, rollback.releaseId).toMatchObject({ streaming: true, releaseId: rollback.releaseId, promotedDefault: true });
    }
  });

  /**
   * One `rolledBackReleaseId` names ONE release, so reaching past the curated
   * release is a SECOND swap. Stated here as a property of all six rather than
   * left to the Lower-Manhattan two-step rehearsal alone.
   */
  it("cannot withdraw two releases in one record, which is why a deeper rollback is two swaps", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      const rollback = withdrawingRollback(record);
      if (!rollback.enabled) continue;
      // The serving link is refused by THIS swap; the curated link it restored
      // is not, and cannot be, by the same record.
      expect(rollback.rolledBackReleaseId).toBe(record.releaseId);
      expect(rollback.rolledBackReleaseId).not.toBe(rollback.releaseId);
      expect(exteriorRolledBackReleaseNotice(rollback.releaseId, rollback)).toBeNull();
      // The second swap already exists as shipped text: the -s1 rollback, which
      // names the restored -s1 release as withdrawn and restores curated.
      const second = withdrawingRollback(rollback);
      expect(second.enabled && second.rolledBackReleaseId, rollback.releaseId).toBe(rollback.releaseId);
    }
  });
});

/**
 * The generalization itself stays provably neutral: over a ONE-record set the
 * set resolver must still be the single-record resolver, exactly. This is what
 * made the multi-wave change safe to land ahead of the Midtown record, and it
 * keeps holding now that a second record exists.
 */
describe("behaviour neutrality of the set resolution over one record", () => {
  const ONE_RECORD = [EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION];
  it("resolves byte-equal to the single-record resolver across the whole URL matrix", () => {
    for (const input of matrix()) {
      const single = resolveExteriorActivation({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, record: EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION });
      const set = resolveExteriorActivationSet({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, records: ONE_RECORD });
      expect(set.releases, JSON.stringify(input)).toEqual([{ ...single, record: EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION }]);
      // What the app reads: the streaming verdict and the release the URL writes.
      expect(set.streaming, JSON.stringify(input)).toBe(single.streaming);
      expect(set.primaryReleaseId, JSON.stringify(input)).toBe(single.releaseId);
      expect(set.targets.map((target) => target.releaseId)).toEqual(single.streaming ? [single.releaseId] : []);
    }
  });

  it("produces the same unavailable statement the single-record rule produced", () => {
    for (const input of matrix()) {
      const single = resolveExteriorActivation({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, record: EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION });
      const statement = exteriorUnavailableDetail({
        streaming: single.streaming,
        override: input.override,
        activeRealBaseReleaseId: input.activeRealBaseReleaseId,
        explicitReleaseId: input.explicitReleaseId,
        record: EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION,
      });
      const statements = exteriorUnavailableStatements({
        set: resolveExteriorActivationSet({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, records: ONE_RECORD }),
        override: input.override,
        activeRealBaseReleaseId: input.activeRealBaseReleaseId,
        explicitReleaseId: input.explicitReleaseId,
      });
      expect(statements, JSON.stringify(input)).toEqual(statement === null ? [] : [statement]);
    }
  });

  it("keeps the refusal, restore, and verification rules identical for one record", async () => {
    for (const explicitReleaseId of EXPLICIT) {
      expect(exteriorRolledBackReleaseNotice(explicitReleaseId, ONE_RECORD))
        .toBe(exteriorRolledBackReleaseNotice(explicitReleaseId, EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION));
      expect(exteriorRolledBackReleaseNotice(explicitReleaseId, [ROLLED_BACK]))
        .toBe(exteriorRolledBackReleaseNotice(explicitReleaseId, ROLLED_BACK));
    }
    for (const targetReleaseId of [PROMOTED!.releaseId, FIXTURE_RELEASE_ID]) {
      for (const activeRealBaseReleaseId of BASES) {
        expect(restoresPromotedDefault({ targetReleaseId, activeRealBaseReleaseId, record: ONE_RECORD }))
          .toBe(restoresPromotedDefault({ targetReleaseId, activeRealBaseReleaseId, record: EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION }));
      }
    }
    // The gates still accept exactly the committed record and nothing else. The
    // promoted record states all three acceptance sets as digests, so the
    // resolve is built from the release's own committed inventory and digested
    // here — the way the runtime does it — rather than read off the record.
    expect(verifyPromotedExteriorPin({
      releaseId: PROMOTED!.releaseId,
      snapshotId: PROMOTED!.snapshotId,
      snapshotChecksumSha256: PROMOTED!.snapshotChecksumSha256,
      assemblyPackageIds: [...SERVING_PACKAGE_IDS],
      assemblyPackageIdsDigestSha256: await exteriorAcceptedIdsDigest(SERVING_PACKAGE_IDS),
      cells: SERVING_CELLS.map((cell) => ({ ...cell })),
      cellsDigestSha256: await exteriorAcceptedCellsDigest(SERVING_CELLS),
      buildingIds: [...BLOCK835_MEMBERSHIP_BUILDING_IDS],
      buildingIdsDigestSha256: await exteriorAcceptedIdsDigest(BLOCK835_MEMBERSHIP_BUILDING_IDS),
    }, EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION)).toEqual({ ok: true });
    // The identity gate is handed the membership the pin gate just verified,
    // because a digest-form record has no list for it to read.
    expect(verifyPromotedExteriorMembership(BLOCK835_MEMBERSHIP_BUILDING_IDS, EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, BLOCK835_MEMBERSHIP_BUILDING_IDS)).toEqual({ ok: true });
    // The membership failure now names the release instead of hard-coding a
    // block, so a second wave's failure cannot read as the first wave's.
    const failure = verifyPromotedExteriorMembership(["doitt:999999"], EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, BLOCK835_MEMBERSHIP_BUILDING_IDS);
    expect(failure.ok).toBe(false);
    expect(failure.ok === false && failure.message).toContain(PROMOTED!.releaseId);
  });
});

describe("per-wave rules once more than one wave is promoted", () => {
  const both = [EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, SECOND_WAVE] as const;
  const base = { fallbackReleaseId: FIXTURE_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE } as const;

  it("streams every promoted wave by default over a real base", () => {
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, records: [...both] });
    expect(set.targets.map((target) => target.releaseId)).toEqual([PROMOTED!.releaseId, SECOND_WAVE.releaseId]);
    expect(set.targets.every((target) => target.promotedDefault)).toBe(true);
  });

  it("disables ALL default waves on the explicit off sentinel", () => {
    for (const override of ["off", "off-unpinned"] as const) {
      const set = resolveExteriorActivationSet({ ...base, override, explicitReleaseId: null, records: [...both] });
      expect(set.streaming).toBe(false);
      expect(set.targets).toEqual([]);
    }
  });

  it("treats exteriorCells=X as exactly release X and nothing else", () => {
    const set = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: SECOND_WAVE.releaseId, records: [...both] });
    expect(set.targets.map((target) => target.releaseId)).toEqual([SECOND_WAVE.releaseId]);
    // Explicit intent REPLACES the default set: the other promoted wave is not
    // added behind the link's back.
    expect(set.releases.map((entry) => entry.releaseId)).toEqual([SECOND_WAVE.releaseId]);
    // ...and naming the promoted wave still carries that wave's gates.
    expect(set.targets[0]!.promotedDefault).toBe(true);
    expect(set.targets[0]!.record).toBe(SECOND_WAVE);
  });

  it("refuses one rolled-back wave's opt-in while the other waves keep streaming", () => {
    const partiallyRolledBack = [ROLLED_BACK, SECOND_WAVE];
    // The withdrawn wave's own bookmark fails closed...
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: PROMOTED!.releaseId, records: partiallyRolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, partiallyRolledBack)).toContain(`${PROMOTED!.releaseId} was rolled back in this build`);
    // ...while the surviving wave still streams by default, and its own opt-in
    // link is untouched by the other wave's withdrawal.
    const surviving = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, records: partiallyRolledBack });
    expect(surviving.targets.map((target) => target.releaseId)).toEqual([SECOND_WAVE.releaseId]);
    expect(exteriorRolledBackReleaseNotice(SECOND_WAVE.releaseId, partiallyRolledBack)).toBeNull();
    expect(restoresPromotedDefault({ targetReleaseId: SECOND_WAVE.releaseId, activeRealBaseReleaseId: CITYWIDE_BASE, record: partiallyRolledBack })).toBe(true);
    expect(restoresPromotedDefault({ targetReleaseId: PROMOTED!.releaseId, activeRealBaseReleaseId: CITYWIDE_BASE, record: partiallyRolledBack })).toBe(false);
  });

  it("names WHICH wave is unavailable, and says the session-wide reasons once", () => {
    const partiallyRolledBack = [ROLLED_BACK, SECOND_WAVE];
    const statements = exteriorUnavailableStatements({
      set: resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, records: partiallyRolledBack }),
      override: null,
      activeRealBaseReleaseId: CITYWIDE_BASE,
      explicitReleaseId: null,
    });
    // The withdrawn wave is named; the streaming wave says nothing.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(PROMOTED!.releaseId);
    expect(statements[0]).toContain("not active in this build");

    // "You switched exteriors off" is true of every wave at once, so it is said
    // once rather than repeated per promotion record.
    const off = exteriorUnavailableStatements({
      set: resolveExteriorActivationSet({ ...base, override: "off", explicitReleaseId: null, records: [...both] }),
      override: "off",
      activeRealBaseReleaseId: CITYWIDE_BASE,
      explicitReleaseId: null,
    });
    expect(off).toHaveLength(1);
    expect(off[0]).toContain("switched off for this session");
  });

  it("loads one runtime, not one per record, when no wave can promote", () => {
    // Fixture mode with an explicit enable: every record resolves the same
    // fallback release, and the target list must not ask for it twice.
    const set = resolveExteriorActivationSet({ fallbackReleaseId: FIXTURE_RELEASE_ID, activeRealBaseReleaseId: null, override: "on", explicitReleaseId: null, records: [...both] });
    expect(set.targets.map((target) => target.releaseId)).toEqual([FIXTURE_RELEASE_ID]);
  });
});

describe("the promoted set as this build actually ships it", () => {
  const base = { fallbackReleaseId: FIXTURE_RELEASE_ID } as const;

  it("stays completely quiet in a fixture-mode session, with six records promoted", () => {
    // No base identity to anchor exterior cells to, so neither wave attempts a
    // load and neither complains about not loading. Promoting a second wave
    // must not turn a fixture session into a failing one.
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: null });
    expect(set.streaming).toBe(false);
    expect(set.targets).toEqual([]);
    expect(set.releases.map((entry) => entry.reason)).toEqual(["no-real-base", "no-real-base", "no-real-base", "no-real-base", "no-real-base", "no-real-base"]);
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: null, explicitReleaseId: null })).toEqual([]);
  });

  it("streams all six promoted waves over a real base, each gated by its own record", () => {
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(set.targets.map((target) => target.releaseId)).toEqual(SHIPPED_TARGET_RELEASE_IDS);
    expect(set.targets.every((target) => target.promotedDefault)).toBe(true);
    expect(set.targets[0]!.record).toBe(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION);
    expect(set.targets[1]!.record).toBe(MIDTOWN_CORE_TWO_LOD_ACTIVATION);
    expect(set.targets[2]!.record).toBe(LOWER_MANHATTAN_TWO_LOD_ACTIVATION);
    expect(set.targets[3]!.record).toBe(SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION);
    expect(set.targets[4]!.record).toBe(CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION);
    expect(set.targets[5]!.record).toBe(NORTHERN_MANHATTAN_TWO_LOD_ACTIVATION);
    // The URL still serialises nothing: a default-on session's links stay
    // reproducible against whatever the build promotes.
    expect(set.primaryReleaseId).toBe(BLOCK835_TWO_LOD_RELEASE_ID);
  });

  it("narrows to exactly the named release, and off kills every wave", () => {
    for (const releaseId of SHIPPED_TARGET_RELEASE_IDS) {
      const set = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: releaseId, activeRealBaseReleaseId: CITYWIDE_BASE });
      expect(set.targets.map((target) => target.releaseId)).toEqual([releaseId]);
      expect(set.targets[0]!.promotedDefault).toBe(true);
    }
    const off = resolveExteriorActivationSet({ ...base, override: "off", explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(off.streaming).toBe(false);
    expect(off.releases.map((entry) => entry.streaming)).toEqual([false, false, false, false, false, false]);
  });

  it("re-enabling from off returns to the FULL default set, pinning nothing", () => {
    // The toggle asks whether the release it would re-pin is a promoted one; if
    // it is, it clears the override entirely rather than pinning that release,
    // which under the exteriorCells rule would have narrowed a six-wave
    // session down to one wave every time a user pressed Disable and then Enable.
    const off = resolveExteriorActivationSet({ ...base, override: "off", explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(restoresPromotedDefault({ targetReleaseId: off.primaryReleaseId, activeRealBaseReleaseId: CITYWIDE_BASE })).toBe(true);
    const restored = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(restored.targets).toHaveLength(6);
    // A genuinely explicit fixture session is NOT a promoted default, so it
    // keeps pinning its own release exactly as before.
    expect(restoresPromotedDefault({ targetReleaseId: FIXTURE_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE })).toBe(false);
  });

  it("rehearses the Block 835 serving rollback and roll-forward with the other five untouched", () => {
    const rolledBack = exteriorDefaultActivations(ROLLED_BACK_TO_PREDECESSOR);
    const back = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // The curated V3 release renders again as the default — the same fourteen
    // buildings, so this is the one wave whose rollback costs no coverage — and
    // the other five are bit-for-bit the waves they were before the swap: a
    // repromotion of one wave says nothing about another.
    expect(back.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_SERVING_RELEASE_ID,
      MIDTOWN_TWO_LOD_RELEASE_ID,
      LOWER_MANHATTAN_TWO_LOD_RELEASE_ID,
      SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
      NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
    ]);
    expect(back.targets[1]!.record).toBe(MIDTOWN_CORE_TWO_LOD_ACTIVATION);
    expect(back.targets[2]!.record).toBe(LOWER_MANHATTAN_TWO_LOD_ACTIVATION);
    expect(back.targets[3]!.record).toBe(SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION);
    // The withdrawn two-LOD link fails closed, by name, and only for Block 835.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: BLOCK835_TWO_LOD_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    // The restored -s1 release's own link is not refused by the swap, and
    // neither is the curated link one rung further down.
    expect(exteriorRolledBackReleaseNotice(BLOCK835_SERVING_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(BLOCK835_V3_RELEASE_ID, rolledBack)).toBeNull();
    // Forward again restores exactly the shipped set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual(SHIPPED_TARGET_RELEASE_IDS);
  });

  it("rolls the Midtown two-LOD wave back to its -s1 serving predecessor without withdrawing Block 835", () => {
    const midtownRolledBack = exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_ROLLED_BACK);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: midtownRolledBack });
    // The rollback restores the previous VERIFIED release rather than going
    // dark. It is still a large FALL in what renders — the curated V3 wave
    // generates geometry for 156 of the wave's buildings where the serving
    // release generated it for 7,179, and the rest of the area draws as base
    // massing — but it is verified geometry, and Block 835 is untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_TWO_LOD_RELEASE_ID,
      MIDTOWN_SERVING_RELEASE_ID,
      LOWER_MANHATTAN_TWO_LOD_RELEASE_ID,
      SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
      NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    // The withdrawn successor's own bookmark is refused, by the swapped-in
    // record, naming it — so the one-record swap is the whole rollback.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: MIDTOWN_TWO_LOD_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: midtownRolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_TWO_LOD_RELEASE_ID, midtownRolledBack))
      .toContain(`${MIDTOWN_TWO_LOD_RELEASE_ID} was rolled back in this build`);
    // Block 835's link is untouched by the Midtown withdrawal, and so are the
    // restored -s1 link and the curated V3 link one rung further down.
    expect(exteriorRolledBackReleaseNotice(BLOCK835_TWO_LOD_RELEASE_ID, midtownRolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_SERVING_RELEASE_ID, midtownRolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_V3_RELEASE_ID, midtownRolledBack)).toBeNull();
    // Nothing is unavailable: every wave streams, one of them one release back.
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null })).toEqual([]);
    // Forward again restores exactly the shipped set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual(SHIPPED_TARGET_RELEASE_IDS);
  });

  it("rolls the Lower-Manhattan wave back to its -s1 serving predecessor without withdrawing the other five", () => {
    // The rollback rehearsal ADR 0034 promotion owes, run through the record's
    // own injection seam rather than by editing the module.
    const rolledBack = exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_ROLLED_BACK);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w02 no longer goes dark: since the serving promotion it HAS an older
    // release to fall back to, so the curated P1 wave streams in its place —
    // generated geometry for 71 of its buildings where the serving release had
    // 6,382, with the rest of the area drawing as base massing. The other five
    // waves keep streaming untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_TWO_LOD_RELEASE_ID,
      MIDTOWN_TWO_LOD_RELEASE_ID,
      LOWER_MANHATTAN_SERVING_RELEASE_ID,
      SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
      NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[2]!.streaming).toBe(true);
    expect(set.releases[2]!.reason).toBe("promoted-default");

    // The withdrawn opt-in link is refused BY NAME, in the same one-record swap.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: LOWER_MANHATTAN_TWO_LOD_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack))
      .toContain(`${LOWER_MANHATTAN_TWO_LOD_RELEASE_ID} was rolled back in this build`);

    // The T015 CANARY is untouched by this rollback. It was never promoted, so
    // its opt-in link is not a promotion-era bookmark and stays honoured, and so
    // are the restored -s1 link and the curated P1 link below it.
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_CANARY_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_SERVING_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_P1_RELEASE_ID, rolledBack)).toBeNull();
    // ...and so are the other waves' links.
    expect(exteriorRolledBackReleaseNotice(BLOCK835_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();

    // Nothing is reported unavailable, because nothing is: every wave streams,
    // one of them one release back. The wave that CAN go dark is the second
    // swap, rehearsed below.
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null })).toEqual([]);

    // Forward again restores exactly the shipped six-wave set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual(SHIPPED_TARGET_RELEASE_IDS);
  });

  /**
   * The base-massing rollback, which is now the THIRD swap rather than the
   * first: the two-LOD promotion added a rung, so base massing is reached via
   * `-s2` -> `-s1` -> curated P1 -> base, one record swap per step.
   *
   * The case that proves a wave going fully dark leaves the others streaming
   * reaches base the way a build actually would: export the curated record's
   * own base-only predecessor, which is the record this build already ships for
   * that withdrawal.
   *
   * It refuses the CURATED link, not the serving ones, because
   * `rolledBackReleaseId` names exactly one release. Withdrawing all three is
   * three statements and therefore three swaps; that limit is a property of the
   * record shape and is stated here rather than papered over.
   */
  it("rolls the Lower-Manhattan wave back three times, all the way to BASE MASSING, with the other five still streaming", () => {
    const rolledBack = exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_ROLLED_BACK_TO_BASE);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w02's area returns to base massing, and the other five waves keep
    // streaming untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_TWO_LOD_RELEASE_ID,
      MIDTOWN_TWO_LOD_RELEASE_ID,
      SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
      NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[2]!.streaming).toBe(false);
    expect(set.releases[2]!.reason).toBe("not-promoted");

    // The link this swap withdraws is the curated one it just stopped serving.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: LOWER_MANHATTAN_P1_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_P1_RELEASE_ID, rolledBack))
      .toContain(`${LOWER_MANHATTAN_P1_RELEASE_ID} was rolled back in this build`);
    // And the serving links are NOT refused by this record: withdrawing them is
    // the first and second swaps' statements, which this record does not carry.
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_SERVING_RELEASE_ID, rolledBack)).toBeNull();
    // The T015 canary was never promoted, so its link stays honoured.
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_CANARY_RELEASE_ID, rolledBack)).toBeNull();

    // Exactly ONE statement, naming exactly this wave: the reader can tell which
    // area went back to base without guessing.
    const statements = exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(LOWER_MANHATTAN_P1_RELEASE_ID);
    expect(statements[0]).toContain("not active in this build");
    expect(statements[0]).toContain(`base massing from release ${CITYWIDE_BASE} is shown`);
  });

  it("rolls the Southern-remainder wave back to its -s1 serving predecessor without withdrawing the other five", () => {
    // The rollback rehearsal ADR 0035's promotion owes, run through the record's
    // own injection seam rather than by editing the module.
    const rolledBack = exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, MIDTOWN_CORE_TWO_LOD_ACTIVATION, LOWER_MANHATTAN_TWO_LOD_ACTIVATION, SOUTHERN_REMAINDER_ROLLED_BACK);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w03 falls back to the curated P1 wave — generated geometry for 179 of
    // its buildings where the serving release had 9,560, with the rest of the
    // area drawing as base massing — while the other five keep streaming
    // untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_TWO_LOD_RELEASE_ID,
      MIDTOWN_TWO_LOD_RELEASE_ID,
      LOWER_MANHATTAN_TWO_LOD_RELEASE_ID,
      SOUTHERN_REMAINDER_SERVING_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
      NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[3]!.streaming).toBe(true);
    expect(set.releases[3]!.reason).toBe("promoted-default");

    // The withdrawn opt-in link is refused BY NAME, in the same one-record swap.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID, rolledBack))
      .toContain(`${SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID} was rolled back in this build`);

    // The T017 CANARY is untouched by this rollback. It was never promoted, so
    // its opt-in link is not a promotion-era bookmark and stays honoured, and so
    // is the restored P1 link.
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_CANARY_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_SERVING_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_P1_RELEASE_ID, rolledBack)).toBeNull();
    // ...and so are the other waves' links.
    expect(exteriorRolledBackReleaseNotice(BLOCK835_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();

    // Nothing is reported unavailable, because every wave still streams.
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null })).toEqual([]);

    // Forward again restores exactly the shipped six-wave set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual(SHIPPED_TARGET_RELEASE_IDS);
  });

  it("rolls the Central-and-upper-Manhattan wave back to its -s1 serving predecessor without withdrawing the other five", () => {
    // The rollback rehearsal ADR 0036 precondition (e) owes, run through the
    // record's own injection seam rather than by editing the module. No URL
    // expresses a build-time record swap, so this — and not a browser journey —
    // is where the rehearsal can actually be performed.
    const rolledBack = exteriorDefaultActivations(
      EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION,
      MIDTOWN_CORE_TWO_LOD_ACTIVATION,
      LOWER_MANHATTAN_TWO_LOD_ACTIVATION,
      SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION,
      CENTRAL_UPPER_MANHATTAN_ROLLED_BACK,
    );
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w04 falls back to the curated P1 wave. It is the steepest fall of the
    // six — generated geometry for 40 of its buildings where the serving release
    // had 11,682, with the rest of the area drawing as base massing — and the
    // other five waves keep streaming untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_TWO_LOD_RELEASE_ID,
      MIDTOWN_TWO_LOD_RELEASE_ID,
      LOWER_MANHATTAN_TWO_LOD_RELEASE_ID,
      SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_SERVING_RELEASE_ID,
      NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[4]!.streaming).toBe(true);
    expect(set.releases[4]!.reason).toBe("promoted-default");

    // The withdrawn opt-in link is refused BY NAME, in the same one-record swap.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack))
      .toContain(`${CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID} was rolled back in this build`);

    // The T019 CANARY is untouched by this rollback. It was never promoted, so
    // its opt-in link is not a promotion-era bookmark and stays honoured, and so
    // is the restored P1 link.
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_CANARY_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_SERVING_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID, rolledBack)).toBeNull();
    // ...and so are the other waves' links.
    expect(exteriorRolledBackReleaseNotice(BLOCK835_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();

    // Nothing is reported unavailable, because every wave still streams.
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null })).toEqual([]);

    // Forward again restores exactly the shipped six-wave set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual(SHIPPED_TARGET_RELEASE_IDS);
  });

  it("rolls the Northern-Manhattan wave back to its -s1 serving predecessor without withdrawing the other five", () => {
    // The rollback rehearsal ADR 0037's promotion owes, run through the record's
    // own injection seam rather than by editing the module. No URL expresses a
    // build-time record swap, so this — and not a browser journey — is where the
    // rehearsal can actually be performed.
    //
    // It used to be the one rollback that UN-COMPLETED the ledger's promoted
    // coverage, because the wave went dark. It no longer does: the curated P1
    // wave takes over, so all six waves stay promoted and the coverage claim
    // survives the swap. The mechanics are unchanged either way — one record,
    // silent about the other five.
    const rolledBack = exteriorDefaultActivations(
      EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION,
      MIDTOWN_CORE_TWO_LOD_ACTIVATION,
      LOWER_MANHATTAN_TWO_LOD_ACTIVATION,
      SOUTHERN_REMAINDER_TWO_LOD_ACTIVATION,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_ACTIVATION,
      NORTHERN_MANHATTAN_ROLLED_BACK,
    );
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w05 falls back to the curated P1 wave — generated geometry for 24 of
    // its buildings where the serving release had 10,172, with the rest of the
    // area drawing as base massing — while the other five stream untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_TWO_LOD_RELEASE_ID,
      MIDTOWN_TWO_LOD_RELEASE_ID,
      LOWER_MANHATTAN_TWO_LOD_RELEASE_ID,
      SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
      NORTHERN_MANHATTAN_SERVING_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[5]!.streaming).toBe(true);
    expect(set.releases[5]!.reason).toBe("promoted-default");
    // Six of six waves still promoted, which is what "coverage survives the
    // swap" means in practice and is asserted rather than described.
    expect(rolledBack.filter((record) => record.enabled)).toHaveLength(6);

    // The withdrawn opt-in link is refused BY NAME, in the same one-record swap.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack))
      .toContain(`${NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID} was rolled back in this build`);

    // The T021 CANARY is untouched by this rollback. It was never promoted, so
    // its opt-in link is not a promotion-era bookmark and stays honoured, and so
    // is the restored P1 link.
    expect(exteriorRolledBackReleaseNotice(NORTHERN_MANHATTAN_CANARY_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(NORTHERN_MANHATTAN_SERVING_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(NORTHERN_MANHATTAN_P1_RELEASE_ID, rolledBack)).toBeNull();
    // ...and so are the other five waves' links.
    expect(exteriorRolledBackReleaseNotice(BLOCK835_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID, rolledBack)).toBeNull();

    // Nothing is reported unavailable, because every wave still streams.
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null })).toEqual([]);

    // Forward again restores exactly the shipped six-wave set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual(SHIPPED_TARGET_RELEASE_IDS);
  });

  it("still names WHICH wave is unavailable when one goes dark all the way to base", () => {
    // The base-only withdrawal is no longer what any shipped wave rolls back to
    // in one step, but it stays representable and it is the case the per-wave
    // notice text exists for, so it keeps its own test rather than disappearing
    // with the shape change.
    const midtownDark = exteriorDefaultActivations(EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION, ROLLED_BACK_MIDTOWN_TO_BASE);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: midtownDark });
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      BLOCK835_TWO_LOD_RELEASE_ID,
      LOWER_MANHATTAN_TWO_LOD_RELEASE_ID,
      SOUTHERN_REMAINDER_TWO_LOD_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_TWO_LOD_RELEASE_ID,
      NORTHERN_MANHATTAN_TWO_LOD_RELEASE_ID,
    ]);
    const statements = exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(MIDTOWN_TWO_LOD_RELEASE_ID);
    expect(statements[0]).toContain("not active in this build");
  });
});
