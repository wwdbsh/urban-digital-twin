/**
 * Gates on the cross-wave public showcase candidate manifest.
 *
 * The manifest's whole value is that it is CLOSED and PINNED, so these tests
 * are about refusal and drift, not about happy paths: a seventh root, a private
 * root, a moved pin and a weakened exclusion must each fail here rather than in
 * a browser.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BLOCK835_V3_CANARY_APPROVAL } from "./block835-v3-canary-release.ts";
import { CENTRAL_UPPER_MANHATTAN_APPROVAL } from "./central-upper-manhattan-release.ts";
import { LOWER_MANHATTAN_APPROVAL } from "./lower-manhattan-release.ts";
import { MIDTOWN_CORE_V3_APPROVAL } from "./midtown-core-v3-release.ts";
import { NORTHERN_MANHATTAN_APPROVAL, NORTHERN_MANHATTAN_APPROVAL_NOTE } from "./northern-manhattan-release.ts";
import { SOUTHERN_REMAINDER_APPROVAL } from "./southern-remainder-release.ts";
import { EXTERIOR_DEFAULT_ACTIVATIONS } from "../runtime/exterior-default-activation.ts";
import {
  PUBLIC_SHOWCASE_ASSEMBLY_POSTURE,
  PUBLIC_SHOWCASE_BASE_PACKAGES,
  PUBLIC_SHOWCASE_BASE_PACKAGE_IDS,
  PUBLIC_SHOWCASE_DATA_URL_PREFIXES,
  PUBLIC_SHOWCASE_DIGEST_SHA256,
  PUBLIC_SHOWCASE_EXCLUDED_PRIVATE_ROOT_IDS,
  PUBLIC_SHOWCASE_PACKAGE_IDS,
  PUBLIC_SHOWCASE_PUBLIC_ROOT_IDS,
  PUBLIC_SHOWCASE_RESTATED_EXCLUSIONS,
  PUBLIC_SHOWCASE_STANDING_REFUSALS,
  PUBLIC_SHOWCASE_SUCCESSOR,
  PUBLIC_SHOWCASE_WAVES,
  PublicShowcaseRefusal,
  assertShowcasePackageId,
  assertShowcasePublicRootId,
  classifyShowcaseRequestPath,
  PUBLIC_SHOWCASE_BASE_URL_PREFIXES,
  PUBLIC_SHOWCASE_BROWSER_IMPLICIT_PATHS,
  computePublicShowcaseDigest,
  showcaseApprovalFingerprint,
  showcaseApprovalId,
  showcaseExclusions,
} from "./public-showcase-manifest.ts";

describe("the public showcase candidate is a closed set", () => {
  it("enumerates exactly the six promoted waves, in activation order", () => {
    const activated = EXTERIOR_DEFAULT_ACTIVATIONS.filter((record) => record.enabled).map((record) => record.releaseId);
    expect(PUBLIC_SHOWCASE_WAVES.map((wave) => wave.publicReleaseId)).toEqual(activated);
    expect(PUBLIC_SHOWCASE_WAVES).toHaveLength(6);
  });

  it("resolves each enumerated public root and returns its wave", () => {
    for (const wave of PUBLIC_SHOWCASE_WAVES) {
      expect(assertShowcasePublicRootId(wave.publicRootId)).toBe(wave);
      expect(assertShowcasePackageId(wave.packageId)).toBe(wave);
    }
  });

  /**
   * The refusal that matters most: a private root is not merely "unknown", and
   * saying so would understate what was asked for.
   */
  it("refuses every excluded private root BY NAME, with a private-specific code", () => {
    for (const rootId of PUBLIC_SHOWCASE_EXCLUDED_PRIVATE_ROOT_IDS) {
      expect(() => assertShowcasePublicRootId(rootId)).toThrow(PublicShowcaseRefusal);
      try {
        assertShowcasePublicRootId(rootId);
      } catch (error) {
        expect((error as PublicShowcaseRefusal).code).toBe("private-root-forbidden");
        expect((error as PublicShowcaseRefusal).message).toContain(rootId);
      }
    }
  });

  it("refuses a seventh root and an unenumerated package by name", () => {
    expect(() => assertShowcasePublicRootId("root:manhattan-seventh-wave-cells-20260813:public")).toThrow(/manhattan-seventh-wave-cells-20260813/u);
    expect(() => assertShowcasePackageId("manhattan-seventh-wave-cells-20260813")).toThrow(/not one of the 6/u);
    expect(() => assertShowcasePublicRootId("")).toThrow(PublicShowcaseRefusal);
    expect(() => assertShowcasePublicRootId(null)).toThrow(PublicShowcaseRefusal);
  });

  it("keeps the enumerated ids mutually consistent", () => {
    expect(new Set(PUBLIC_SHOWCASE_PUBLIC_ROOT_IDS).size).toBe(6);
    expect(new Set(PUBLIC_SHOWCASE_PACKAGE_IDS).size).toBe(6);
    for (const wave of PUBLIC_SHOWCASE_WAVES) {
      expect(wave.publicRootId).toBe(`root:${wave.publicReleaseId}:public`);
      expect(wave.privateRootId).toBe(`root:${wave.publicReleaseId}:private`);
      expect(wave.packageId).toBe(wave.publicReleaseId);
    }
    expect(PUBLIC_SHOWCASE_DATA_URL_PREFIXES).toEqual(PUBLIC_SHOWCASE_PACKAGE_IDS.map((id) => `/data/${id}/`));
  });
});

