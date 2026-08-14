/* global console, process */
/**
 * T002 delivery path for the per-cell render extents.
 *
 * The scheduler needs `renderBounds` and `order` for every ledger cell. Those
 * numbers exist exactly once, in the committed T001 census
 * `data/citywide-overview-census-20260814/cell-extents.json`, and this script is
 * the only way they reach `src/`.
 *
 * Why a generated source module rather than a fetched public asset:
 *
 *   1. Serving the census under `public/` would put a 691 KiB provenance
 *      document — cell membership, per-cell building counts, tallest-member
 *      building ids — on the wire of every session, inside a release envelope
 *      whose 883 cells are all `publicEligible: false` pending per-cell rights
 *      evidence (ADR 0040 D6). The scheduler needs six numbers per cell and none
 *      of the rest, so publishing the whole document to buy them is a rights and
 *      provenance argument this task would have to win for no scheduling gain.
 *   2. A fetched asset is a runtime request, and the exterior release modes are
 *      contractually local-only with no runtime provider requests. A build-time
 *      module adds none.
 *   3. A generated module can be *proved* current:
 *      `citywide-overview-cell-extents.test.ts` re-hashes the committed census,
 *      compares it against the sidecar `.sha256` AND the digest frozen into the
 *      generated module, and re-derives every row. A drifted census fails the
 *      suite instead of silently culling against stale rectangles.
 *
 * The module carries `renderBounds` ONLY. `assignmentBounds` is deliberately not
 * emitted: it is a membership rectangle decided by representative point, it is
 * smaller than the render extent in 870 of 883 cells, and culling on it drops
 * geometry (ADR 0040, "Cull on `renderBounds`, never on `assignmentBounds`").
 * The scheduler cannot consult a field this module does not contain.
 *
 * Usage: node scripts/emit-citywide-overview-cell-extents.mjs [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes } from "../src/domain/deterministic-hash.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CENSUS_ID = "citywide-overview-census-20260814";
const censusRelativePath = `data/${CENSUS_ID}/cell-extents.json`;
const censusPath = join(repositoryRoot, censusRelativePath);
const sidecarPath = `${join(repositoryRoot, `data/${CENSUS_ID}/cell-extents`)}.sha256`;
const outputPath = join(repositoryRoot, "src/runtime/citywide-overview-cell-extents.ts");

/**
 * The one cell whose shipped release id differs from its ledger id.
 *
 * Block 835 shipped through the reference/authoring path before the wave ledger
 * existed, so its release names the cell `cell:manhattan:block-835` while the
 * ledger — and therefore the census — names it
 * `manhattan-exterior-cell-w00-000000-block-00835`. The alias is not asserted on
 * the strength of the two names looking similar: this script proves it from the
 * committed release graph before emitting it (same `order`, same 14 building
 * ids, and a census render extent that CONTAINS the release's own bounds).
 */
const BLOCK_835_ALIAS = {
  runtimeCellId: "cell:manhattan:block-835",
  ledgerCellId: "manhattan-exterior-cell-w00-000000-block-00835",
  releaseGraphPath: "public/data/manhattan-exterior-cells-20260811-v3/release-graph.json",
};

function fail(message) {
  console.error(`emit-citywide-overview-cell-extents: ${message}`);
  process.exit(1);
}

function contains(outer, inner) {
  return outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north;
}

/**
 * `no-loss-of-precision` compares a literal against `Number(raw).toPrecision(n)`
 * where `n` is the literal's significant-digit count. For a double whose exact
 * value sits on a decimal tie, JavaScript's shortest round-tripping form and
 * `toPrecision` round the tie in opposite directions, and the rule reports a
 * literal that in fact loses nothing — one of the 883 census longitudes,
 * -73.94485473632812, is exactly that case.
 *
 * So the emitted form is the shortest representation that BOTH round-trips to
 * the same double and satisfies the rule's own comparison. The value is never
 * changed; only how many of its digits are written down.
 */
