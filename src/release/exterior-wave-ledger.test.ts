import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";
import { parseTileKey, tileBounds } from "../runtime/spatial";
import { sha256HexSync, stableSerialize } from "./catalog-release";
import type { ExteriorOwnershipLedger } from "./exterior-release";
import {
  BLOCK_835_CELL_BOUNDS,
  BLOCK_835_TILE_KEY,
  EXTERIOR_CELL_MAX_BUILDINGS,
  EXTERIOR_WAVE_BASE_BUILDING_COUNT,
  EXTERIOR_WAVE_BASE_RELEASE_ID,
  EXTERIOR_WAVE_PLAN,
  EXTERIOR_WAVE_TILE_LEVEL,
  EXTERIOR_WAVE_TILE_ROW_ENVELOPE,
  block835BuildingIds,
  buildExteriorWaveLedger,
  cellTileKey,
  cellWaveIndex,
  deriveExteriorBaseIdentitySetId,
  deriveExteriorWaveLedgerId,
  exteriorArtifactChecksum,
  exteriorWaveLedgerDigest,
  membershipChecksum,
  validateExteriorLedgerEligibility,
  validateExteriorWaveLedger,
  validateExteriorWaveLedgerDigest,
  type ExteriorBaseShardGroup,
  type ExteriorWaveLedgerDigest,
  type ExteriorLedgerEligibility,
} from "./exterior-wave-ledger";

const BASE_CHECKSUM = "b".repeat(64);

/** Deterministic representative coordinates spread across a level-14 tile. */
function syntheticGroup(tileKey: string, count: number, idPrefix: string, extraIds: readonly string[] = []): ExteriorBaseShardGroup {
  const bounds = tileBounds(parseTileKey(tileKey));
  const span = Math.ceil(Math.sqrt(count + extraIds.length)) || 1;
  const ids = [...extraIds, ...Array.from({ length: count }, (_, index) => `${idPrefix}${index}`)];
  return {
    tileKey,
    buildings: ids.map((buildingId, index) => ({
      buildingId,
      longitude: bounds.west + ((bounds.east - bounds.west) * (index % span + 0.5)) / span,
      latitude: bounds.south + ((bounds.north - bounds.south) * (Math.floor(index / span) + 0.5)) / span,
    })),
  };
}

function syntheticInput(overrides: Partial<Parameters<typeof buildExteriorWaveLedger>[0]> = {}) {
  return {
    baseReleaseId: EXTERIOR_WAVE_BASE_RELEASE_ID,
    baseManifestChecksumSha256: BASE_CHECKSUM,
    shardGroups: [
      // midtown-core (wave 1), also the Block 835 host tile, deliberately over cap.
      syntheticGroup(BLOCK_835_TILE_KEY, 400, "doitt:mid-", block835BuildingIds()),
      // lower-manhattan (wave 2)
      syntheticGroup("wgs84-geodetic/14/4823/4486", 30, "doitt:low-"),
      // southern-remainder (wave 3)
      syntheticGroup("wgs84-geodetic/14/4824/4484", 200, "doitt:south-"),
      // central-upper-manhattan (wave 4)
      syntheticGroup("wgs84-geodetic/14/4825/4479", 12, "doitt:upper-"),
      // northern-manhattan (wave 5)
      syntheticGroup("wgs84-geodetic/14/4827/4472", 5, "doitt:north-"),
    ],
    ...overrides,
  };
}