describe("the base packages the waves compose over are enumerated too", () => {
  /**
   * This set exists because the smoke run found it missing: a default session
   * requested all three of these and the first allowlist refused them. A
   * candidate that enumerated only the six waves would be an incomplete
   * description of what the showcase actually resolves.
   */
  it("classifies each base package as base payload, and nothing else", () => {
    expect(PUBLIC_SHOWCASE_BASE_PACKAGE_IDS).toEqual([
      "manhattan-citywide-20260804",
      "manhattan-civic-context-20260804",
      "real-wave-20260804",
    ]);
    for (const base of PUBLIC_SHOWCASE_BASE_PACKAGES) {
      const classified = classifyShowcaseRequestPath(`/data/${base.packageId}/manifest.json`);
      expect(classified.kind).toBe("base-payload");
      if (classified.kind === "base-payload") expect(classified.base).toBe(base);
      // Every base release carries its own instrument, and each excludes deployment.
      expect(base.deploymentExcluded).toBe(true);
    }
  });

  it("still refuses a fourth base package by name", () => {
    expect(() => classifyShowcaseRequestPath("/data/manhattan-some-other-base-20260901/manifest.json")).toThrow(/outside the enumerated public roots and base packages/u);
  });

  it("refuses a private path even under an enumerated base package", () => {
    expect(() => classifyShowcaseRequestPath("/data/manhattan-citywide-20260804/private/x.json")).toThrow(/private-partition path/u);
  });

  /**
   * B1. The manifest asserts an exclusion for each base package; this reads the
   * ACTUAL release manifests rather than trusting that assertion, because an
   * earlier draft claimed `deploymentExcluded: true` for a release that carries
   * no instrument at all. Two must carry the text; the third must NOT — and the
   * absence is asserted, so the day it gains an instrument this test says so.
   */
  it("backs each exclusion source against the release manifest it names", () => {
    const readApproval = (packageId: string): { exclusions?: string[] } | null => {
      const manifest = JSON.parse(new TextDecoder().decode(readFileSync(`public/data/${packageId}/manifest.json`))) as { approval?: { exclusions?: string[] } };
      return manifest.approval ?? null;
    };
    for (const base of PUBLIC_SHOWCASE_BASE_PACKAGES) {
      const approval = readApproval(base.packageId);
      if (base.deploymentExclusionSource === "release-approval-instrument") {
        expect(approval, `${base.packageId} claims an inherited instrument`).not.toBeNull();
        expect(approval!.exclusions).toContain("public deployment");
      } else {
        expect(base.deploymentExclusionSource).toBe("imposed-by-this-showcase-manifest");
        // The release carries NO approval. Nothing was inherited, and the
        // manifest must not imply otherwise.
        expect(approval).toBeNull();
        expect(base.deploymentExclusionBasis).toContain("carries NO `approval` key");
        expect(base.deploymentExclusionBasis).toContain("inherited from nothing");
      }
      expect(base.deploymentExcluded).toBe(true);
      expect(base.deploymentExclusionBasis).toContain(base.packageId);
    }
  });

  it("records exactly one imposed exclusion, and it is real-wave", () => {
    const imposed = PUBLIC_SHOWCASE_BASE_PACKAGES.filter((base) => base.deploymentExclusionSource === "imposed-by-this-showcase-manifest");
    expect(imposed.map((base) => base.packageId)).toEqual(["real-wave-20260804"]);
  });

  it("keeps base packages disjoint from wave packages", () => {
    for (const id of PUBLIC_SHOWCASE_BASE_PACKAGE_IDS) expect(PUBLIC_SHOWCASE_PACKAGE_IDS).not.toContain(id);
  });
});

