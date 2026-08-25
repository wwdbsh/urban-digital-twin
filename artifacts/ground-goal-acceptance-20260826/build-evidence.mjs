#!/usr/bin/env node
/**
 * Regenerates `evidence.json` — the machine facts the T015 acceptance record
 * (ACCEPTANCE.md) cites.
 *
 * Run from the repository root:
 *
 *   node artifacts/ground-goal-acceptance-20260826/build-evidence.mjs
 *
 * Every number this writes is READ or MEASURED, never transcribed from prose.
 * Facts that a command produces rather than a file (test counts, validator
 * output, benchmark percentiles) are NOT invented here: they are read from the
 * `campaign` block below, which is the campaign's own recorded run and is
 * carried forward verbatim so the file stays regenerable without re-running a
 * 70-second suite. Re-running the suite is the way to check it; the commands
 * are named in `campaign.commands`.
 *
 * Payload note: `public/data/` and `data/raw/` are gitignored. On a clone
 * without them this script fails closed with a named error rather than writing
 * a file with zeroes in it.
 */

import { createHash } from "node:crypto";
import { stdout } from "node:process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function require_(relativePath) {
  const absolute = resolve(repoRoot, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(
      `Missing payload: ${relativePath}\n` +
        "public/data/ and data/raw/ are gitignored. Build or restore the releases " +
        "before regenerating this evidence file; a partial file would be worse than none.",
    );
  }
  return absolute;
}

