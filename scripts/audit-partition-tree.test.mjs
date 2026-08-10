import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  PROHIBITED_EVIDENCE_TOKENS,
  auditPartitionTree,
  classifyPrivateFindings,
  matchProhibitedTokens,
  privatePathSegments,
  scanTreeForPrivatePaths,
  scanTreeForProhibitedEvidence,
  classifyEvidenceFinding,
} from "./audit-partition-tree.mjs";
import {
  findPrivatePartitionDirectories,
  prunePrivatePartitions,
  resolveDistArgument,
  runPrunePrivatePartitionsCli,
} from "./prune-private-partitions.mjs";
import { DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS } from "../src/domain/exterior-evidence-intake.ts";

function fixtureTree() {
  const root = mkdtempSync(join(tmpdir(), "udt-partition-audit-"));
  mkdirSync(join(root, "data/pkg/private/assets"), { recursive: true });
  mkdirSync(join(root, "data/pkg/public/assets"), { recursive: true });
  mkdirSync(join(root, "data/frozen/private/assets"), { recursive: true });
  writeFileSync(join(root, "data/pkg/private/assets/a.glb"), "shared-bytes");
  writeFileSync(join(root, "data/pkg/public/assets/a.glb"), "shared-bytes");
  writeFileSync(join(root, "data/frozen/private/assets/b.glb"), "private-only-bytes");
  writeFileSync(join(root, "data/pkg/public/notes.json"), JSON.stringify({ note: "no imagery admitted" }));
  return root;
}

describe("private-path detection", () => {
  it("flags any path segment literally named private", () => {
    expect(privatePathSegments("data/pkg/private/assets/a.glb")).toHaveLength(1);
    expect(privatePathSegments("data/pkg/public/assets/a.glb")).toHaveLength(0);
    expect(privatePathSegments("data/privateer/a.glb")).toHaveLength(0);
  });

  it("finds every private file under a static root and reports its hash", () => {
    const root = fixtureTree();
    const result = scanTreeForPrivatePaths(root, "fixture");
    expect(result.present).toBe(true);
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) expect(finding.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports an absent tree as absent rather than as a pass", () => {
    const result = scanTreeForPrivatePaths(join(tmpdir(), "udt-does-not-exist-xyz"), "missing");
    expect(result.present).toBe(false);
    expect(auditPartitionTree({ distDir: join(tmpdir(), "udt-does-not-exist-xyz"), publicDir: fixtureTree() }).f1PrivatePaths.pass).toBeNull();
  });
});

describe("duplicate-versus-private-only classification", () => {
  it("separates a duplicated public byte from a private-only byte", () => {
    const root = fixtureTree();
    const findings = classifyPrivateFindings(root, scanTreeForPrivatePaths(root, "fixture").findings);
    const duplicate = findings.find((finding) => finding.path.includes("pkg"));
    const privateOnly = findings.find((finding) => finding.path.includes("frozen"));
    expect(duplicate?.classification).toBe("duplicate-of-public-byte");
    expect(duplicate?.duplicateOfPublicPath).toBe("data/pkg/public/assets/a.glb");
    expect(privateOnly?.classification).toBe("private-only-byte");
    expect(privateOnly?.duplicateOfPublicPath).toBeNull();
  });
});

describe("prohibited evidence vocabulary", () => {
  it("covers every disallowed source classification the domain declares", () => {
    for (const classification of DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS) {
      expect(PROHIBITED_EVIDENCE_TOKENS).toContain(classification);
    }
  });

  it("matches case-insensitively and reports the token that matched", () => {
    expect(matchProhibitedTokens("Sourced from Google Maps imagery")).toContain("google maps");
    expect(matchProhibitedTokens("STREET-VIEW capture")).toContain("street-view");
    expect(matchProhibitedTokens("NYC OTI building footprints")).toHaveLength(0);
  });

  it("finds no prohibited token in a clean tree", () => {
    const result = scanTreeForProhibitedEvidence(fixtureTree(), "fixture");
    expect(result.findings).toHaveLength(0);
    expect(result.scanned).toBeGreaterThan(0);
  });

  it("reports a planted token with its file and hash", () => {
    const root = fixtureTree();
    writeFileSync(join(root, "data/pkg/public/leak.json"), JSON.stringify({ origin: "street-view" }));
    const result = scanTreeForProhibitedEvidence(root, "fixture");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].path).toBe("data/pkg/public/leak.json");
    expect(result.findings[0].tokens).toContain("street-view");
    expect(result.findings[0].classification).toBe("release-data");
  });
});