describe("the rights instruments are carried by reference, never re-authored", () => {
  /**
   * Object identity, not text equality. A copy could be edited into something
   * more permissive without any test noticing; a reference cannot.
   */
  it("references the very approval object each release module exports", () => {
    const expected = [
      BLOCK835_V3_CANARY_APPROVAL,
      MIDTOWN_CORE_V3_APPROVAL,
      LOWER_MANHATTAN_APPROVAL,
      SOUTHERN_REMAINDER_APPROVAL,
      CENTRAL_UPPER_MANHATTAN_APPROVAL,
      NORTHERN_MANHATTAN_APPROVAL,
    ];
    PUBLIC_SHOWCASE_WAVES.forEach((wave, index) => {
      expect(wave.rights.instrument).toBe(expected[index]);
      expect(showcaseApprovalId(wave)).toBe(expected[index]!.id);
      expect(showcaseApprovalFingerprint(wave)).toBe(expected[index]!.fingerprintSha256);
      expect(showcaseExclusions(wave)).toBe(expected[index]!.exclusions);
    });
  });

  it("preserves the per-wave disagreement instead of normalizing it", () => {
    const textureFree = PUBLIC_SHOWCASE_WAVES.filter((wave) => wave.textureAdmission === "texture-free");
    const textured = PUBLIC_SHOWCASE_WAVES.filter((wave) => wave.textureAdmission === "procedural-replay");
    expect(textureFree).toHaveLength(2);
    expect(textured).toHaveLength(4);
    // The two texture-free waves say "public deployment"; the four textured
    // ones say "public internet deployment". Normalizing them would be an edit
    // to an approved instrument.
    for (const wave of textureFree) {
      expect(showcaseExclusions(wave)).toContain("public deployment");
      expect(wave.rights.redistribution).toBe("generated-geometry-covered");
    }
    for (const wave of textured) {
      expect(showcaseExclusions(wave)).toContain("public internet deployment");
      expect(wave.rights.redistribution).toBe("tiles-withheld");
      expect(showcaseExclusions(wave)).toContain(
        "redistribution of the procedural facade detail tiles, or of any package carrying them, whether or not the underlying geometry is separately redistributable",
      );
    }
  });

  it("excludes public deployment in EVERY wave, in that wave's own wording", () => {
    for (const wave of PUBLIC_SHOWCASE_WAVES) {
      expect(showcaseExclusions(wave).some((exclusion) => exclusion === "public deployment" || exclusion === "public internet deployment")).toBe(true);
      expect(showcaseExclusions(wave)).toContain("private-audience bytes in any browser-reachable root");
      expect(showcaseExclusions(wave)).toContain("runtime external network requests");
    }
  });

  it("restates the union of exclusions without dropping any wave's", () => {
    for (const wave of PUBLIC_SHOWCASE_WAVES) {
      for (const exclusion of showcaseExclusions(wave)) expect(PUBLIC_SHOWCASE_RESTATED_EXCLUSIONS).toContain(exclusion);
    }
  });

  /**
   * The clause this whole deliverable is answerable to. The quotation in
   * `PUBLIC_SHOWCASE_STANDING_REFUSALS` is checked against the instrument's own
   * note, so a paraphrase cannot drift in.
   */
  it("quotes the anti-assembly clause verbatim from the instrument that wrote it", () => {
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain(PUBLIC_SHOWCASE_STANDING_REFUSALS.crossWaveAssembly);
    expect(PUBLIC_SHOWCASE_ASSEMBLY_POSTURE).toContain("inventory of six separately approved local releases");
    expect(PUBLIC_SHOWCASE_ASSEMBLY_POSTURE).toContain("not a new redistributable whole");
  });

  it("states no fidelity claim that the instruments refuse", () => {
    for (const wave of PUBLIC_SHOWCASE_WAVES) {
      expect(wave.fidelity.geometryTier).toBe("generated");
      expect(wave.attribution).toContain("NYC Office of Technology and Innovation Building Footprints (jh45-qr5r)");
      expect(wave.attribution).toContain("modified data");
      expect(wave.fidelity.uncertainty).toContain("does not claim");
    }
    for (const wave of PUBLIC_SHOWCASE_WAVES.filter((entry) => entry.textureAdmission === "texture-free")) {
      expect(wave.fidelity.designedAppearance).toContain("no texture of any kind");
    }
    for (const wave of PUBLIC_SHOWCASE_WAVES.filter((entry) => entry.textureAdmission === "procedural-replay")) {
      expect(wave.fidelity.designedAppearance).toContain("No pixel of any photograph");
    }
  });
});

