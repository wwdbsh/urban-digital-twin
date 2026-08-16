/* global TextDecoder, console, process */
/**
 * The T004 RETENTION-PACKAGE validator.
 *
 * `scripts/validate-multi-lod-assembly.mjs` stays byte-untouched: it is the
 * public single-manifest gate and its only flag is additive. This is its
 * retention sibling, and the difference that matters is WHERE THE ADMISSION
 * POLICY COMES FROM.
 *
 * There is no `--texture-admission` flag here and there must never be one. The
 * policy is read from the package's own checksum-pinned retention root:
 *
 *   1. `retention-root.json` is read at its declared size, as a regular
 *      non-symlink file, inside the package directory;
 *   2. its self-pin is recomputed over its own canonical bytes — an edited root
 *      fails here, before any policy is read;
 *   3. `exteriorTextureAdmissionPolicyOf`, the same fail-closed reader the
 *      emitter and the runtime use, turns the root's declaration into a policy,
 *      where absent / malformed / unknown all mean `texture-free`;
 *   4. that policy is handed to `validateMultiLodAssembly` and
 *      `replayMultiLodAssembly`, and nothing else can reach that decision.
 *
 * So this validator has strictly LESS authority than the operator running it. A
 * package whose root declares nothing is checked texture-free and its textured
 * GLBs fail — the fail-closed direction. No security gate is widened by this
 * file existing; see the module header of `src/release/mass-generation-retention.ts`
 * and ADR 0051.
 *
 * The unit of validation is ONE OWNERSHIP CELL, because the 256 MiB in-memory
 * replay bound makes a whole-wave manifest infeasible.
 *
 * ## Completeness is not optional
 *
 * The root's pin covers the owned-cell id SET, so a foreign cell cannot be
 * appended. It does not cover the per-entry checksums, which are circular with
 * the manifests that cite it. A DROPPED manifest is therefore only detectable
 * against something outside the root, so this validator REFUSES to report `ok`
 * unless it was given at least one completeness source:
 *
 *   --inventory  the committed payload inventory, whose `cellManifestCount` and
 *                per-file entries the declared set must agree with, and whose
 *                own bytes are checked against its committed `.sha256` sidecar;
 *   --census     the committed wave census, whose generated/tombstoned/owned
 *                accounting the packaged building set must close against.
 *
 * A run that walked a subset (`--max-cells`) cannot satisfy either and says so.
 *
 * usage: pnpm retention:validate -- --package public/data/<releaseId>
 *          [--inventory data/<id>/payload-inventory.json]
 *          [--census data/<id>/wave-census.json]
 *          [--evidence-out FILE] [--max-cells N]
 */
import { constants } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  RETENTION_ROOT_REF,
  retentionTextureAdmissionPolicy,
  validateRetentionReleaseRoot,
} from "../src/release/mass-generation-retention.ts";
import { replayMultiLodAssembly, validateMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";

const MAX_ROOT_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_CELL_TOTAL_BYTES = 256 * 1024 * 1024;

function fail(message) { throw new Error(message); }

export function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inline = equals === -1 ? null : token.slice(equals + 1);
    if (inline !== null) { if (inline.length === 0) fail(`Missing value for --${name}.`); result[name] = inline; continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${token}.`);
    result[name] = value;
    index += 1;
  }
  // Refuse anything that even looks like an attempt to assert the policy.
  for (const forbidden of ["texture-admission", "admission", "policy", "procedural-replay", "require-textured", "require-texture-free", "texture-free"]) {
    if (forbidden in result) fail(`--${forbidden} is refused: the texture admission policy is read from the package's pinned root and can never be supplied by an operator.`);
  }
  return result;
}

function contained(root, candidate) {
  const path = relative(root, candidate);
  return path.length > 0 && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}

/** Reads a regular, non-symlink file at exactly its expected size. */
async function boundedFile(path, label, expectedBytes, maximumBytes) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) fail(`${label} must be a regular non-symlink file.`);
  if (before.size !== expectedBytes || before.size > maximumBytes) fail(`${label} byte size differs from its bounded declaration.`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== expectedBytes || opened.dev !== before.dev || opened.ino !== before.ino) fail(`${label} changed before its bounded read.`);
    const bytes = new Uint8Array(expectedBytes);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) fail(`${label} ended before its declared byte size.`);
      offset += bytesRead;
    }
    const extra = new Uint8Array(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) fail(`${label} exceeds its declared byte size.`);
    return bytes;
  } finally { await handle.close(); }
}

