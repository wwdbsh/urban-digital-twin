import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROHIBITED_EVIDENCE_TOKENS,
  auditPartitionTree,
  classifyPrivateFindings,
  matchProhibitedTokens,
  privatePathSegments,
  scanTreeForPrivatePaths,
  scanTreeForProhibitedEvidence,
} from "./audit-partition-tree.mjs";
import { findPrivatePartitionDirectories, prunePrivatePartitions } from "./prune-private-partitions.mjs";
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