describe("exterior wave plan", () => {
  it("orders the waves exactly as the Goal fixes them", () => {
    expect(EXTERIOR_WAVE_PLAN.map((wave) => wave.waveId)).toEqual([
      "block-835",
      "midtown-core",
      "lower-manhattan",
      "southern-remainder",
      "central-upper-manhattan",
      "northern-manhattan",
    ]);
    expect(EXTERIOR_WAVE_PLAN.map((wave) => wave.waveIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("partitions the occupied level-14 tile rows exactly once", () => {
    const owners = new Map<number, string>();
    for (const wave of EXTERIOR_WAVE_PLAN) {
      if (wave.tileRowRange === null) continue;
      for (let rowY = wave.tileRowRange.northRowY; rowY <= wave.tileRowRange.southRowY; rowY += 1) {
        expect(owners.has(rowY)).toBe(false);
        owners.set(rowY, wave.waveId);
      }
    }
    const expected = [];
    for (let rowY = EXTERIOR_WAVE_TILE_ROW_ENVELOPE.northRowY; rowY <= EXTERIOR_WAVE_TILE_ROW_ENVELOPE.southRowY; rowY += 1) expected.push(rowY);
    expect([...owners.keys()].sort((left, right) => left - right)).toEqual(expected);
  });

  it("keeps waves 3..5 strictly south-to-north", () => {
    // Larger tile row y is further south in the WGS84 geodetic scheme.
    const remainder = EXTERIOR_WAVE_PLAN.filter((wave) => wave.waveIndex >= 3).map((wave) => wave.tileRowRange!);
    for (let index = 1; index < remainder.length; index += 1) {
      expect(remainder[index]!.southRowY).toBeLessThan(remainder[index - 1]!.northRowY);
    }
  });
});

describe("buildExteriorWaveLedger", () => {
  it("produces a ledger that passes the accepted release-graph schema and the wave invariants", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput());
    const validation = validateExteriorWaveLedger(ledger);
    expect(validation.ok ? [] : validation.issues).toEqual([]);
  });

  it("gives every base building exactly one owner cell", () => {
    const input = syntheticInput();
    const { ledger } = buildExteriorWaveLedger(input);
    const expected = input.shardGroups.flatMap((group) => group.buildings.map((building) => building.buildingId)).sort();
    const owned = ledger.cells.flatMap((cell) => cell.buildingIds).sort();
    expect(owned).toEqual(expected);
    expect(new Set(owned).size).toBe(owned.length);
    expect(ledger.baseIdentitySet.buildingCount).toBe(owned.length);
    expect(ledger.baseIdentitySet.checksumSha256).toBe(sha256HexSync(stableSerialize(owned)));
  });

  it("carves the declared Block 835 set out of its containing tile", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput());
    const blockCell = ledger.cells.find((cell) => cellWaveIndex(cell.cellId) === 0);
    expect(blockCell).toBeDefined();
    expect(blockCell!.order).toBe(0);
    expect(blockCell!.buildingIds).toEqual([...BLOCK_835_DOITT_IDS].map((id) => `doitt:${id}`).sort());
    expect(blockCell!.bounds).toEqual(BLOCK_835_CELL_BOUNDS);
    expect(blockCell!.membershipChecksumSha256).toBe(membershipChecksum(block835BuildingIds()));

    const host = parseTileKey(BLOCK_835_TILE_KEY);
    const hostCells = ledger.cells.filter((cell) => {
      const tile = cellTileKey(cell.cellId);
      if (!tile) return false;
      const factor = 2 ** (tile.level - EXTERIOR_WAVE_TILE_LEVEL);
      return Math.floor(tile.x / factor) === host.x && Math.floor(tile.y / factor) === host.y;
    });
    expect(hostCells.length).toBeGreaterThan(0);
    for (const cell of hostCells) for (const buildingId of block835BuildingIds()) expect(cell.buildingIds).not.toContain(buildingId);
  });

  it("splits over-cap tiles until every cell fits the runtime cap", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput());
    for (const cell of ledger.cells) {
      expect(cell.buildingIds.length).toBeGreaterThan(0);
      expect(cell.buildingIds.length).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
    }
    expect(ledger.cells.some((cell) => (cellTileKey(cell.cellId)?.level ?? 0) > EXTERIOR_WAVE_TILE_LEVEL)).toBe(true);
  });

  it("honours a tighter cap and rejects an unusable one", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput({ maxCellBuildings: 25 }));
    expect(Math.max(...ledger.cells.map((cell) => cell.buildingIds.length))).toBeLessThanOrEqual(25);
    expect(() => buildExteriorWaveLedger(syntheticInput({ maxCellBuildings: 0 }))).toThrow(/positive integer/u);
  });

  it("keeps lexicographic cell-id order equal to visual-priority order", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput());
    const byOrder = [...ledger.cells].sort((left, right) => left.order - right.order).map((cell) => cell.cellId);
    const lexicographic = [...byOrder].sort();
    expect(lexicographic).toEqual(byOrder);
    expect(byOrder.map((_, index) => index)).toEqual([...ledger.cells].sort((left, right) => left.order - right.order).map((cell) => cell.order));
  });

  it("assigns every cell to the wave that owns its level-14 tile row", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput());
    for (const cell of ledger.cells) {
      const tile = cellTileKey(cell.cellId);
      const wave = EXTERIOR_WAVE_PLAN[cellWaveIndex(cell.cellId)]!;
      if (tile === null) { expect(wave.waveIndex).toBe(0); continue; }
      const factor = 2 ** (tile.level - EXTERIOR_WAVE_TILE_LEVEL);
      const rowY = Math.floor(tile.y / factor);
      expect(rowY).toBeGreaterThanOrEqual(wave.tileRowRange!.northRowY);
      expect(rowY).toBeLessThanOrEqual(wave.tileRowRange!.southRowY);
    }
  });

  it("orders waves first and then south-to-north, west-to-east inside a wave", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput());
    const ordered = [...ledger.cells].sort((left, right) => left.order - right.order);
    let previousWave = -1;
    for (const cell of ordered) {
      const waveIndex = cellWaveIndex(cell.cellId);
      expect(waveIndex).toBeGreaterThanOrEqual(previousWave);
      previousWave = waveIndex;
    }
    const wave5 = ordered.filter((cell) => cellWaveIndex(cell.cellId) === 5);
    const wave1 = ordered.filter((cell) => cellWaveIndex(cell.cellId) === 1);
    expect(wave1[0]!.order).toBeLessThan(wave5[0]!.order);
  });

  it("declares coverage as the exact union rectangle of the cell rectangles", () => {
    const { ledger } = buildExteriorWaveLedger(syntheticInput());
    expect(ledger.coverage).toEqual({
      west: Math.min(...ledger.cells.map((cell) => cell.bounds.west)),
      south: Math.min(...ledger.cells.map((cell) => cell.bounds.south)),
      east: Math.max(...ledger.cells.map((cell) => cell.bounds.east)),
      north: Math.max(...ledger.cells.map((cell) => cell.bounds.north)),
    });
  });

  it("is deterministic and independent of shard input order", () => {
    const input = syntheticInput();
    const first = buildExteriorWaveLedger(input).ledger;
    const second = buildExteriorWaveLedger({ ...input, shardGroups: [...input.shardGroups].reverse() }).ledger;
    expect(stableSerialize(second)).toBe(stableSerialize(first));
  });

  it("re-identifies the ledger when the pinned base snapshot changes", () => {
    const first = buildExteriorWaveLedger(syntheticInput()).ledger;
    const second = buildExteriorWaveLedger(syntheticInput({ baseManifestChecksumSha256: "c".repeat(64) })).ledger;
    expect(second.ledgerId).not.toBe(first.ledgerId);
    expect(second.baseIdentitySet.id).not.toBe(first.baseIdentitySet.id);
    expect(second.baseIdentitySet.checksumSha256).toBe(first.baseIdentitySet.checksumSha256);
  });

  it("fails closed on inputs the contract cannot describe", () => {
    expect(() => buildExteriorWaveLedger(syntheticInput({ shardGroups: [] }))).toThrow(/at least one base shard group/u);
    expect(() => buildExteriorWaveLedger(syntheticInput({ baseManifestChecksumSha256: "not-a-hash" }))).toThrow(/SHA-256/u);
    expect(() => buildExteriorWaveLedger(syntheticInput({
      shardGroups: [syntheticGroup("wgs84-geodetic/14/4823/4486", 3, "doitt:low-")],
    }))).toThrow(/Block 835/u);
    expect(() => buildExteriorWaveLedger(syntheticInput({
      shardGroups: [
        syntheticGroup(BLOCK_835_TILE_KEY, 2, "doitt:dup-", block835BuildingIds()),
        syntheticGroup("wgs84-geodetic/14/4823/4486", 2, "doitt:dup-"),
      ],
    }))).toThrow(/more than one shard/u);
    expect(() => buildExteriorWaveLedger(syntheticInput({
      shardGroups: [...syntheticInput().shardGroups, syntheticGroup("wgs84-geodetic/12/1206/1120", 2, "doitt:coarse-")],
    }))).toThrow(/not a level-14 tile/u);
    expect(() => buildExteriorWaveLedger(syntheticInput({
      shardGroups: [...syntheticInput().shardGroups, syntheticGroup("wgs84-geodetic/14/4824/4490", 2, "doitt:offshore-")],
    }))).toThrow(/outside every declared exterior wave range/u);
  });
});