describe("finding classification", () => {
  it("separates release data from third-party runtime code", () => {
    expect(classifyEvidenceFinding("data/pkg/public/notes.json")).toBe("release-data");
    expect(classifyEvidenceFinding("cesiumStatic/ThirdParty/google-earth-dbroot-parser.js")).toBe("vendor-runtime");
    expect(classifyEvidenceFinding("assets/index-T-wrPl4q.js")).toBe("vendor-runtime");
    expect(classifyEvidenceFinding("index.html")).toBe("other");
  });

  it("fails the criterion only on a release-data token, and never hides a vendor one", () => {
    const root = fixtureTree();
    mkdirSync(join(root, "cesiumStatic/ThirdParty"), { recursive: true });
    writeFileSync(join(root, "cesiumStatic/ThirdParty/vendor.js"), "streetview endpoint");
    const vendorOnly = auditPartitionTree({ distDir: root, publicDir: root }).f2ProhibitedEvidence;
    expect(vendorOnly.vendorRuntimeFindings.length).toBeGreaterThan(0);
    expect(vendorOnly.releaseDataFindings).toHaveLength(0);
    expect(vendorOnly.pass).toBe(true);
    writeFileSync(join(root, "data/pkg/public/leak.json"), JSON.stringify({ origin: "street-view" }));
    const withLeak = auditPartitionTree({ distDir: root, publicDir: root }).f2ProhibitedEvidence;
    // The fixture points both trees at one directory, so the leak is reported
    // once per scanned tree.
    expect(withLeak.releaseDataFindings.map((finding) => finding.path)).toEqual(["data/pkg/public/leak.json", "data/pkg/public/leak.json"]);
    expect(withLeak.pass).toBe(false);
  });
});

describe("audit report shape", () => {
  it("answers both questions with counts and a pass verdict per tree", () => {
    const root = fixtureTree();
    const report = auditPartitionTree({ distDir: root, publicDir: root });
    expect(report.f1PrivatePaths.dist.findingCount).toBe(2);
    expect(report.f1PrivatePaths.pass).toBe(false);
    expect(report.f2ProhibitedEvidence.pass).toBe(true);
  });
});

describe("private partition pruning", () => {
  it("finds only directories literally named private", () => {
    const root = fixtureTree();
    mkdirSync(join(root, "data/privateer"), { recursive: true });
    writeFileSync(join(root, "data/privateer/keep.glb"), "keep");
    const found = findPrivatePartitionDirectories(join(root, "data")).map((path) => path.replaceAll("\\", "/"));
    expect(found).toHaveLength(2);
    expect(found.some((path) => path.endsWith("/privateer"))).toBe(false);
  });

  it("removes every private partition from a build output and reports what it removed", () => {
    const root = fixtureTree();
    const dry = prunePrivatePartitions(root, { dryRun: true });
    expect(dry.removedCount).toBe(2);
    expect(existsSync(join(root, "data/pkg/private"))).toBe(true);
    const result = prunePrivatePartitions(root);
    expect(result.removed.sort()).toEqual(["data/frozen/private", "data/pkg/private"]);
    expect(existsSync(join(root, "data/pkg/private"))).toBe(false);
    expect(existsSync(join(root, "data/frozen/private"))).toBe(false);
    // The public partition the canary actually references is untouched.
    expect(existsSync(join(root, "data/pkg/public/assets/a.glb"))).toBe(true);
    expect(scanTreeForPrivatePaths(root, "pruned").findings).toHaveLength(0);
  });

  it("is a no-op when no build output exists", () => {
    expect(prunePrivatePartitions(join(tmpdir(), "udt-no-dist-xyz")).removedCount).toBe(0);
  });
});

/**
 * The script deletes recursively, so its one steering argument is guarded. An
 * unguarded `--dist public` resolves to `public/` and would delete the
 * committed, immutable `public/data/<package>/private/**` release bytes.
 */
describe("--dist containment guard", () => {
  it("accepts only the repository's own build output", () => {
    const allowed = mkdtempSync(join(tmpdir(), "udt-dist-allowed-"));
    expect(resolveDistArgument(allowed, { defaultDistDir: allowed })).toBe(resolve(allowed));
    // No argument keeps the default target.
    expect(resolveDistArgument(undefined, { defaultDistDir: allowed })).toBe(allowed);
    for (const rejected of ["public", "data", ".", "..", join(allowed, "data"), dirname(allowed)]) {
      expect(() => resolveDistArgument(rejected, { defaultDistDir: allowed })).toThrow(/refuses --dist/);
    }
  });

  it("refuses a public/ target before anything is scanned or deleted", () => {
    // Stands in for the real public/ tree: a committed release package whose
    // private partition must survive any invocation of this script.
    const publicTree = mkdtempSync(join(tmpdir(), "udt-public-"));
    mkdirSync(join(publicTree, "data/manhattan-esb-block-reference-20260810/private/assets"), { recursive: true });
    const releaseByte = join(publicTree, "data/manhattan-esb-block-reference-20260810/private/assets/doitt.glb");
    writeFileSync(releaseByte, "immutable-release-bytes");
    const before = readFileSync(releaseByte, "utf8");
    const allowed = mkdtempSync(join(tmpdir(), "udt-dist-allowed-"));

    expect(() => runPrunePrivatePartitionsCli(["--dist", publicTree], { defaultDistDir: allowed })).toThrow(/refuses --dist/);
    // The refusal is the first thing that happens: the partition is still there,
    // byte for byte, and the audit still sees it.
    expect(existsSync(join(publicTree, "data/manhattan-esb-block-reference-20260810/private"))).toBe(true);
    expect(readFileSync(releaseByte, "utf8")).toBe(before);
    expect(scanTreeForPrivatePaths(publicTree, "public").findings).toHaveLength(1);

    // Same refusal with --dry-run: the guard does not depend on the mode.
    expect(() => runPrunePrivatePartitionsCli(["--dist", publicTree, "--dry-run"], { defaultDistDir: allowed })).toThrow(/refuses --dist/);
    expect(existsSync(releaseByte)).toBe(true);
  });
});
