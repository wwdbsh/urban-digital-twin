/**
 * The promoted far-tier inventory: six wave inventories merged into the one
 * declaration the runtime pins.
 *
 * WHY THE SERIALIZER LIVES HERE AND IS EXPORTED.
 *
 * The runtime pins ONE digest for the whole tier and fails closed on a
 * mismatch, so the staged copy under the serving root and the committed record
 * under `data/` must be byte-identical — not equivalent, not equal after
 * parsing, IDENTICAL. Two writers that each `JSON.stringify` with their own
 * spacing produce two files that mean the same thing and hash differently, and
 * the symptom is not a diff: it is the entire tier failing closed in every
 * session, on every machine, with a message about a digest.
 *
 * So there is exactly one function that turns an inventory into bytes, both
 * writers call it, and a test asserts the staged bytes equal the committed
 * bytes. The stage CLI additionally COPIES the committed bytes rather than
 * re-serializing them, which makes the identity hold by construction; the
 * shared serializer is what makes the copy verifiable rather than merely
 * hopeful.
 */

import { sha256HexSync } from "../domain/deterministic-hash.ts";
import type { FarTierInventoryEntry } from "../runtime/far-tier-serving.ts";

/** The committed record, which is the runtime's `FarTierInventory` plus provenance. */
export interface FarTierPromotedInventory {
  readonly schemaVersion: string;
  readonly inventoryId: string;
  readonly derivedFrom: Readonly<Record<string, unknown>>;
  readonly coverage: Readonly<Record<string, unknown>>;
  readonly entries: readonly FarTierInventoryEntry[];
}

/**
 * THE ONE SERIALIZER.
 *
 * One-space indent and a trailing newline, matching the T003 inventory this one
 * supersedes, so the two records read the same way in a diff and neither writer
 * has to remember a format.
 */
export function serializeFarTierInventory(inventory: FarTierPromotedInventory): string {
  return `${JSON.stringify(inventory, null, 1)}\n`;
}

export function farTierInventoryDigest(inventory: FarTierPromotedInventory): string {
  return sha256HexSync(serializeFarTierInventory(inventory));
}

export interface FarTierWaveInventoryInput {
  readonly waveId: string;
  readonly entries: readonly FarTierInventoryEntry[];
  /** The committed path of THIS wave's inventory, and the digest of those bytes. */
  readonly recordPath: string;
  readonly recordSha256: string;
}

export interface FarTierMergeInput {
  readonly waves: readonly FarTierWaveInventoryInput[];
  readonly honestStopCellIds: readonly string[];
  readonly ledgerCellCount: number;
  readonly ledgerChecksumSha256: string;
  readonly recipeId: string;
  readonly recipeSha256: string;
  /** The id this promotion is published under. */
  readonly inventoryId: string;
  /**
   * The record this promotion derives from: its committed PATH and the digest
   * of THAT path's bytes.
   *
   * PATH AND DIGEST TRAVEL TOGETHER, and that is the whole point of the shape.
   * An earlier version hardcoded the path to T004's campaign summary while the
   * caller passed whatever digest it liked, so a later promotion published a
   * provenance block naming one record and hashing another. Nothing could catch
   * it: both fields were individually well-formed. Pairing them in one object
   * makes the mismatch impossible to express.
   */
  readonly derivedFromRecord: { readonly path: string; readonly sha256: string };
}

export class FarTierMergeError extends Error {
  constructor(message: string) { super(message); this.name = "FarTierMergeError"; }
}

/**
 * Merge the wave inventories, and REFUSE rather than paper over a discrepancy.
 *
 * The three things checked here are the three that would make the promoted
 * inventory a lie the runtime could not detect: a duplicated cell (two entries,
 * one tile, an ambiguous digest), a cell that is neither baked nor a named
 * stop (a silent hole in the island), and a total that disagrees with the
 * ledger the campaign was measured against.
 */
export function mergeFarTierWaveInventories(input: FarTierMergeInput): FarTierPromotedInventory {
  const entries: FarTierInventoryEntry[] = [];
  const seen = new Set<string>();
  for (const wave of input.waves) {
    for (const entry of wave.entries) {
      if (seen.has(entry.cellId)) {
        throw new FarTierMergeError(`cell ${entry.cellId} appears in more than one wave inventory; a promoted inventory with two declarations for one tile cannot be pinned.`);
      }
      seen.add(entry.cellId);
      entries.push(entry);
    }
  }

  const stops = new Set(input.honestStopCellIds);
  const overlap = [...stops].filter((cellId) => seen.has(cellId));
  if (overlap.length > 0) {
    throw new FarTierMergeError(`${overlap.length} cell(s) are both baked and recorded as honest stops, starting with ${overlap[0]}.`);
  }

  const accountedFor = entries.length + stops.size;
  if (accountedFor !== input.ledgerCellCount) {
    throw new FarTierMergeError(`${entries.length} baked plus ${stops.size} honest stops is ${accountedFor}, against ${input.ledgerCellCount} cells in the ledger; the promotion would claim a coverage it does not have.`);
  }

  // Declared order is the wave order the campaign baked in, then each wave's own
  // inventory order. Never a Set's iteration order, and never re-sorted here:
  // the bytes are pinned, so the order is part of the artifact.
  return {
    schemaVersion: "1.0",
    inventoryId: input.inventoryId,
    derivedFrom: {
      record: input.derivedFromRecord.path,
      recordSha256: input.derivedFromRecord.sha256,
      waves: input.waves.map((wave) => ({
        waveId: wave.waveId,
        entries: wave.entries.length,
        inventoryRecord: wave.recordPath,
        inventorySha256: wave.recordSha256,
      })),
      recipeId: input.recipeId,
      recipeSha256: input.recipeSha256,
      statement: "DERIVED FROM COMMITTED TEXT, NOT FROM A DIRECTORY LISTING. Every entry is copied from a sealed per-wave inventory whose own replay verified it; nothing here was read off the staged bytes. Every path above is paired with the digest of that same path's bytes.",
    },
    coverage: {
      ledgerCellCount: input.ledgerCellCount,
      ledgerChecksumSha256: input.ledgerChecksumSha256,
      bakedCells: entries.length,
      honestStopCells: stops.size,
      accountedFor,
      everyLedgerCellAccountedFor: true,
      honestStopCellIds: [...input.honestStopCellIds],
      statement: "Every cell the ledger declares is either an entry below or a named honest stop above. A cell in neither list would be a hole this record cannot see, which is why the merge refuses to write one.",
    },
    entries,
  };
}