describe("the candidate digest pins the enumeration", () => {
  it("matches the pinned digest with no successor recorded", () => {
    expect(computePublicShowcaseDigest()).toBe(PUBLIC_SHOWCASE_DIGEST_SHA256);
    expect(PUBLIC_SHOWCASE_SUCCESSOR).toBeNull();
  });

  /**
   * Drift protection. Each mutation below is one a careless edit could make;
   * every one of them must move the digest, so the pin cannot silently survive.
   */
  it("moves when any pinned field of any wave moves", () => {
    const baseline = computePublicShowcaseDigest();
    const mutations = [
      { publicRootChecksumSha256: "a".repeat(64) },
      { artifactChecksumDigestSha256: "b".repeat(64) },
      { artifactCount: 999 },
      { privateRootChecksumSha256: "c".repeat(64) },
      { textureAdmission: "texture-free" as const },
      { publicRootId: "root:something-else:public" },
    ];
    for (const mutation of mutations) {
      const mutated = PUBLIC_SHOWCASE_WAVES.map((wave, index) => (index === 5 ? { ...wave, ...mutation } : wave));
      expect(computePublicShowcaseDigest(mutated)).not.toBe(baseline);
    }
  });

  it("moves when an exclusion is weakened", () => {
    const baseline = computePublicShowcaseDigest();
    const weakened = PUBLIC_SHOWCASE_WAVES.map((wave, index) =>
      index === 5
        ? { ...wave, rights: { ...wave.rights, instrument: { ...wave.rights.instrument, exclusions: wave.rights.instrument.exclusions.filter((exclusion) => exclusion !== "public internet deployment") } } }
        : wave,
    );
    expect(computePublicShowcaseDigest(weakened)).not.toBe(baseline);
  });

  it("moves when a base package's deployment-exclusion SOURCE changes", () => {
    const baseline = computePublicShowcaseDigest();
    const relabelled = PUBLIC_SHOWCASE_BASE_PACKAGES.map((base) =>
      base.packageId === "real-wave-20260804" ? { ...base, deploymentExclusionSource: "release-approval-instrument" as const } : base,
    );
    expect(computePublicShowcaseDigest(PUBLIC_SHOWCASE_WAVES, relabelled)).not.toBe(baseline);
  });

  it("moves when a base package is added, dropped or renamed", () => {
    const baseline = computePublicShowcaseDigest();
    expect(computePublicShowcaseDigest(PUBLIC_SHOWCASE_WAVES, PUBLIC_SHOWCASE_BASE_PACKAGES.slice(0, 2))).not.toBe(baseline);
    expect(computePublicShowcaseDigest(PUBLIC_SHOWCASE_WAVES, [...PUBLIC_SHOWCASE_BASE_PACKAGES, { packageId: "manhattan-smuggled-base", role: "x", declaredByWaveBaseCompatibility: false, deploymentExcluded: true, deploymentExclusionSource: "imposed-by-this-showcase-manifest" as const, deploymentExclusionBasis: "x", publicPathAnchors: ["manifest.json"] }])).not.toBe(baseline);
  });

  it("moves when a wave is dropped or reordered", () => {
    const baseline = computePublicShowcaseDigest();
    expect(computePublicShowcaseDigest(PUBLIC_SHOWCASE_WAVES.slice(0, 5))).not.toBe(baseline);
    expect(computePublicShowcaseDigest([...PUBLIC_SHOWCASE_WAVES].reverse())).not.toBe(baseline);
  });
});