describe("validateExteriorWaveLedger", () => {
  const base = () => buildExteriorWaveLedger(syntheticInput()).ledger;
  const mutate = (change: (ledger: ExteriorOwnershipLedger) => void): ExteriorOwnershipLedger => {
    const copy = JSON.parse(JSON.stringify(base())) as ExteriorOwnershipLedger;
    change(copy);
    return copy;
  };
  const issuesOf = (ledger: unknown): string[] => {
    const result = validateExteriorWaveLedger(ledger);
    return result.ok ? [] : result.issues.map((entry) => entry.message);
  };

  it("fails closed on an absent or non-object candidate instead of throwing", () => {
    for (const candidate of [null, undefined, [], "ledger", 7] as unknown[]) {
      const result = validateExteriorWaveLedger(candidate);
      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.issues).toEqual([{ path: "ownershipLedger", message: "Canonical ownership ledger must be an object." }]);
    }
  });

  it("reports probe-graph diagnostics as ledger issues, never as root claims", () => {
    const ledger = mutate((copy) => { copy.ledgerId = ""; });
    const result = validateExteriorWaveLedger(ledger);
    expect(result.ok).toBe(false);
    const paths = result.ok ? [] : result.issues.map((entry) => entry.path);
    expect(paths.every((path) => path.startsWith("ownershipLedger"))).toBe(true);
    expect(paths.some((path) => path.startsWith("roots"))).toBe(false);
  });

  it("rejects an over-cap cell", () => {
    const ledger = mutate((copy) => {
      const target = copy.cells.find((cell) => cell.order > 0)!;
      target.buildingIds = Array.from({ length: EXTERIOR_CELL_MAX_BUILDINGS + 1 }, (_, index) => `doitt:extra-${index}`);
      target.membershipChecksumSha256 = membershipChecksum(target.buildingIds);
    });
    expect(issuesOf(ledger).join(" ")).toMatch(/above the 120-building runtime cap/u);
  });

  it("rejects a cell id whose sequence drifts from its order", () => {
    const ledger = mutate((copy) => {
      const target = copy.cells.find((cell) => cell.order === 1)!;
      target.cellId = target.cellId.replace("-000001-", "-000009-");
    });
    expect(issuesOf(ledger).join(" ")).toMatch(/sequence must equal the cell order/u);
  });

  it("rejects a cell placed in the wrong wave", () => {
    const ledger = mutate((copy) => {
      const target = copy.cells.find((cell) => cellWaveIndex(cell.cellId) === 5)!;
      target.cellId = target.cellId.replace("-w05-", "-w04-");
    });
    expect(issuesOf(ledger).join(" ")).toMatch(/outside wave central-upper-manhattan/u);
  });

  it("rejects bounds that are not the tile rectangle they are named for", () => {
    const ledger = mutate((copy) => {
      const target = copy.cells.find((cell) => cell.order > 0)!;
      target.bounds = { ...target.bounds, north: target.bounds.north + 0.001 };
      copy.coverage = { ...copy.coverage, north: Math.max(copy.coverage.north, target.bounds.north) };
    });
    expect(issuesOf(ledger).join(" ")).toMatch(/exact WGS84 tile rectangle/u);
  });

  it("rejects a coverage rectangle that is not the exact union", () => {
    const ledger = mutate((copy) => { copy.coverage = { ...copy.coverage, north: copy.coverage.north + 1 }; });
    expect(issuesOf(ledger).join(" ")).toMatch(/exact union rectangle/u);
  });

  it("rejects Block 835 membership drift", () => {
    const ledger = mutate((copy) => {
      const target = copy.cells.find((cell) => cell.order === 0)!;
      target.buildingIds = [...target.buildingIds.slice(1), "doitt:mid-0"].sort();
      target.membershipChecksumSha256 = membershipChecksum(target.buildingIds);
    });
    expect(issuesOf(ledger).join(" ")).toMatch(/exactly the declared DOITT set/u);
  });

  it("delegates schema and cross-cell membership invariants to the accepted validator", () => {
    const duplicated = mutate((copy) => {
      const [first, second] = [copy.cells[1]!, copy.cells[2]!];
      second.buildingIds = [...second.buildingIds, first.buildingIds[0]!].sort();
      second.membershipChecksumSha256 = membershipChecksum(second.buildingIds);
    });
    expect(issuesOf(duplicated).join(" ")).toMatch(/exactly one canonical owner cell/u);

    const drifted = mutate((copy) => { copy.cells[1]!.membershipChecksumSha256 = "a".repeat(64); });
    expect(issuesOf(drifted).join(" ")).toMatch(/membership checksum mismatch/iu);

    const widened = mutate((copy) => { (copy.cells[1] as unknown as Record<string, unknown>).waveId = "midtown-core"; });
    expect(issuesOf(widened).join(" ")).toMatch(/Unexpected release field/u);
  });
});

