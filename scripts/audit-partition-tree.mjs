#!/usr/bin/env node
/* global console, process */
/**
 * Partition audit over the browser-reachable file tree, read-only with respect
 * to the bytes it audits.
 *
 * Two questions, both answered by scanning bytes rather than by reading a
 * manifest that claims an answer:
 *
 *  F1. Is any `private/` path browser-resolvable? Everything under Vite's
 *      `public/` directory is copied verbatim into `dist/`, so a `private/`
 *      subtree there is fetchable by path from a production build even when no
 *      manifest references it. The canary's own anti-leak invariant is that its
 *      release graph declares exactly one private artifact and ships no
 *      `private/` directory at all; this audit checks the *tree*, not the graph.
 *
 *  F2. Does any browser-reachable JSON carry a prohibited-evidence token? The
 *      vocabulary is the closed disallowed list in
 *      `src/domain/exterior-evidence-intake.ts` plus the platform names it
 *      stands for. A hit is not proof of a leak on its own — it is a finding
 *      that must be explained — so every hit is reported with its file and the
 *      matched token.
 *
 * The script never writes to, moves, or deletes a scanned file. It does write
 * one file of its own, and only one: the JSON report at `--json <out>`, which
 * is outside the audited trees.
 *
 * Usage:
 *   node scripts/audit-partition-tree.mjs [--dist <dir>] [--public <dir>] [--json <out>]
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Closed prohibited-evidence vocabulary. It mirrors
 * `DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS` and adds the bare platform names
 * those classifications stand for, so an unclassified free-text mention is
 * still caught. Kept as lowercase substrings; matching is case-insensitive.
 */
export const PROHIBITED_EVIDENCE_TOKENS = [
  "google-maps",
  "googlemaps",
  "google maps",
  "street-view",
  "streetview",
  "street view",
  "unlicensed-web-photo",
  "unlicensed web photo",
  "platform-restricted",
];

/**
 * Tokens whose presence is an *approved* negative declaration rather than a
 * finding: a document that says "no Google Street View imagery contributed" is
 * evidence of compliance. Any such allowance must be explicit and narrow, so
 * this list is empty until a specific document earns an entry.
 */
export const PROHIBITED_EVIDENCE_ALLOWANCES = [];

/**
 * Findings are classified, never suppressed. The Goal criterion is about what
 * supplies source pixels, geometry, textures, training inputs or acceptance
 * evidence — that is a question about **release data**. A token inside a
 * third-party rendering library is a different fact: it means the shipped
 * bundle contains vendor code that *could* address a restricted service, not
 * that any restricted material contributed to the release. Both are reported;
 * only the first can fail the release-data verdict.
 */
export const VENDOR_PATH_PREFIXES = ["cesiumStatic/", "assets/index-"];

export function classifyEvidenceFinding(relativePath) {
  const normalized = relativePath.split(sep).join("/");
  if (VENDOR_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "vendor-runtime";
  return normalized.startsWith("data/") ? "release-data" : "other";
}

const TEXT_EXTENSIONS = new Set([".json", ".txt", ".md", ".csv", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".html", ".css", ".map", ".svg", ".geojson"]);

function* walk(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) yield full;
    }
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A path is browser-resolvable from a static root if it sits under that root. */
export function privatePathSegments(relativePath) {
  return relativePath.split(sep).filter((segment) => segment === "private");
}

export function scanTreeForPrivatePaths(root, label) {
  if (!existsSync(root)) return { label, root, scanned: 0, findings: [], present: false };
  const findings = [];
  let scanned = 0;
  for (const file of walk(root)) {
    scanned += 1;
    const rel = relative(root, file);
    if (privatePathSegments(rel).length === 0) continue;
    findings.push({ path: rel, bytes: statSync(file).size, sha256: sha256File(file) });
  }
  findings.sort((left, right) => left.path.localeCompare(right.path));
  return { label, root, scanned, findings, present: true };
}

export function matchProhibitedTokens(text) {
  const lower = text.toLowerCase();
  return PROHIBITED_EVIDENCE_TOKENS.filter((token) => lower.includes(token));
}

export function scanTreeForProhibitedEvidence(root, label) {
  if (!existsSync(root)) return { label, root, scanned: 0, findings: [], present: false };
  const findings = [];
  let scanned = 0;
  for (const file of walk(root)) {
    const rel = relative(root, file);
    const dot = rel.lastIndexOf(".");
    const extension = dot >= 0 ? rel.slice(dot) : "";
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    scanned += 1;
    if (PROHIBITED_EVIDENCE_ALLOWANCES.includes(rel)) continue;
    const matched = matchProhibitedTokens(readFileSync(file, "utf8"));
    if (matched.length) findings.push({ path: rel, tokens: matched, sha256: sha256File(file), classification: classifyEvidenceFinding(rel) });
  }
  findings.sort((left, right) => left.path.localeCompare(right.path));
  return { label, root, scanned, findings, present: true };
}