describe("request classification keeps a session inside the candidate", () => {
  it("accepts each wave's entry points and public partition", () => {
    for (const wave of PUBLIC_SHOWCASE_WAVES) {
      for (const name of ["index.json", "release-graph.json", "assemblies.json"]) {
        const classified = classifyShowcaseRequestPath(`/data/${wave.packageId}/${name}`);
        expect(classified.kind).toBe("wave-payload");
      }
      const asset = classifyShowcaseRequestPath(`/data/${wave.packageId}/public/assets/doitt-1__lod_0.glb`);
      expect(asset.kind).toBe("wave-payload");
      if (asset.kind === "wave-payload") expect(asset.wave).toBe(wave);
    }
  });

  it("accepts the app shell and the vendored Cesium runtime", () => {
    expect(classifyShowcaseRequestPath("/").kind).toBe("app-shell");
    expect(classifyShowcaseRequestPath("/index.html").kind).toBe("app-shell");
    expect(classifyShowcaseRequestPath("/assets/index-abc123.js").kind).toBe("app-shell");
    expect(classifyShowcaseRequestPath("/cesiumStatic/Workers/x.js").kind).toBe("app-shell");
  });

  /** The refusals. Each is a path a leak would actually take. */
  it("refuses a private partition path, an unenumerated package, and a private-root escape", () => {
    expect(() => classifyShowcaseRequestPath("/data/manhattan-northern-manhattan-cells-20260812-p1/private/ownership-ledger/x.json")).toThrow(/private-partition path/u);
    expect(() => classifyShowcaseRequestPath("/data/manhattan-esb-block-reference-20260811-v3e/private/tiles/tileset.json")).toThrow(/private-partition path/u);
    expect(() => classifyShowcaseRequestPath("/data/manhattan-esb-block-reference-20260811-v3e/manifest.json")).toThrow(/outside the enumerated public roots/u);
    expect(() => classifyShowcaseRequestPath("/data/manhattan-northern-manhattan-cells-20260812-p1/derivation.json")).toThrow(/neither a declared package entry point/u);
    expect(() => classifyShowcaseRequestPath("/somewhere-else/x.json")).toThrow(/neither app shell nor enumerated wave payload/u);
    expect(() => classifyShowcaseRequestPath("https://example.com/x.json")).toThrow(/rooted same-origin path/u);
  });
});

/**
 * T029 repair of the T023 reproducibility finding.
 *
 * The committed `six-wave-default` smoke journey passed on the browser profile
 * it was captured with and failed on every fresh one, because a fresh Chrome
 * asks for `/favicon.ico` and the classifier had no category for it. These
 * tests pin the repair AND the two ways it could have been made too wide.
 */