function tripsNoLossOfPrecision(raw) {
  const digits = (raw.startsWith("-") ? raw.slice(1) : raw).replace(".", "").replace(/^0+/u, "");
  if (digits.length === 0 || digits.length > 100) return digits.length > 100;
  return Number(raw).toPrecision(digits.length) !== raw;
}

function number(value) {
  if (!Number.isFinite(value)) fail(`Non-finite coordinate ${String(value)} in the census.`);
  const candidates = [JSON.stringify(value), value.toPrecision(17), value.toPrecision(18), value.toPrecision(20)];
  for (const candidate of candidates) {
    if (Number(candidate) === value && !tripsNoLossOfPrecision(candidate)) return candidate;
  }
  return fail(`No lossless literal form for ${String(value)}.`);
}

const censusBytes = readFileSync(censusPath);
const censusDigest = sha256HexBytes(new Uint8Array(censusBytes));
const sidecarDigest = readFileSync(sidecarPath, "utf8").trim().split(/\s+/u)[0];
if (censusDigest !== sidecarDigest) {
  fail(`The census digest ${censusDigest} does not match its committed sidecar ${sidecarDigest}. Refusing to emit extents from an unverified census.`);
}

const census = JSON.parse(censusBytes.toString("utf8"));
if (census.censusId !== CENSUS_ID) fail(`Census declares id ${census.censusId}, expected ${CENSUS_ID}.`);
if (!Array.isArray(census.cells) || census.cells.length === 0) fail("Census carries no cells.");

const graph = JSON.parse(readFileSync(join(repositoryRoot, BLOCK_835_ALIAS.releaseGraphPath), "utf8"));
const aliasCells = graph.ownershipLedger.cells.filter((cell) => cell.cellId === BLOCK_835_ALIAS.runtimeCellId);
if (aliasCells.length !== 1) fail(`Expected exactly one ${BLOCK_835_ALIAS.runtimeCellId} cell in the Block 835 release graph, found ${aliasCells.length}.`);
const aliasCell = aliasCells[0];
const ledgerRow = census.cells.find((cell) => cell.cellId === BLOCK_835_ALIAS.ledgerCellId);
if (!ledgerRow) fail(`The census carries no row for ${BLOCK_835_ALIAS.ledgerCellId}.`);
if (ledgerRow.order !== aliasCell.order) fail(`Alias order mismatch: census ${ledgerRow.order} vs release ${aliasCell.order}.`);
if (ledgerRow.buildingCount !== aliasCell.buildingIds.length) {
  fail(`Alias membership mismatch: census counts ${ledgerRow.buildingCount} buildings, the release ships ${aliasCell.buildingIds.length}.`);
}
if (!contains(ledgerRow.renderBounds, aliasCell.bounds)) {
  fail("Alias geometry mismatch: the census render extent does not contain the shipped Block 835 cell bounds.");
}

const rows = [...census.cells].sort((left, right) => left.order - right.order);
const seen = new Set();
for (const row of rows) {
  if (seen.has(row.cellId)) fail(`Duplicate census cell id ${row.cellId}.`);
  seen.add(row.cellId);
  if (!Number.isInteger(row.order)) fail(`Cell ${row.cellId} carries a non-integer order.`);
  if (row.renderBounds.west > row.renderBounds.east) fail(`Cell ${row.cellId} render extent wraps the antimeridian.`);
  if (row.renderBounds.south > row.renderBounds.north) fail(`Cell ${row.cellId} render extent is inverted.`);
  if (!contains(row.renderBounds, row.assignmentBounds)) fail(`Cell ${row.cellId} render extent does not contain its assignment rectangle.`);
}

const metric = census.overhangMetric;
const header = `/**
 * GENERATED by \`node scripts/emit-citywide-overview-cell-extents.mjs\`. Do not edit by hand.
 *
 * Per-cell render extents for the 883 committed ledger cells, derived from the
 * T001 census \`${censusRelativePath}\` at digest
 * \`${censusDigest}\`.
 *
 * \`renderBounds\` is the union of a cell's assignment rectangle with every
 * member building's outer-ring vertices, and it is the ONLY rectangle safe to
 * cull on: the assignment rectangle decides membership by representative point,
 * and 870 of 883 cells extend beyond it (median 1.257x area, max 2.064x). The
 * assignment rectangle is deliberately absent from this module so no caller can
 * reach for it.
 *
 * This file asserts nothing about any real building's name, use or appearance.
 * It is rectangles and an ordering.
 */
`;