function fileFact(relativePath) {
  const absolute = require_(relativePath);
  return { path: relativePath, sha256: sha256(absolute), bytes: readFileSync(absolute).byteLength };
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

const groundRoot = "public/data/manhattan-ground-20260824";
const curbRoot = "public/data/manhattan-ground-embellishment-20260825";
const imageryRoot = "public/data/manhattan-ground-zone-imagery-20260826";

const ground = readJson(require_(`${groundRoot}/release.json`));
const curbs = readJson(require_(`${curbRoot}/release.json`));
const imagery = readJson(require_(`${imageryRoot}/release.json`));
const zoneIndex = readJson(require_(`${imageryRoot}/zone-imagery.json`));

const census = readJson(require_("artifacts/ground-embellishment-promotion-20260826/wave-curb-census.json"));
const namedPlaces = readJson(require_("artifacts/named-places-20260826/named-places-evidence.json"));

const releases = {
  ground: {
    releaseId: ground.releaseId,
    immutable: ground.immutable,
    generatedAt: ground.generatedAt,
    ownershipLedgerId: ground.ownershipLedgerId,
    partitionSchemeId: ground.partitionSchemeId,
    files: [`${groundRoot}/release.json`, `${groundRoot}/ledger.json`, `${groundRoot}/features.json`, `${groundRoot}/parts.json`].map(fileFact),
  },
  curbs: {
    releaseId: curbs.releaseId,
    immutable: curbs.immutable,
    generatedAt: curbs.generatedAt,
    ownershipLedgerId: curbs.ownershipLedgerId,
    files: [`${curbRoot}/release.json`, `${curbRoot}/ledger.json`].map(fileFact),
  },
  zoneImagery: {
    releaseId: imagery.releaseId,
    immutable: imagery.immutable,
    generatedAt: imagery.generatedAt,
    // The mirrored ledger id IS the compatibility pin: it must equal the base's.
    ownershipLedgerId: imagery.ownershipLedgerId,
    pinnedToBaseReleaseId: zoneIndex.baseReleaseId,
    compatibilityPinHolds: imagery.ownershipLedgerId === ground.ownershipLedgerId,
    captureYear: zoneIndex.captureYear,
    targetGroundSampleDistanceMeters: zoneIndex.targetGroundSampleDistanceMeters,
    texturedZones: zoneIndex.entries.length,
    recordedRefusals: zoneIndex.refusals.length,
    files: [`${imageryRoot}/release.json`, `${imageryRoot}/zone-imagery.json`].map(fileFact),
  },
};

// ---------------------------------------------------------------------------
// Near-tier curb census (re-derived by `pnpm ground-embellishment:census`)
// ---------------------------------------------------------------------------

const curbCensus = {
  source: fileFact("artifacts/ground-embellishment-promotion-20260826/wave-curb-census.json"),
  regeneratedBy: "pnpm ground-embellishment:census",
  servingCeilingBytes: census.servingCeilingBytes,
  maxActiveCells: census.maxActiveCells,
  promotedWaves: census.promotedWaves,
  promotedRelease: {
    cellsWithCurbArtifacts: census.promotedRelease.cellsWithCurbArtifacts,
    totalArtifactBytes: census.promotedRelease.totalArtifactBytes,
    curbParts: census.promotedRelease.curbParts,
    drawnWalls: census.promotedRelease.drawnWalls,
    drawnTriangles: census.promotedRelease.drawnTriangles,
    refusedParts: census.promotedRelease.refusedParts,
    largestArtifactFractionOfCeiling: census.promotedRelease.largestArtifact.fractionOfServingCeiling,
    worstCaseActiveCells: census.promotedRelease.worstCaseActiveSet.cells,
  },
  budgetBreaches: census.budgetBreaches.length,
  // The two margins with no headroom at all.
  zeroHeadroom: {
    ringAtCeiling: census.promotedRelease.worstCaseActiveSet.cells === census.maxActiveCells,
    largestArtifactFraction: census.promotedRelease.largestArtifact.fractionOfServingCeiling,
  },
  perWave: census.waves.map((w) => ({
    waveId: w.waveId,
    promoted: w.promoted,
    cells: w.cellsWithCurbArtifacts,
    bytes: w.totalArtifactBytes,
    walls: w.drawnWalls,
    triangles: w.drawnTriangles,
    refusedParts: w.refusedParts,
    largestArtifactFractionOfCeiling: w.largestArtifact.fractionOfServingCeiling,
    worstCaseActiveCells: w.worstCaseActiveSet.cells,
    breachesBudget: w.breachesBudget,
  })),
  shippedButNeverActivatedCells: census.shippedCellsInNoWaveRow.cellIds.length,
};

// ---------------------------------------------------------------------------
// Named places (re-derived by `pnpm named-places:evidence`)
// ---------------------------------------------------------------------------

const places = {
  source: fileFact("artifacts/named-places-20260826/named-places-evidence.json"),
  regeneratedBy: "pnpm named-places:evidence",
  count: namedPlaces.places.length,
  groundReleaseId: namedPlaces.groundReleaseId,
  zoneImageryReleaseId: namedPlaces.zoneImageryReleaseId,
  entries: namedPlaces.places.map((p) => ({
    placeKey: p.placeKey,
    displayName: p.displayName,
    canonicalFeatureId: p.canonicalFeatureId,
    groundClass: p.groundClass,
    identityOrigin: p.identityOrigin,
    deepLink: p.deepLink,
    ownerCells: p.ownerCellIds.length,
    texturedCells: p.imagerySummary?.textured ?? null,
    refusedCells: p.imagerySummary?.refused ?? null,
    unaccountedCells: p.imagerySummary?.unaccounted ?? null,
    geometryInView: p.geometryInView,
    sourceRefCount: Array.isArray(p.sourceRefs) ? p.sourceRefs.length : null,
  })),
};

// ---------------------------------------------------------------------------
// Campaign run — 2026-08-26, one machine, one session
// ---------------------------------------------------------------------------

const campaign = {
  ranAt: "2026-08-26",
  branch: "fcp/144-acceptance-campaign",
  headCommit: "6329585",
  note:
    "Recorded output of the T015 campaign run. These are measurements of a " +
    "process, not of a file, so they are carried here rather than re-derived. " +
    "Re-run the commands in `commands` to check any of them.",
  commands: {
    validate: "pnpm citywide:validate",
    benchmark: "pnpm citywide:benchmark",
    tests: "pnpm test",
    testsSerial: "npx vitest run --no-file-parallelism",
    census: "pnpm ground-embellishment:census",
    namedPlaces: "pnpm named-places:evidence",
    zoneImagery: "pnpm zone-imagery:validate",
  },
  validate: {
    exitCode: 0,
    phases: 3,
    citywideRelease: { valid: true, declaredFiles: 452, totalDeclaredBytes: 304382520, buildings: 45194, restaurants: 109386 },
    groundRelease: {
      valid: true,
      cells: 140,
      features: 42778,
      parts: 47779,
      artifacts: 352,
      totalArtifactBytes: 182027517,
      coordinatesChecked: 13154558,
      maxCellExcursionDegrees: 4.999999703159119e-8,
      maxObservedRelativeAreaError: 2.482730398582752e-9,
    },
    zoneImagery: { valid: true, textures: 87, recordedRefusals: 75, mebibytes: 56.8 },
  },
  benchmark: {
    exitCode: 0,
    scope: "buildings + restaurants search/pick only — loads ZERO ground, curb or imagery bytes (recorded gap)",
    searchSamples: 30,
    pickSamples: 30,
    coldSearchP95Ms: 14.923667000000023,
    warmSearchP95Ms: 15.237875000000031,
    coldPickP95Ms: 4.578625000000102,
    warmPickP95Ms: 1.981999999999971,
    recordedBudgetSearchP95Ms: { cold: 16.96, warm: 16.81 },
    recordedBudgetPickP95Ms: { cold: 6.44, warm: 2.68 },
    boundedReleaseShards: 451,
  },
  tests: {
    head: { files: 231, passed: 3655, failed: 7, skipped: 18, exitCode: 1 },
    headSerial: {
      files: 231,
      passed: 3658,
      failed: 4,
      skipped: 18,
      exitCode: 1,
      command: "npx vitest run --no-file-parallelism",
      note:
        "With worker contention removed, the failure set at HEAD is a strict " +
        "SUBSET of the pre-goal baseline's failure set. Every remaining failure " +
        "also failed before the goal's first commit.",
    },
    preGoalBaseline: {
      commit: "b38e40f",
      description: "the commit immediately before T001 (#145) — the goal's first",
      files: 211,
      passed: 3252,
      failed: 5,
      skipped: 18,
      exitCode: 1,
      method: "detached worktree with node_modules, public/data and data symlinked from the main tree so the payload-dependent tests see identical inputs",
    },
    preExistingFailures: [
      "src/runtime/exterior-serving-residency.test.ts > re-derives the assembly per-asset weight from the committed retention packages",
      "src/app/App.test.tsx > closes details with Escape and returns focus to the located-pick trigger",
      "src/app/App.test.tsx > streams the whole promoted set in a default session, naming each wave",
      "src/app/App.test.tsx > streams the promoted release with no exterior parameters once a real base is active",
      "src/app/App.test.tsx > keeps the promotion gates in force after an off/on toggle, so a drifted record still fails closed",
    ],
    newLoadDependentFailures: [
      "src/app/ground-canary.test.tsx > serves near-tier curbs in the default session, appended to the base's status line",
      "src/app/ground-canary.test.tsx > deactivates exactly one wave's cells when that wave is rolled back",
    ],
    newLoadDependentFailuresNote:
      "Both PASS when the file runs alone (19/19), at every intermediate commit of the goal under the same payload (T012 15/15, T013 16/16, T014 19/19 in a detached worktree), and in the full suite under --no-file-parallelism. They appear only under parallel full-suite worker load. They are NOT pre-existing — the file did not exist before T007 — and they are recorded as a genuine new defect in the TEST SUITE, not in the shipped release.",
    escapeFocusFlake: {
      test: "src/app/App.test.tsx > closes details with Escape and returns focus to the located-pick trigger",
      status:
        "Pre-existing (fails in the pre-goal baseline too) and confirmed contention-only: passes under --no-file-parallelism. Matches the prior goal's recorded finding.",
    },
  },
};

// ---------------------------------------------------------------------------

const evidence = {
  schemaVersion: "ground-goal-acceptance-evidence-1",
  goal: "manhattan-citywide-public-realm",
  goalIssue: 129,
  task: "T015",
  taskIssue: 144,
  generatedBy: "artifacts/ground-goal-acceptance-20260826/build-evidence.mjs",
  mergedTaskPullRequests: {
    T001: 145, T002: 146, T003: 148, T004: 153, T005: 147, T006: 149, T007: 150,
    T008: 154, T009: 152, T010: 155, T011: 157, T012: 156, T013: 158, T014: 159,
    "ad-hoc-issue-46": 151,
  },
  releases,
  curbCensus,
  places,
  campaign,
};

const outPath = resolve(here, "evidence.json");
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
stdout.write(`wrote ${outPath}\n`);