async function readJsonAt(root, relativeRef, label, maximumBytes, expectedChecksum) {
  const path = resolve(root, ...relativeRef.split("/"));
  if (!contained(root, path)) fail(`${label} escapes the package root: ${relativeRef}`);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) fail(`${label} must be a bounded regular non-symlink file.`);
  const resolved = await realpath(path);
  if (!contained(root, resolved)) fail(`${label} resolves outside the package root: ${relativeRef}`);
  const bytes = await boundedFile(resolved, label, stat.size, maximumBytes);
  const checksum = sha256HexBytes(bytes);
  if (expectedChecksum !== undefined && checksum !== expectedChecksum) {
    fail(`${label} checksum disagrees with the root's declaration: declared ${expectedChecksum}, measured ${checksum}.`);
  }
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), bytes, checksum };
}

/**
 * Reads a COMMITTED record and checks it against its own `.sha256` sidecar.
 *
 * A completeness source that is not itself pinned would let an edited census
 * excuse a dropped manifest, which is the failure this whole section exists to
 * prevent.
 */
async function readCommittedRecord(path, label) {
  const resolved = resolve(path);
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ROOT_BYTES) fail(`${label} must be a bounded regular non-symlink file.`);
  const bytes = await boundedFile(await realpath(resolved), label, stat.size, MAX_ROOT_BYTES);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const sidecarPath = resolved.replace(/\.json$/u, ".sha256");
  const sidecarStat = await lstat(sidecarPath).catch(() => null);
  if (!sidecarStat?.isFile()) fail(`${label} carries no committed .sha256 sidecar; an unpinned completeness source cannot excuse a dropped manifest.`);
  const sidecarBytes = await boundedFile(await realpath(sidecarPath), `${label} sidecar`, sidecarStat.size, MAX_ROOT_BYTES);
  const declared = new TextDecoder("utf-8", { fatal: true }).decode(sidecarBytes).trim().split(/\s+/u)[0];
  const measured = sha256HexBytes(bytes);
  if (declared !== measured) fail(`${label} does not match its committed sidecar: declared ${declared}, measured ${measured}.`);
  return JSON.parse(text);
}

/**
 * The RETENTION-SPECIFIC assertions, on top of the schema the assembly
 * validator already enforces. Each one is a property the wave contract claims
 * and the generic gate does not check.
 */
export function retentionAssertions(manifest) {
  const issues = [];
  let fallbackCount = 0;
  let silhouetteCount = 0;
  for (const asset of manifest.assets) {
    if (asset.lods.length !== 2) {
      issues.push(`${asset.canonicalFeatureId}: a retention asset declares exactly two levels, found ${asset.lods.length}.`);
      continue;
    }
    const [fine, coarse] = asset.lods;
    if (fine.silhouette !== null) issues.push(`${asset.canonicalFeatureId}: the fine level must carry no silhouette record.`);
    // EVERY coarse level carries a silhouette record, including a fallback
    // whose deviation is zero. A missing record on a fallback would be the
    // quiet way to stop measuring the buildings the cap excluded.
    if (coarse.silhouette === null) {
      issues.push(`${asset.canonicalFeatureId}: the coarse level carries no silhouette record.`);
    } else {
      silhouetteCount += 1;
      if (coarse.silhouette.planHashSha256 !== asset.source.planHashSha256) {
        issues.push(`${asset.canonicalFeatureId}: the silhouette record is bound to a different plan hash than the asset's source.`);
      }
      if (coarse.silhouette.deviationRatio > coarse.silhouette.maximumRatio) {
        issues.push(`${asset.canonicalFeatureId}: declared silhouette deviation ${coarse.silhouette.deviationRatio} exceeds the ${coarse.silhouette.maximumRatio} cap.`);
      }
    }
    // The measured-fallback contract, checked as a pair rather than as two
    // independent facts: an ineligible coarse level declares zero derived
    // error, and a zero-deviation coarse level that is still eligible would be
    // claiming a shed level that dropped nothing.
    if (!coarse.eligible) {
      fallbackCount += 1;
      if (coarse.geometricErrorMeters !== 0) {
        issues.push(`${asset.canonicalFeatureId}: an ineligible coarse level must declare a derived geometric error of 0, found ${coarse.geometricErrorMeters}.`);
      }
      if (coarse.silhouette !== null && coarse.silhouette.deviationRatio !== 0) {
        issues.push(`${asset.canonicalFeatureId}: a full-geometry coarse level dropped nothing, so its deviation must be 0, found ${coarse.silhouette.deviationRatio}.`);
      }
      if (coarse.quality.triangleCount !== fine.quality.triangleCount) {
        issues.push(`${asset.canonicalFeatureId}: a full-geometry coarse level must carry the fine level's triangle count.`);
      }
      if (fine.maxDistanceMeters !== null) {
        issues.push(`${asset.canonicalFeatureId}: with an ineligible coarse level the fine level must be unbounded, or the asset has no eligible representation at range.`);
      }
    }
  }
  return { issues, fallbackCount, silhouetteCount };
}

