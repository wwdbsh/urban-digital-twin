import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MIDTOWN_CORE_OUTPUT_DIRECTORY } from "../release/midtown-core-release.ts";
import { EXTERIOR_RENDER_PROFILES } from "./exterior-render-profiles.ts";
import { createExteriorCellRuntime, ExteriorRuntimeError } from "./exterior-cell-runtime.ts";

/**
 * Drives the EMITTED midtown-core canary bytes through the real
 * `ExteriorCellRuntime`.
 *
 * The release-graph test proves the bytes are internally consistent; only this
 * one proves the runtime's bounded-availability contract over them: 3 cells
 * render from verified bytes, 146 cells resolve as `not-shipped` before any
 * fetch, and a genuine artifact failure still degrades loudly through the
 * pinned-base fallback instead of being absorbed into the quiet path.
 *
 * The payload is intentionally untracked (the citywide precedent), so a fresh
 * clone has nothing to drive. That case states why it is skipped rather than
 * passing silently.
 */
const ROOT = `${MIDTOWN_CORE_OUTPUT_DIRECTORY}/`;
const PAYLOAD_PRESENT = existsSync(`${ROOT}release-graph.json`);
const PAYLOAD_SKIP_NOTE =
  `The midtown-core payload ${ROOT} is absent, so the runtime gates were skipped. It is intentionally `
  + "untracked; `node scripts/midtown-core-cli.mjs graph` rebuilds it and "
  + "`data/midtown-core-20260811/payload-inventory.json` carries the committed checksums.";

const RENDERABLE_CELL_COUNT = 3;
const AVAILABLE_BUILDING_COUNT = 160;
const OWNED_CELL_COUNT = 149;

function readJson(fileName: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(`${ROOT}${fileName}`))));
}

interface Harness {
  runtime: ReturnType<typeof createExteriorCellRuntime>["runtime"];
  head: ReturnType<typeof createExteriorCellRuntime>["head"];
  requested: string[];
}

function makeRuntime(options?: { failRefs?: (relativeRef: string) => boolean; unknownBase?: boolean }): Harness {
  const assemblies = readJson("assemblies.json") as Array<{ assets: { canonicalFeatureId: string }[] }>;
  const memberIds = new Set(assemblies.flatMap((assembly) => assembly.assets.map((asset) => asset.canonicalFeatureId)));
  const requested: string[] = [];
  const created = createExteriorCellRuntime(
    { index: readJson("index.json"), graph: readJson("release-graph.json"), assemblies },
    { kind: "default" },
    {
      fetchArtifact: async (relativeRef: string) => {
        requested.push(relativeRef);
        if (options?.failRefs?.(relativeRef)) throw new ExteriorRuntimeError("request-failed", `Injected local read failure for ${relativeRef}.`, relativeRef);
        return new Uint8Array(readFileSync(`${ROOT}${relativeRef}`));
      },
      baseIdentity: {
        releaseId: "manhattan-citywide-20260804",
        has: (featureId: string) => (options?.unknownBase === true ? false : memberIds.has(featureId)),
      },
    },
  );
  return { runtime: created.runtime, head: created.head, requested };
}

describe("midtown-core canary payload availability", () => {
  it("states why the runtime gates are skipped when the untracked payload is absent", () => {
    if (PAYLOAD_PRESENT) {
      expect(existsSync(`${ROOT}index.json`)).toBe(true);
      return;
    }
    expect(PAYLOAD_SKIP_NOTE).toContain("midtown-core-cli.mjs graph");
    expect(PAYLOAD_SKIP_NOTE).toContain("payload-inventory.json");
  });
});

