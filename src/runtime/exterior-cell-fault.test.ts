import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EXTERIOR_CELL_FAULT_GLB_SUFFIX,
  corruptExteriorCellDocument,
  createExteriorCellFaultFetcher,
  exteriorCellFaultPath,
  parseExteriorCellFault,
} from "./exterior-cell-fault.ts";

const RELEASE_ROOT = "public/data/manhattan-exterior-cells-20260811";

const readUtf8 = (path: string): string => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

describe("exterior cell fault parsing", () => {
  it("accepts a fault only when the harness build opted in", () => {
    expect(parseExteriorCellFault("one-glb", true)).toBe("one-glb");
    expect(parseExteriorCellFault("one-glb", false)).toBeNull();
    expect(parseExteriorCellFault("not-a-fault", true)).toBeNull();
    expect(parseExteriorCellFault(null, true)).toBeNull();
  });

  it("permits only same-origin local release paths", () => {
    expect(exteriorCellFaultPath("/data/manhattan-exterior-cells-20260811/index.json")).toBe("/data/manhattan-exterior-cells-20260811/index.json");
    expect(exteriorCellFaultPath("/cesiumStatic/Workers/x.js")).toBeNull();
    expect(exteriorCellFaultPath("https://example.invalid/data/index.json")).toBeNull();
  });
});

describe("cloned-document corruption", () => {
  it("breaks the resolved head checksum without touching anything else", () => {
    const index = JSON.parse(readUtf8(`${RELEASE_ROOT}/index.json`)) as Record<string, unknown>;
    const original = JSON.parse(JSON.stringify(index)) as Record<string, unknown>;
    const corrupted = corruptExteriorCellDocument("index.json", JSON.parse(JSON.stringify(index)), "head-checksum") as Record<string, unknown>;
    const head = corrupted.defaultHead as Record<string, unknown>;
    expect(head.checksumSha256).toBe("0".repeat(64));
    expect(head.snapshotId).toBe((original.defaultHead as Record<string, unknown>).snapshotId);
    expect(index).toEqual(original);
  });

  it("reproduces the T008 assembly-pin defect class", () => {
    const assemblies = JSON.parse(readUtf8(`${RELEASE_ROOT}/assemblies.json`)) as Array<Record<string, unknown>>;
    const before = ((assemblies[0]!.cells as Array<Record<string, unknown>>)[0]!.cellRelease as Record<string, unknown>).logicalId;
    const corrupted = corruptExteriorCellDocument("assemblies.json", JSON.parse(JSON.stringify(assemblies)), "assembly-pin") as Array<Record<string, unknown>>;
    const after = ((corrupted[0]!.cells as Array<Record<string, unknown>>)[0]!.cellRelease as Record<string, unknown>).logicalId;
    expect(after).not.toBe(before);
    expect(after).toBe("cell-release:manhattan-exterior-cells-unpinned:v0");
  });

  it("leaves documents alone for the byte-level fault", () => {
    const index = { defaultHead: { snapshotId: "s", checksumSha256: "a".repeat(64) } };
    expect(corruptExteriorCellDocument("index.json", index, "one-glb")).toEqual(index);
  });
});

describe("fault fetcher", () => {
  it("corrupts a cloned response and leaves the source document untouched", async () => {
    const source = JSON.parse(readUtf8(`${RELEASE_ROOT}/index.json`)) as Record<string, unknown>;
    const served = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
    const fetcher = createExteriorCellFaultFetcher("head-checksum", () => Promise.resolve(jsonResponse(served)));
    const response = await fetcher("/data/manhattan-exterior-cells-20260811/index.json");
    const body = await response.json() as Record<string, unknown>;
    expect((body.defaultHead as Record<string, unknown>).checksumSha256).toBe("0".repeat(64));
    expect(served).toEqual(source);
  });

  it("flips exactly one byte of exactly one GLB and passes every other artifact through", async () => {
    const original = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00]);
    const fetcher = createExteriorCellFaultFetcher("one-glb", () => Promise.resolve(new Response(original.slice())));
    const faulted = new Uint8Array(await (await fetcher(`/data/x${EXTERIOR_CELL_FAULT_GLB_SUFFIX}`)).arrayBuffer());
    expect(faulted[0]).toBe(original[0]! ^ 0xff);
    expect([...faulted.slice(1)]).toEqual([...original.slice(1)]);
    const untouched = new Uint8Array(await (await fetcher("/data/x/public/assets/doitt-102705__lod_0.glb")).arrayBuffer());
    expect([...untouched]).toEqual([...original]);
  });

  it("refuses any request outside the local release root", async () => {
    const fetcher = createExteriorCellFaultFetcher("one-glb", () => Promise.resolve(new Response("")));
    await expect(fetcher("https://example.invalid/data/index.json")).rejects.toThrow(/app-origin/);
  });
});