async function main() {
  const options = args(process.argv.slice(2));
  if (!options.package) fail("Usage: pnpm retention:validate -- --package DIR [--census FILE] [--max-cells N]");
  const root = await realpath(resolve(options.package));

  // ---- 1. the pinned root, and the policy that comes only from it ----------
  const rootRead = await readJsonAt(root, RETENTION_ROOT_REF, "Retention root", MAX_ROOT_BYTES);
  const rootFileChecksum = rootRead.checksum;
  const rootFileBytes = rootRead.bytes.byteLength;
  const rootResult = validateRetentionReleaseRoot(rootRead.value);
  if (!rootResult.ok) fail(`Retention root is invalid:\n${rootResult.issues.join("\n")}`);
  const retentionRoot = rootResult.value;
  const admissionPolicy = retentionTextureAdmissionPolicy(retentionRoot);
  const declaredSamplerFilter = retentionRoot.textureAdmission?.generatedTextureFact?.samplerFilter;
  const policy = {
    textureAdmission: admissionPolicy,
    ...(declaredSamplerFilter ? { declaredSamplerFilter: { ...declaredSamplerFilter } } : {}),
  };

  // ---- 2. every declared cell manifest, one bounded package at a time ------
  const limit = options["max-cells"] === undefined ? retentionRoot.cellManifests.length : Number(options["max-cells"]);
  if (!Number.isSafeInteger(limit) || limit <= 0) fail("--max-cells must be a positive integer.");
  const cells = [...retentionRoot.cellManifests].sort((left, right) => (left.cellId < right.cellId ? -1 : 1)).slice(0, limit);

  let checkedCells = 0;
  let checkedAssets = 0;
  let checkedArtifacts = 0;
  let totalBytes = 0;
  let fallbackTotal = 0;
  let silhouetteTotal = 0;
  const packagedBuildings = new Set();
  const cellFingerprints = [];

  for (const declared of cells) {
    const label = `Cell manifest ${declared.cellId}`;
    const manifestRead = await readJsonAt(root, declared.relativeRef, label, MAX_MANIFEST_BYTES, declared.checksumSha256);
    if (manifestRead.bytes.byteLength !== declared.byteSize) fail(`${label} byte size differs from the root's declaration.`);

    const shape = validateMultiLodAssembly(manifestRead.value, policy);
    if (!shape.ok) fail(`${label} failed the assembly schema:\n${shape.issues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);
    const manifest = shape.value;
    if (manifest.cells.length !== 1 || manifest.cells[0].cellId !== declared.cellId) {
      fail(`${label} must describe exactly its own ownership cell.`);
    }
    if (manifest.release.rootId !== retentionRoot.rootId || manifest.release.rootChecksumSha256 !== retentionRoot.rootChecksumSha256) {
      fail(`${label} cites a different release root than the one that declared it.`);
    }
    if (manifest.declaredTotalBytes > MAX_CELL_TOTAL_BYTES) fail(`${label} exceeds the ${MAX_CELL_TOTAL_BYTES}-byte replay bound.`);

    const contents = new Map();
    let loaded = 0;
    for (const artifact of [...manifest.artifacts].sort((a, b) => a.relativeRef.localeCompare(b.relativeRef))) {
      const path = resolve(root, ...artifact.relativeRef.split("/"));
      if (!contained(root, path)) fail(`Artifact escapes package root: ${artifact.relativeRef}`);
      const candidate = await lstat(path);
      if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.size !== artifact.byteSize) fail(`Artifact size/type differs before read: ${artifact.relativeRef}`);
      const resolved = await realpath(path);
      if (!contained(root, resolved)) fail(`Artifact resolves outside package root: ${artifact.relativeRef}`);
      const bytes = await boundedFile(resolved, artifact.relativeRef, artifact.byteSize, MAX_CELL_TOTAL_BYTES);
      loaded += bytes.byteLength;
      if (loaded > MAX_CELL_TOTAL_BYTES) fail(`${label} exceeded its aggregate byte bound during replay.`);
      contents.set(artifact.relativeRef, bytes);
    }

    const replay = await replayMultiLodAssembly(manifest, contents, policy);
    if (!replay.ok) fail(`${label} failed replay:\n${replay.issues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);

    const retention = retentionAssertions(manifest);
    if (retention.issues.length > 0) fail(`${label} failed the retention contract:\n${retention.issues.join("\n")}`);

    for (const buildingId of manifest.cells[0].buildingIds) {
      if (packagedBuildings.has(buildingId)) fail(`Building ${buildingId} is packaged by more than one cell.`);
      packagedBuildings.add(buildingId);
    }
    checkedCells += 1;
    checkedAssets += manifest.assets.length;
    checkedArtifacts += replay.value.verifiedArtifacts.length;
    totalBytes += replay.value.totalBytes;
    fallbackTotal += retention.fallbackCount;
    silhouetteTotal += retention.silhouetteCount;
    cellFingerprints.push({ cellId: declared.cellId, fingerprintSha256: replay.value.fingerprintSha256 });
  }

  // ---- 3. COMPLETENESS, which is not optional --------------------------------
  const walkedWholeSet = cells.length === retentionRoot.cellManifests.length;
  let inventoryAccounting = null;
  let tombstones = null;

  if (options.inventory) {
    const inventory = await readCommittedRecord(options.inventory, "Payload inventory");
    if (inventory.releaseId !== retentionRoot.releaseId) fail(`Payload inventory names release ${inventory.releaseId}, not ${retentionRoot.releaseId}.`);
    if (inventory.retentionRoot?.rootChecksumSha256 !== retentionRoot.rootChecksumSha256) {
      fail("Payload inventory pins a different retention root than the package carries.");
    }
    if (inventory.cellManifestCount !== retentionRoot.cellManifests.length) {
      fail(`Payload inventory declares ${inventory.cellManifestCount} cell manifests against the root's ${retentionRoot.cellManifests.length}: a manifest has been dropped or appended.`);
    }
    // The root file itself is an inventory entry, so an edited root is caught by
    // the committed record even though the root cannot pin its own bytes.
    const rootEntry = (inventory.files ?? []).find((file) => file.path === RETENTION_ROOT_REF);
    if (!rootEntry) fail(`Payload inventory declares no entry for ${RETENTION_ROOT_REF}.`);
    if (rootEntry.checksumSha256 !== rootFileChecksum || rootEntry.byteSize !== rootFileBytes) {
      fail(`${RETENTION_ROOT_REF} differs from the committed inventory: declared ${rootEntry.checksumSha256}/${rootEntry.byteSize}, measured ${rootFileChecksum}/${rootFileBytes}.`);
    }
    // Every declared manifest must also be an inventory entry at the same bytes.
    const byPath = new Map((inventory.files ?? []).map((file) => [file.path, file]));
    for (const declared of retentionRoot.cellManifests) {
      const entry = byPath.get(declared.relativeRef);
      if (!entry) fail(`Payload inventory declares no entry for ${declared.relativeRef}.`);
      if (entry.checksumSha256 !== declared.checksumSha256 || entry.byteSize !== declared.byteSize) {
        fail(`${declared.relativeRef} differs between the root and the committed inventory.`);
      }
    }
    const inventoryManifestFiles = (inventory.files ?? []).filter((file) => /^public\/assemblies\/.+\.json$/u.test(file.path)).length;
    if (inventoryManifestFiles !== retentionRoot.cellManifests.length) {
      fail(`Payload inventory carries ${inventoryManifestFiles} assembly manifests against ${retentionRoot.cellManifests.length} declared.`);
    }
    inventoryAccounting = { cellManifestCount: inventory.cellManifestCount, fileCount: inventory.totals.fileCount, byteSize: inventory.totals.byteSize };
  }

  if (options.census) {
    const census = await readCommittedRecord(options.census, "Census");
    if (census.releaseId !== retentionRoot.releaseId) fail(`Census names release ${census.releaseId}, not ${retentionRoot.releaseId}.`);
    const owned = census.ownedBuildingCount;
    const generated = census.generatedBuildingCount;
    const tombstoned = Array.isArray(census.tombstones) ? census.tombstones.length : null;
    if (typeof owned !== "number" || typeof generated !== "number" || tombstoned === null) {
      fail("Census must declare ownedBuildingCount, generatedBuildingCount and a tombstones array for accounting.");
    }
    if (census.tombstonedBuildingCount !== tombstoned) fail(`Census claims ${census.tombstonedBuildingCount} tombstoned against ${tombstoned} tombstone records.`);
    if (generated + tombstoned !== owned) {
      fail(`Census does not account for its own wave: ${generated} generated + ${tombstoned} tombstoned != ${owned} owned.`);
    }
    if (walkedWholeSet && packagedBuildings.size !== generated) {
      fail(`The package holds ${packagedBuildings.size} buildings against a census claiming ${generated} generated.`);
    }
    if (walkedWholeSet && census.lod1FallbackCount !== fallbackTotal) {
      fail(`Census claims ${census.lod1FallbackCount} LOD-1 fallbacks against ${fallbackTotal} measured in the package.`);
    }
    for (const tombstone of census.tombstones) {
      if (packagedBuildings.has(tombstone.buildingId)) fail(`Building ${tombstone.buildingId} is both tombstoned and packaged.`);
      if (typeof tombstone.stopCode !== "string" || tombstone.stopCode.length === 0) fail(`Tombstone for ${tombstone.buildingId} carries no stop code.`);
    }
    tombstones = { ownedBuildingCount: owned, generatedBuildingCount: generated, tombstonedBuildingCount: tombstoned };
  }

  // The refusal that makes the two above load-bearing rather than decorative.
  if (!inventoryAccounting && !tombstones) {
    fail("Refusing to report ok: no completeness source. A dropped cell manifest is invisible to the root's own pin, so --inventory and/or --census is REQUIRED.");
  }
  if (!walkedWholeSet) {
    fail(`Refusing to report ok: --max-cells walked ${cells.length} of ${retentionRoot.cellManifests.length} declared manifests, which cannot establish completeness.`);
  }

  const evidence = {
    schemaVersion: "1.0",
    artifact: "retention-package-validation",
    ok: true,
    releaseId: retentionRoot.releaseId,
    waveId: retentionRoot.waveId,
    rootChecksumSha256: retentionRoot.rootChecksumSha256,
    // Stated so a reader can see WHERE the policy came from, not merely what it was.
    textureAdmission: { policy: admissionPolicy, source: `${RETENTION_ROOT_REF} (checksum-pinned; not operator-supplied)` },
    declaredCellCount: retentionRoot.cellManifests.length,
    validatedCellCount: checkedCells,
    assets: checkedAssets,
    artifacts: checkedArtifacts,
    packagedBuildingCount: packagedBuildings.size,
    silhouetteRecords: silhouetteTotal,
    lod1FallbackCount: fallbackTotal,
    totalBytes,
    tombstones,
    inventoryAccounting,
    completenessSources: [inventoryAccounting ? "payload-inventory" : null, tombstones ? "wave-census" : null].filter(Boolean),
    cellFingerprints,
  };
  if (options["evidence-out"]) {
    const outPath = resolve(options["evidence-out"]);
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(outPath, serialized);
    await writeFile(outPath.replace(/\.json$/u, ".sha256"), `${sha256HexSync(serialized)}  ${outPath.split("/").pop()}\n`);
  }
  console.log(JSON.stringify({ ...evidence, cellFingerprints: `[${cellFingerprints.length} cells]` }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