describe.skipIf(!PAYLOAD_PRESENT)("midtown-core canary release through the exterior cell runtime", () => {
  it("resolves the operator-pinned default head with no downgrade notice", () => {
    const { head, runtime } = makeRuntime();
    expect(head.origin).toBe("default");
    expect(head.notice).toBeNull();
    expect(runtime.cellIds()).toHaveLength(OWNED_CELL_COUNT);
    expect(runtime.compatibleWith("manhattan-citywide-20260804")).toBe(true);
    expect(runtime.compatibleWith("some-other-release")).toBe(false);
  });

  for (const profile of EXTERIOR_RENDER_PROFILES) {
    it(`renders exactly the materialized cells and leaves the rest unshipped for the ${profile} profile`, async () => {
      const { runtime, requested } = makeRuntime();
      const outcomes = [];
      for (const cellId of runtime.cellIds()) outcomes.push(await runtime.loadCell(cellId, profile, 900));

      const rendered = outcomes.filter((outcome) => outcome.kind === "rendered");
      const notShipped = outcomes.filter((outcome) => outcome.kind === "not-shipped");
      const other = outcomes.filter((outcome) => outcome.kind !== "rendered" && outcome.kind !== "not-shipped");
      // A deliberately unshipped cell must never be reported as a failure.
      expect(other).toEqual([]);
      expect(rendered).toHaveLength(RENDERABLE_CELL_COUNT);
      expect(notShipped).toHaveLength(OWNED_CELL_COUNT - RENDERABLE_CELL_COUNT);

      const assets = rendered.flatMap((outcome) => (outcome.kind === "rendered" ? outcome.assets : []));
      expect(assets).toHaveLength(AVAILABLE_BUILDING_COUNT);
      for (const asset of assets) {
        // Verified bytes are handed back, not a path to refetch.
        expect(asset.bytes.byteLength).toBeGreaterThan(0);
        expect(asset.provenance.truthTiers).toEqual(["generated"]);
        expect(asset.provenance.uncertainty.length).toBeGreaterThan(0);
        expect(asset.provenance.sourceDates.capturedAt).not.toBeNull();
        expect(asset.provenance.predecessor).toBeNull();
      }

      // Bounded availability costs nothing: exactly one request per rendered
      // asset, and not one byte for the 146 unshipped cells.
      expect(requested).toHaveLength(AVAILABLE_BUILDING_COUNT);
      const metrics = runtime.getMetrics();
      expect(metrics.notShippedCellCount).toBe(OWNED_CELL_COUNT - RENDERABLE_CELL_COUNT);
      expect(metrics.failedCellCount).toBe(0);
      expect(metrics.fallbackCellCount).toBe(0);
      expect(metrics.failedArtifactCount).toBe(0);
      expect(metrics.loadedArtifactCount).toBe(AVAILABLE_BUILDING_COUNT);
      // One shipped LOD keeps the whole cycle inside the 256-entry cache ceiling.
      expect(metrics.cacheEntries).toBe(AVAILABLE_BUILDING_COUNT);
      expect(metrics.cacheEntries).toBeLessThanOrEqual(metrics.maxCacheEntries);
      expect(metrics.cacheEvictions).toBe(0);
      expect(metrics.cachedBytes).toBeLessThanOrEqual(metrics.maxCachedBytes);
    }, 60_000);
  }

  it("decides an unshipped cell before any fetch and names it as bounded availability, not failure", async () => {
    const { runtime, requested } = makeRuntime();
    const unshipped = runtime.cellIds().filter((cellId) => !cellId.includes("-000001-") && !cellId.includes("-000002-") && !cellId.includes("-000003-"));
    const outcome = await runtime.loadCell(unshipped[0]!, "exploration", 900);
    expect(outcome.kind).toBe("not-shipped");
    if (outcome.kind !== "not-shipped") return;
    expect(outcome.unavailableBuildingCount).toBeGreaterThan(0);
    expect(outcome.notice).toContain("ships no exterior geometry");
    expect(outcome.notice).toContain("no substitute was selected");
    expect(requested).toEqual([]);
    expect(runtime.getMetrics().requestedArtifactCount).toBe(0);
    expect(runtime.getMetrics().cacheEntries).toBe(0);
  });

  it("keeps a genuine artifact failure loud and distinct from an unshipped cell", async () => {
    const { runtime } = makeRuntime({ failRefs: (relativeRef) => relativeRef.endsWith(".glb") });
    const renderableCellId = runtime.cellIds().find((cellId) => cellId.includes("-000002-"))!;
    const failed = await runtime.loadCell(renderableCellId, "exploration", 900);
    // The pinned fallback for an initial cell version is the base identity set,
    // so the honest outcome is base massing with a stated verification failure.
    expect(failed.kind).toBe("base-massing");
    if (failed.kind !== "base-massing") return;
    expect(failed.code).toBe("request-failed");
    expect(failed.notice).toContain("failed verification");
    expect(runtime.getMetrics().fallbackCellCount).toBe(1);
    expect(runtime.getMetrics().notShippedCellCount).toBe(0);

    // The unshipped cells around it stay quiet, so one real failure cannot be
    // mistaken for the bounded-availability outcome or hidden by it.
    const quiet = await runtime.loadCell(runtime.cellIds().find((cellId) => cellId.includes("-000050-"))!, "exploration", 900);
    expect(quiet.kind).toBe("not-shipped");
    expect(runtime.getMetrics().failedArtifactCount).toBeGreaterThan(0);
  }, 30_000);

  it("refuses to render a building the active base identity set does not contain", async () => {
    const { runtime } = makeRuntime({ unknownBase: true });
    const renderableCellId = runtime.cellIds().find((cellId) => cellId.includes("-000002-"))!;
    const outcome = await runtime.loadCell(renderableCellId, "exploration", 900);
    expect(outcome.kind).toBe("base-massing");
    if (outcome.kind !== "base-massing") return;
    expect(outcome.code).toBe("base-incompatible");
  });
});
