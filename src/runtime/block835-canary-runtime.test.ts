import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";
import { EXTERIOR_RENDER_PROFILES } from "./exterior-render-profiles";
import { createExteriorCellRuntime } from "./exterior-cell-runtime";

/**
 * Loads the COMMITTED canary release bytes through the real runtime.
 *
 * The emitter and graph tests only proved the bytes were internally consistent;
 * nothing drove them through `ExteriorCellRuntime`. That gap let a cell-release
 * pin mismatch ship: the public assembly carried the private package's own
 * `cellRelease` pin, so `verifyCellRelease` rejected it with
 * `assembly-pin-mismatch` and the runtime silently fell back to pinned-base,
 * rendering no geometry. This test fails on those pre-fix bytes.
 */
const ROOT = "public/data/manhattan-exterior-cells-20260811/";
const CELL_ID = "cell:manhattan:block-835";

function readJson(fileName: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(`${ROOT}${fileName}`))));
}

function makeRuntime() {
  const buildingIds = new Set([...BLOCK_835_DOITT_IDS].map((id) => `doitt:${id}`));
  return createExteriorCellRuntime(
    { index: readJson("index.json"), graph: readJson("release-graph.json"), assemblies: readJson("assemblies.json") },
    { kind: "default" },
    {
      fetchArtifact: async (relativeRef: string) => new Uint8Array(readFileSync(`${ROOT}${relativeRef}`)),
      baseIdentity: { releaseId: "manhattan-citywide-20260804", has: (featureId: string) => buildingIds.has(featureId) },
    },
  );
}

describe("Block 835 canary release through the exterior cell runtime", () => {
  it("resolves the default head from the committed index", () => {
    const { head } = makeRuntime();
    expect(head.origin).toBe("default");
    // This release publishes no canary heads, so the default head must resolve
    // cleanly with no downgrade notice.
    expect(head.notice).toBeNull();
    expect(head.pin.snapshotId.length).toBeGreaterThan(0);
  });

  for (const profile of EXTERIOR_RENDER_PROFILES) {
    it(`verifies the cell release and renders all 14 buildings for the ${profile} profile`, async () => {
      const { runtime } = makeRuntime();
      const outcome = await runtime.loadCell(CELL_ID, profile, 120);

      // The regression: a pin mismatch downgrades to the base-massing fallback
      // with a notice and no geometry instead of rendering the cell.
      expect(outcome.kind === "rendered" ? null : { code: outcome.code, message: outcome.message }).toBeNull();
      if (outcome.kind !== "rendered") return;
      expect(outcome.representation).toBe("head");
      expect(outcome.notice).toBeNull();
      expect(outcome.assets).toHaveLength(14);

      const rendered = [...outcome.assets].map((asset) => asset.canonicalFeatureId).sort();
      expect(rendered).toEqual([...BLOCK_835_DOITT_IDS].map((id) => `doitt:${id}`).sort());
      for (const asset of outcome.assets) {
        // Verified bytes are handed back, not a path to refetch.
        expect(asset.bytes.byteLength).toBeGreaterThan(0);
        // All V2 components are generated; provenance must survive to render.
        expect(asset.provenance.truthTiers).toEqual(["generated"]);
        expect(asset.provenance.evidenceShardId).toBe(`evidence-shard:manhattan-esb-block-reference-20260811:${asset.canonicalFeatureId}`);
        expect(asset.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
      }
    });
  }

  it("binds the public assembly to this graph's cell release, not the private package", () => {
    const assemblies = readJson("assemblies.json") as Array<{ cells: Array<{ cellRelease: { id: string; checksumSha256: string } }> }>;
    const graph = readJson("release-graph.json") as {
      cellReleases: Array<{ cellReleaseId: string }>;
      roots: Array<{ audience: string; artifacts: Array<{ kind: string; logicalId: string; checksumSha256: string }> }>;
    };
    const declared = graph.roots.find((root) => root.audience === "public")!.artifacts.find((artifact) => artifact.kind === "cell-release")!;
    const pin = assemblies[0]!.cells[0]!.cellRelease;
    expect(pin.id).toBe(graph.cellReleases[0]!.cellReleaseId);
    expect(pin.id).toBe(declared.logicalId);
    expect(pin.checksumSha256).toBe(declared.checksumSha256);
    expect(pin.id).not.toBe("manhattan-esb-block-reference-20260811");
  });
});