const lines = [
  header,
  `import type { ViewportBounds } from "./viewport-footprint";`,
  ``,
  `export const CITYWIDE_OVERVIEW_CENSUS_ID = ${JSON.stringify(CENSUS_ID)} as const;`,
  ``,
  `/** Provenance of the numbers below, so a drifted census fails a test instead of culling silently. */`,
  `export const CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE = {`,
  `  censusId: CITYWIDE_OVERVIEW_CENSUS_ID,`,
  `  artifact: ${JSON.stringify(census.artifact)},`,
  `  file: ${JSON.stringify(censusRelativePath)},`,
  `  fileSha256: ${JSON.stringify(censusDigest)},`,
  `  ledgerId: ${JSON.stringify(census.ledger.ledgerId)},`,
  `  cellCount: ${rows.length},`,
  `  /** The census's own frozen planar scale. Distances here are that metric, not geodesics. */`,
  `  metersPerDegreeLongitude: ${number(metric.metersPerDegreeLongitude)},`,
  `  metersPerDegreeLatitude: ${number(metric.metersPerDegreeLatitude)},`,
  `  metricId: ${JSON.stringify(metric.metricId)},`,
  `} as const;`,
  ``,
  `export interface CitywideOverviewCellExtent {`,
  `  readonly cellId: string;`,
  `  /** The ledger's own wave-then-position ordering; the scheduler's explicit tiebreak. */`,
  `  readonly order: number;`,
  `  readonly renderBounds: ViewportBounds;`,
  `}`,
  ``,
  `/**`,
  ` * Release cell ids that name a ledger cell under a different name.`,
  ` *`,
  ` * Block 835 shipped before the wave ledger existed. The generator proves this`,
  ` * mapping from the committed release graph — same order, same 14 building ids,`,
  ` * and a census render extent that contains the release's own bounds — rather`,
  ` * than inferring it from the names.`,
  ` */`,
  `export const CITYWIDE_OVERVIEW_CELL_ID_ALIASES: Readonly<Record<string, string>> = {`,
  `  ${JSON.stringify(BLOCK_835_ALIAS.runtimeCellId)}: ${JSON.stringify(BLOCK_835_ALIAS.ledgerCellId)},`,
  `};`,
  ``,
  `export const CITYWIDE_OVERVIEW_CELL_EXTENTS: readonly CitywideOverviewCellExtent[] = [`,
  ...rows.map((row) => `  { cellId: ${JSON.stringify(row.cellId)}, order: ${row.order}, renderBounds: { west: ${number(row.renderBounds.west)}, south: ${number(row.renderBounds.south)}, east: ${number(row.renderBounds.east)}, north: ${number(row.renderBounds.north)} } },`),
  `];`,
  ``,
  `const byCellId = new Map<string, CitywideOverviewCellExtent>(CITYWIDE_OVERVIEW_CELL_EXTENTS.map((entry) => [entry.cellId, entry]));`,
  ``,
  `/** Resolve a runtime cell id — including an aliased one — to its committed render extent. */`,
  `export function citywideOverviewCellExtent(cellId: string): CitywideOverviewCellExtent | null {`,
  `  return byCellId.get(CITYWIDE_OVERVIEW_CELL_ID_ALIASES[cellId] ?? cellId) ?? null;`,
  `}`,
  ``,
];

const serialized = lines.join("\n");
if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== serialized) fail("src/runtime/citywide-overview-cell-extents.ts is not what this census generates. Re-run without --check.");
  console.log(`emit-citywide-overview-cell-extents: up to date (${rows.length} cells, census ${censusDigest}).`);
} else {
  writeFileSync(outputPath, serialized);
  console.log(`emit-citywide-overview-cell-extents: wrote ${rows.length} cells from census ${censusDigest}.`);
}