/**
 * Group duplicate private-path bytes against their public counterparts. A
 * private file whose bytes are byte-identical to a public file in the same
 * release is a **partition/path violation** — a path that should not resolve —
 * and not a disclosure of otherwise-unavailable content. The distinction
 * changes the severity, so it is computed rather than asserted.
 */
export function classifyPrivateFindings(root, findings) {
  const publicHashes = new Map();
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (privatePathSegments(rel).length > 0) continue;
    const dot = rel.lastIndexOf("/");
    publicHashes.set(sha256File(file), rel);
    void dot;
  }
  return findings.map((finding) => {
    const duplicateOf = publicHashes.get(finding.sha256) ?? null;
    return { ...finding, duplicateOfPublicPath: duplicateOf, classification: duplicateOf ? "duplicate-of-public-byte" : "private-only-byte" };
  });
}

export function auditPartitionTree({ distDir, publicDir }) {
  const dist = scanTreeForPrivatePaths(distDir, "dist");
  const publicTree = scanTreeForPrivatePaths(publicDir, "public");
  const distEvidence = scanTreeForProhibitedEvidence(distDir, "dist");
  const publicEvidence = scanTreeForProhibitedEvidence(publicDir, "public");
  const classifiedDist = dist.present ? classifyPrivateFindings(distDir, dist.findings) : [];
  const classifiedPublic = publicTree.present ? classifyPrivateFindings(publicDir, publicTree.findings) : [];
  return {
    schemaVersion: "1.0",
    auditId: "block835-canary-partition-tree-audit",
    generatedAt: new Date().toISOString(),
    f1PrivatePaths: {
      question: "Is any private/ path browser-resolvable from a static root?",
      dist: { ...dist, findings: classifiedDist, findingCount: classifiedDist.length },
      public: { ...publicTree, findings: classifiedPublic, findingCount: classifiedPublic.length },
      // dist/ is what a browser can actually fetch. public/ is the source tree
      // that feeds it, reported so the mechanism is visible even when dist/ is
      // clean because a build-output correction removed the paths.
      pass: dist.present ? classifiedDist.length === 0 : null,
    },
    f2ProhibitedEvidence: {
      question: "Does any browser-reachable text carry a prohibited-evidence token?",
      vocabulary: PROHIBITED_EVIDENCE_TOKENS,
      dist: { ...distEvidence, findingCount: distEvidence.findings.length },
      public: { ...publicEvidence, findingCount: publicEvidence.findings.length },
      // The criterion verdict: zero prohibited tokens in browser-reachable
      // release data. Vendor-runtime matches are reported separately because
      // they are a different fact and must be explained, not hidden.
      releaseDataFindings: [...distEvidence.findings, ...publicEvidence.findings].filter((finding) => finding.classification === "release-data"),
      vendorRuntimeFindings: [...distEvidence.findings, ...publicEvidence.findings].filter((finding) => finding.classification === "vendor-runtime"),
      pass: distEvidence.present ? distEvidence.findings.filter((finding) => finding.classification === "release-data").length === 0 : null,
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? resolve(args[index + 1]) : fallback;
  };
  const distDir = value("--dist", join(repoRoot, "dist"));
  const publicDir = value("--public", join(repoRoot, "public"));
  const report = auditPartitionTree({ distDir, publicDir });
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0 && args[jsonIndex + 1]) {
    const out = resolve(args[jsonIndex + 1]);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${out}`);
  }
  const f1 = report.f1PrivatePaths;
  const f2 = report.f2ProhibitedEvidence;
  console.log(`F1 private paths — dist: ${f1.dist.present ? `${f1.dist.findingCount} finding(s) over ${f1.dist.scanned} files` : "dist/ absent"}; public: ${f1.public.findingCount} finding(s) over ${f1.public.scanned} files`);
  for (const finding of f1.dist.findings.slice(0, 10)) console.log(`  dist  ${finding.path} [${finding.classification}]`);
  for (const finding of f1.public.findings.slice(0, 10)) console.log(`  public ${finding.path} [${finding.classification}]`);
  if (f1.public.findingCount > 10) console.log(`  … ${f1.public.findingCount - 10} more public finding(s)`);
  console.log(`F2 prohibited evidence — dist: ${f2.dist.present ? `${f2.dist.findingCount} finding(s) over ${f2.dist.scanned} text files` : "dist/ absent"}; public: ${f2.public.findingCount} finding(s) over ${f2.public.scanned} text files`);
  for (const finding of [...f2.dist.findings, ...f2.public.findings].slice(0, 20)) console.log(`  [${finding.classification}] ${finding.path} :: ${finding.tokens.join(", ")}`);
  console.log(`F2 release-data findings: ${f2.releaseDataFindings.length} (the criterion verdict); vendor-runtime findings: ${f2.vendorRuntimeFindings.length}`);
  const failed = f1.pass === false || f2.pass === false;
  console.log(failed ? "AUDIT: findings present" : "AUDIT: clean");
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
