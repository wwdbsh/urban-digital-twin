/**
 * Isolated-failure proof seam for the exterior-cell release graph.
 *
 * This mirrors `createExteriorPilotFaultFetcher` in
 * `src/runtime/exterior-pilot-release.ts` exactly where it matters: the wrapper
 * corrupts a **cloned** response body in memory and returns a new `Response`.
 * The immutable release files on disk are never opened for writing, never
 * rewritten, and never re-served; production loading never constructs this
 * wrapper at all. Zero release bytes change, which is what makes the fault
 * journey admissible as evidence next to a "no immutable mutation" claim.
 */
import { assertPublicExteriorArtifactRef, type ExteriorRuntimeFetcher } from "./exterior-cell-runtime.ts";

export const EXTERIOR_CELL_FAULTS = ["one-glb", "assembly-pin", "head-checksum"] as const;
export type ExteriorCellFault = (typeof EXTERIOR_CELL_FAULTS)[number];

/** Accept an injected fault only from the explicitly built harness branch. */
export function parseExteriorCellFault(value: unknown, harnessEnabled: boolean): ExteriorCellFault | null {
  return harnessEnabled && typeof value === "string" && (EXTERIOR_CELL_FAULTS as readonly string[]).includes(value)
    ? value as ExteriorCellFault
    : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The single asset the `one-glb` fault targets. One cell fails; the app does not. */
export const EXTERIOR_CELL_FAULT_GLB_SUFFIX = "/doitt-262867__lod_0.glb";

export function exteriorCellFaultPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (typeof raw !== "string") return null;
  const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
  try {
    const url = new URL(raw, base);
    // Cross-origin is rejected unconditionally, including outside a browser, so
    // the seam cannot be pointed at a remote host from a test or a harness.
    if (url.origin !== new URL(base).origin) return null;
    return url.pathname.startsWith("/data/") ? url.pathname : null;
  } catch {
    return null;
  }
}

/**
 * `assembly-pin` reproduces the exact T008 defect class: an assembly whose
 * `cells[].cellRelease` pin does not match the head the index resolved. Both
 * structural validators still accept the document; the consumer is the
 * authority that rejects it. `head-checksum` corrupts the resolved head's
 * declared checksum so head resolution itself fails closed.
 */
export function corruptExteriorCellDocument(fileName: string, document: unknown, fault: ExteriorCellFault): unknown {
  if (fault === "one-glb") return document;
  if (fault === "head-checksum" && fileName === "index.json") {
    if (!record(document)) throw new Error("Exterior cell fault expected a JSON index document.");
    const head = record(document.defaultHead) ? document.defaultHead : null;
    if (!head) throw new Error("Exterior cell fault expected a defaultHead entry.");
    head.checksumSha256 = "0".repeat(64);
    return document;
  }
  if (fault === "assembly-pin" && fileName === "assemblies.json") {
    if (!Array.isArray(document) || document.length === 0) throw new Error("Exterior cell fault expected a non-empty assembly array.");
    const assembly = document[0];
    if (!record(assembly) || !Array.isArray(assembly.cells) || assembly.cells.length === 0) throw new Error("Exterior cell fault expected an assembly with cells.");
    const cell = assembly.cells[0];
    if (!record(cell)) throw new Error("Exterior cell fault expected a cell record.");
    cell.cellRelease = { ...(record(cell.cellRelease) ? cell.cellRelease : {}), logicalId: "cell-release:manhattan-exterior-cells-unpinned:v0" };
    return document;
  }
  return document;
}

/**
 * Development/harness proof seam: mutate cloned, app-origin responses only.
 */
export function createExteriorCellFaultFetcher(
  fault: ExteriorCellFault,
  fetcher: ExteriorRuntimeFetcher = globalThis.fetch.bind(globalThis),
): ExteriorRuntimeFetcher {
  return async (input, init) => {
    const path = exteriorCellFaultPath(input);
    if (!path) throw new Error("Exterior cell fault fetcher permits only current app-origin release files.");
    const response = await fetcher(input, init);
    if (!response.ok) return response;
    if (fault === "one-glb") {
      if (!path.endsWith(EXTERIOR_CELL_FAULT_GLB_SUFFIX)) return response;
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (bytes.length === 0) throw new Error("Exterior cell fault expected non-empty GLB content.");
      bytes[0] = bytes[0]! ^ 0xff;
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
    }
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    if (fileName !== "index.json" && fileName !== "assemblies.json") return response;
    const cloned: unknown = JSON.parse(JSON.stringify(await response.clone().json()));
    const corrupted = corruptExteriorCellDocument(fileName, cloned, fault);
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(corrupted), { status: response.status, statusText: response.statusText, headers });
  };
}

/**
 * Wave-agnostic per-asset fault seam.
 *
 * `one-glb` above names one Block 835 asset outright, which cannot prove
 * anything about a second promoted wave. This variant takes the asset FILE NAME
 * from the harness URL, so the same seam can corrupt any single verified GLB in
 * any promoted release — which is exactly what an isolation proof needs: one
 * asset of one cell of one wave fails its checksum while every other cell,
 * every other wave, and the base scene continue untouched.
 *
 * The name is validated to a strict shape and matched only as a path SUFFIX
 * under `/data/`, so it can neither escape the release tree nor be pointed at a
 * document that would change verification semantics rather than bytes.
 */
const EXTERIOR_ASSET_FAULT_NAME = /^[a-z0-9][a-z0-9._-]{0,120}\.glb$/i;

export function parseExteriorAssetFault(value: unknown, harnessEnabled: boolean): string | null {
  if (!harnessEnabled || typeof value !== "string") return null;
  const name = value.trim();
  return EXTERIOR_ASSET_FAULT_NAME.test(name) && !name.includes("..") ? name : null;
}

export function createExteriorAssetFaultFetcher(
  assetFileName: string,
  fetcher: ExteriorRuntimeFetcher = globalThis.fetch.bind(globalThis),
): ExteriorRuntimeFetcher {
  const suffix = `/${assetFileName}`;
  return async (input, init) => {
    const path = exteriorCellFaultPath(input);
    if (!path) throw new Error("Exterior asset fault fetcher permits only current app-origin release files.");
    const response = await fetcher(input, init);
    if (!response.ok || !path.endsWith(suffix)) return response;
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    if (bytes.length === 0) throw new Error("Exterior asset fault expected non-empty GLB content.");
    bytes[0] = bytes[0]! ^ 0xff;
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
  };
}

/** Re-exported so a caller cannot construct an unsafe artifact ref through this seam. */
export { assertPublicExteriorArtifactRef };
