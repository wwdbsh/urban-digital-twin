/**
 * The wave-agnostic per-asset fault seam. Additive to the existing
 * `exterior-cell-fault` tests, which cover the Block-835-specific faults.
 */
import { describe, expect, it } from "vitest";
import { createExteriorAssetFaultFetcher, parseExteriorAssetFault } from "./exterior-cell-fault";

const ASSET = "doitt-1294316__lod_0.glb";

function response(bytes: Uint8Array): Response {
  return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "model/gltf-binary" } });
}

describe("per-asset exterior fault seam", () => {
  it("is inert unless the harness build explicitly enabled it", () => {
    expect(parseExteriorAssetFault(ASSET, false)).toBeNull();
    expect(parseExteriorAssetFault(ASSET, true)).toBe(ASSET);
  });

  it("refuses anything that is not a plain GLB file name", () => {
    for (const value of ["../../etc/passwd", "a/b.glb", "..%2Fx.glb", "index.json", "", "x.glb/../y.glb", null, 42]) {
      expect(parseExteriorAssetFault(value, true), String(value)).toBeNull();
    }
  });

  it("corrupts exactly the named asset and passes every other artifact through", async () => {
    const original = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    const seen: string[] = [];
    const fetcher = createExteriorAssetFaultFetcher(ASSET, async (input) => {
      seen.push(String(input));
      return response(original);
    });
    const faulted = new Uint8Array(await (await fetcher(`http://localhost/data/manhattan-midtown-core-cells-20260811/public/assets/${ASSET}`)).arrayBuffer());
    expect(faulted[0]).toBe(original[0]! ^ 0xff);
    expect([...faulted.slice(1)]).toEqual([...original.slice(1)]);

    // A different asset — including one in the other promoted wave — is served
    // byte-identical, which is what makes the isolation claim a measurement
    // rather than an assumption.
    const untouched = new Uint8Array(await (await fetcher("http://localhost/data/manhattan-exterior-cells-20260811/public/assets/doitt-778052__lod_0.glb")).arrayBuffer());
    expect([...untouched]).toEqual([...original]);
    expect(seen).toHaveLength(2);
  });

  it("permits only current-origin release paths", async () => {
    const fetcher = createExteriorAssetFaultFetcher(ASSET, async () => response(new Uint8Array([1])));
    await expect(fetcher("https://example.com/data/x/public/assets/" + ASSET)).rejects.toThrow(/current app-origin/);
    await expect(fetcher("http://localhost/not-data/" + ASSET)).rejects.toThrow(/current app-origin/);
  });
});