describe("committed exterior wave ledger artifacts", () => {
  const artifactRoot = "data/normalized/manhattan-exterior-wave-ledger-20260804";
  const read = (name: string) => new TextDecoder().decode(readFileSync(`${artifactRoot}/${name}`));
  const ledger = JSON.parse(read("ledger.json")) as ExteriorOwnershipLedger;
  const digest = JSON.parse(read("membership-digest.json")) as ExteriorWaveLedgerDigest;
  const eligibility = JSON.parse(read("eligibility.json")) as ExteriorLedgerEligibility;
  const ledgerChecksum = exteriorArtifactChecksum(ledger);

  it("passes the accepted release-graph schema and the wave invariants", () => {
    const validation = validateExteriorWaveLedger(ledger);
    expect(validation.ok ? [] : validation.issues).toEqual([]);
  });

  it("owns the approved snapshot's 45,194 buildings exactly once", () => {
    const owned = ledger.cells.flatMap((cell) => cell.buildingIds);
    expect(owned).toHaveLength(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(new Set(owned).size).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(ledger.baseIdentitySet.buildingCount).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(ledger.baseIdentitySet.checksumSha256).toBe(membershipChecksum(owned));
    expect(ledger.baseIdentitySet.id.startsWith(`${EXTERIOR_WAVE_BASE_RELEASE_ID}:exterior-base-identity:`)).toBe(true);
  });

  it("keeps a contiguous global order that survives the runtime lexicographic sort", () => {
    const ordered = [...ledger.cells].sort((left, right) => left.order - right.order);
    expect(ordered.map((cell) => cell.order)).toEqual(ordered.map((_, index) => index));
    expect([...ledger.cells.map((cell) => cell.cellId)].sort()).toEqual(ordered.map((cell) => cell.cellId));
  });

  it("respects the runtime membership cap on every cell", () => {
    expect(Math.max(...ledger.cells.map((cell) => cell.buildingIds.length))).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
    expect(Math.min(...ledger.cells.map((cell) => cell.buildingIds.length))).toBeGreaterThan(0);
  });

  it("covers every occupied level-14 tile row exactly once through its waves", () => {
    const rows = new Map<number, number>();
    for (const cell of ledger.cells) {
      const tile = cellTileKey(cell.cellId);
      if (tile === null) continue;
      const factor = 2 ** (tile.level - EXTERIOR_WAVE_TILE_LEVEL);
      const rowY = Math.floor(tile.y / factor);
      const waveIndex = cellWaveIndex(cell.cellId);
      const previous = rows.get(rowY);
      if (previous !== undefined) expect(previous).toBe(waveIndex);
      rows.set(rowY, waveIndex);
    }
    const observed = [...rows.keys()].sort((left, right) => left - right);
    expect(observed[0]).toBe(EXTERIOR_WAVE_TILE_ROW_ENVELOPE.northRowY);
    expect(observed[observed.length - 1]).toBe(EXTERIOR_WAVE_TILE_ROW_ENVELOPE.southRowY);
    expect(observed).toHaveLength(EXTERIOR_WAVE_TILE_ROW_ENVELOPE.southRowY - EXTERIOR_WAVE_TILE_ROW_ENVELOPE.northRowY + 1);
  });

  it("keeps every cell rectangle inside the declared coverage rectangle", () => {
    for (const cell of ledger.cells) {
      expect(cell.bounds.west).toBeGreaterThanOrEqual(ledger.coverage.west);
      expect(cell.bounds.south).toBeGreaterThanOrEqual(ledger.coverage.south);
      expect(cell.bounds.east).toBeLessThanOrEqual(ledger.coverage.east);
      expect(cell.bounds.north).toBeLessThanOrEqual(ledger.coverage.north);
    }
  });

  it("pins the ledger from its checksum file, digest, and eligibility siblings", () => {
    expect(read("ledger.sha256").trim()).toBe(`${ledgerChecksum}  ledger.json`);
    expect(digest.ledgerChecksumSha256).toBe(ledgerChecksum);
    expect(eligibility.ledgerChecksumSha256).toBe(ledgerChecksum);
    expect(digest.ledgerId).toBe(ledger.ledgerId);
    expect(eligibility.ledgerId).toBe(ledger.ledgerId);
    expect(validateExteriorWaveLedgerDigest(digest, ledger, ledgerChecksum, {
      ledgerChecksumSha256: ledgerChecksum,
      baseReleaseId: digest.baseReleaseId,
      baseManifestChecksumSha256: digest.baseManifestChecksumSha256,
    })).toEqual([]);
    expect(validateExteriorLedgerEligibility(eligibility, ledger, ledgerChecksum)).toEqual([]);
  });

  it("reports every wave and keeps the digest consistent with the ledger", () => {
    expect(digest.baseReleaseId).toBe(EXTERIOR_WAVE_BASE_RELEASE_ID);
    expect(digest.cellCount).toBe(ledger.cells.length);
    expect(digest.maxObservedCellBuildings).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
    expect(digest.waves.map((wave) => wave.waveId)).toEqual(EXTERIOR_WAVE_PLAN.map((wave) => wave.waveId));
    expect(digest.waves.reduce((total, wave) => total + wave.buildingCount, 0)).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(digest.waves.every((wave) => wave.cellCount > 0)).toBe(true);
    expect(digest.waves[0]!.buildingCount).toBe(BLOCK_835_DOITT_IDS.length);
    const rebuilt = exteriorWaveLedgerDigest(ledger, {
      ledgerChecksumSha256: ledgerChecksum,
      baseReleaseId: digest.baseReleaseId,
      baseManifestChecksumSha256: digest.baseManifestChecksumSha256,
    });
    expect(stableSerialize(rebuilt)).toBe(stableSerialize(digest));
  });

  it("binds ledgerId and baseIdentitySet.id to their documented derivation", () => {
    const owned = ledger.cells.flatMap((cell) => cell.buildingIds);
    const expectedBaseIdentityId = deriveExteriorBaseIdentitySetId({
      baseReleaseId: digest.baseReleaseId,
      baseManifestChecksumSha256: digest.baseManifestChecksumSha256,
      buildingCount: ledger.baseIdentitySet.buildingCount,
      membershipChecksumSha256: membershipChecksum(owned),
    });
    expect(ledger.baseIdentitySet.id).toBe(expectedBaseIdentityId);

    const expectedLedgerId = deriveExteriorWaveLedgerId({
      baseReleaseId: digest.baseReleaseId,
      baseManifestChecksumSha256: digest.baseManifestChecksumSha256,
      baseIdentitySetId: expectedBaseIdentityId,
      cityId: ledger.cityId,
      configId: ledger.configId,
      maxCellBuildings: digest.maxCellBuildings,
      coverage: ledger.coverage,
      cells: ledger.cells,
    });
    expect(ledger.ledgerId).toBe(expectedLedgerId);
  });

  it("re-derives a different ledgerId when any part of the partition moves", () => {
    const derive = (cells: typeof ledger.cells) => deriveExteriorWaveLedgerId({
      baseReleaseId: digest.baseReleaseId,
      baseManifestChecksumSha256: digest.baseManifestChecksumSha256,
      baseIdentitySetId: ledger.baseIdentitySet.id,
      cityId: ledger.cityId,
      configId: ledger.configId,
      maxCellBuildings: digest.maxCellBuildings,
      coverage: ledger.coverage,
      cells,
    });
    expect(derive(ledger.cells)).toBe(ledger.ledgerId);
    const tampered = ledger.cells.map((cell, index) => (index === 5 ? { ...cell, membershipChecksumSha256: "a".repeat(64) } : cell));
    expect(derive(tampered)).not.toBe(ledger.ledgerId);
  });

  it("keeps the Block 835 bounds literal equal to the frozen public-realm clip rectangle", () => {
    const publicRealm = JSON.parse(new TextDecoder().decode(readFileSync("data/normalized/manhattan-esb-block-public-realm-20260806/manifest.json"))) as { clip: { clipBounds: typeof BLOCK_835_CELL_BOUNDS } };
    expect(BLOCK_835_CELL_BOUNDS).toEqual(publicRealm.clip.clipBounds);
    expect(ledger.cells.find((cell) => cell.order === 0)!.bounds).toEqual(publicRealm.clip.clipBounds);
  });

  it("declares private-only eligibility for every cell", () => {
    expect(eligibility.cells).toHaveLength(ledger.cells.length);
    expect(eligibility.cells.every((cell) => cell.privateEligible && !cell.publicEligible)).toBe(true);
  });
});