describe("browser-implicit requests are classified, not exempted", () => {
  it("classifies the paths a browser issues on its own", () => {
    // Pre-fix this threw `request-outside-candidate`, which is exactly what made
    // the committed journey depend on browser-profile state.
    for (const path of PUBLIC_SHOWCASE_BROWSER_IMPLICIT_PATHS) {
      expect(classifyShowcaseRequestPath(path)).toEqual({ kind: "browser-implicit", path });
    }
    expect(PUBLIC_SHOWCASE_BROWSER_IMPLICIT_PATHS).toContain("/favicon.ico");
  });

  it("matches EXACTLY, so nothing is admitted by resembling one", () => {
    for (const near of ["/favicon.ico.map", "/favicon.icon", "/x/favicon.ico", "/favicon.ico/", "/FAVICON.ICO"]) {
      expect(() => classifyShowcaseRequestPath(near)).toThrow(/neither app shell nor enumerated wave payload|private-partition/u);
    }
  });

  it("cannot shadow a payload path that happens to end in the same name", () => {
    const wave = PUBLIC_SHOWCASE_WAVES[0]!;
    const classified = classifyShowcaseRequestPath(`/data/${wave.packageId}/public/favicon.ico`);
    expect(classified.kind).toBe("wave-payload");
  });

  it("still refuses a real unclassified request", () => {
    // The repair must not turn the classifier into a pass-through. A foreign
    // same-origin path is the thing the journey exists to catch.
    expect(() => classifyShowcaseRequestPath("/telemetry/collect")).toThrow(/neither app shell nor enumerated wave payload/u);
    expect(() => classifyShowcaseRequestPath("/data/manhattan-smuggled-20260901/manifest.json")).toThrow(/outside the enumerated public roots and base packages/u);
  });
});

describe("base-package requests are anchored the same way wave requests are", () => {
  it("derives the base prefixes from the package list rather than rebuilding them", () => {
    expect(PUBLIC_SHOWCASE_BASE_URL_PREFIXES).toEqual(PUBLIC_SHOWCASE_BASE_PACKAGES.map((entry) => `/data/${entry.packageId}/`));
    for (const prefix of PUBLIC_SHOWCASE_BASE_URL_PREFIXES) expect(prefix.endsWith("/")).toBe(true);
  });

  it("admits the LITERAL entry points and directories each base package really serves", () => {
    // Written out rather than derived from `publicPathAnchors`, because a test
    // that loops over the constant it is checking passes whatever the constant
    // says — including after someone adds `""` or `"/"` to it.
    const admitted = [
      "/data/manhattan-citywide-20260804/manifest.json",
      "/data/manhattan-citywide-20260804/manifest.sha256",
      "/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4824-4482-000.json",
      "/data/manhattan-citywide-20260804/details/shard-000.json",
      "/data/manhattan-citywide-20260804/search/index.json",
      "/data/manhattan-civic-context-20260804/manifest.json",
      "/data/manhattan-civic-context-20260804/geometry/parks.json",
      "/data/real-wave-20260804/manifest.json",
      "/data/real-wave-20260804/buildings.json",
      "/data/real-wave-20260804/restaurants.json",
    ];
    for (const path of admitted) {
      expect({ path, kind: classifyShowcaseRequestPath(path).kind }).toEqual({ path, kind: "base-payload" });
    }
  });

  it("puts the anchors inside the candidate digest, so widening one is visible", () => {
    const baseline = computePublicShowcaseDigest();
    const widened = PUBLIC_SHOWCASE_BASE_PACKAGES.map((entry, index) => (
      index === 0 ? { ...entry, publicPathAnchors: [...entry.publicPathAnchors, "scratch/"] } : entry
    ));
    expect(computePublicShowcaseDigest(PUBLIC_SHOWCASE_WAVES, widened)).not.toBe(baseline);
  });

  it("refuses a base-package path outside every declared anchor", () => {
    // Pre-fix this CLASSIFIED: the base branch was admitted on the package
    // prefix alone, with no second anchor, while the wave branch had one.
    expect(() => classifyShowcaseRequestPath("/data/manhattan-citywide-20260804/scratch/notes.json"))
      .toThrow(/neither a declared entry point nor under a declared public directory/u);
    expect(() => classifyShowcaseRequestPath("/data/real-wave-20260804/geometry/x.json"))
      .toThrow(/neither a declared entry point nor under a declared public directory/u);
  });

  it("refuses a bare directory prefix with nothing after it", () => {
    expect(() => classifyShowcaseRequestPath("/data/manhattan-citywide-20260804/geometry/"))
      .toThrow(/neither a declared entry point nor under a declared public directory/u);
  });
});
