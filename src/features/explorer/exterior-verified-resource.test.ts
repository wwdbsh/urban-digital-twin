/**
 * The verified-resource seam (T002, ADR 0047).
 *
 * This suite guards the four properties the shared-class-texture mechanism
 * stands on, and every one of them is a property of THIS code rather than a
 * hope about Cesium's:
 *
 *   1. The subclass survives Cesium's clone-everywhere internals. If it did not,
 *      the model would degrade to a plain `Resource` pointed at a real URL and
 *      would start fetching unverified bytes — quietly.
 *   2. A resource serves exactly the GLB it was constructed with, and refuses
 *      any other URL, so a glTF naming an external buffer cannot be handed the
 *      model's own bytes.
 *   3. An image URI is resolved by Cesium and then checked against the VERIFIED
 *      set. A contained-but-undeclared URI, an escaping URI, and a URI from
 *      another release all land in the same place: refusal.
 *   4. Two artifacts never share a URL, because Cesium keys a glTF's embedded
 *      buffers on the owning model's absolute URL and a shared URL means one
 *      model silently rendering another's BIN.
 *
 * The retirement assertion at the end is the gate-(d) re-derivation ADR 0047
 * records: a shared-texture cell creates no object URL, so its revoke list is
 * empty and the retirement report — which the cache release seam treats as
 * evidence — still arrives, in the same order, on an empty list.
 */
import { describe, expect, it } from "vitest";
import { Resource, getAbsoluteUri } from "cesium";
import {
  VERIFIED_EXTERIOR_IMAGE_REFUSED,
  VERIFIED_EXTERIOR_MODEL_REFUSED,
  VERIFIED_EXTERIOR_SUBCLASS_LOST,
  VerifiedExteriorResource,
  assertVerifiedResourceSurvivesCesium,
  verifiedExteriorModelResource,
} from "./exterior-verified-resource";
import { canonicalExteriorPickId, exteriorCellEntityId, exteriorCellModelUris, exteriorCellSignature, exteriorOverlayRenderEntries, exteriorRetirementSteps, type ExteriorCellOverlay } from "./CesiumViewport";

const BASE = "/data/manhattan-southern-remainder-cells-20260812-t1/";
const GLB_REF = "public/assemblies/cell-a/assets/doitt-778052-lod0.glb";
const TILE_REF = "public/textures/brick-running-bond.png";
const GLB_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
const TILE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);

function resource(overrides: { glbRef?: string; tiles?: ReadonlyMap<string, Uint8Array> } = {}): VerifiedExteriorResource {
  return verifiedExteriorModelResource({
    modelUrl: `${BASE}${overrides.glbRef ?? GLB_REF}`,
    textureUrls: overrides.tiles ?? new Map([[`${BASE}${TILE_REF}`, TILE_BYTES]]),
  }, GLB_BYTES);
}

/** The relative URI a GLB at `GLB_REF` uses to reach `TILE_REF`. */
const TILE_URI = "../../../textures/brick-running-bond.png";

describe("the verified exterior resource", () => {
  it("survives every clone Cesium performs, carrying its verified payload", async () => {
    const model = resource();
    // `getDerivedResource` (image URIs, cache keys) and `createIfNeeded`
    // (ModelVisualizer, then again inside Model.fromGltfAsync) both go through
    // `clone()` with no argument; `ConstantProperty` calls it with a result.
    const derived = model.getDerivedResource({});
    // `createIfNeeded` is Cesium-internal and absent from the public typings,
    // so it is named through a cast rather than skipped: it is the exact call
    // ModelVisualizer makes on `entity.model.uri`, and again inside
    // `Model.fromGltfAsync`. Pinned at the installed version (1.143.0).
    const viaCreateIfNeeded = (Resource as unknown as { createIfNeeded(resource: Resource): Resource }).createIfNeeded(model);
    const intoResult = model.clone(new VerifiedExteriorResource({ url: "about:blank", modelBytes: new Uint8Array(), textureUrls: new Map() }));
    for (const candidate of [derived, viaCreateIfNeeded, intoResult]) {
      expect(candidate).toBeInstanceOf(VerifiedExteriorResource);
      expect(candidate.url).toBe(`${BASE}${GLB_REF}`);
      expect(new Uint8Array((await (candidate as VerifiedExteriorResource).fetchArrayBuffer())!)).toStrictEqual(GLB_BYTES);
    }
  });

  it("serves the verified GLB as a COPY, so the cache's array cannot be detached under it", async () => {
    const model = resource();
    const buffer = await model.fetchArrayBuffer();
    expect(new Uint8Array(buffer)).toStrictEqual(GLB_BYTES);
    expect(buffer).not.toBe(GLB_BYTES.buffer);
  });

  it("refuses to serve model bytes for any URL but its own", async () => {
    const model = resource();
    // What a glTF naming an external `.bin` buffer would produce: a derived
    // resource at a different URL, inheriting this method.
    const external = model.getDerivedResource({ url: "../buffers/geometry.bin" });
    await expect(external.fetchArrayBuffer()).rejects.toThrow(VERIFIED_EXTERIOR_MODEL_REFUSED);
  });

  it("resolves a declared image URI to the verified tile bytes", () => {
    const image = resource().getDerivedResource({ url: TILE_URI }) as VerifiedExteriorResource;
    expect(getAbsoluteUri(image.url)).toBe(getAbsoluteUri(`${BASE}${TILE_REF}`));
    expect(image.verifiedImageBytes()).toBe(TILE_BYTES);
  });

  it("refuses every URI that does not resolve to a verified tile of THIS release", async () => {
    const model = resource();
    const refused = [
      // contained, well-formed, and simply not declared
      "../../../textures/not-declared.png",
      // a sibling of the GLB rather than a tile
      "neighbour.png",
      // an escape attempt: one level above the release root
      "../../../../elsewhere/brick-running-bond.png",
      // the right tile path under a DIFFERENT release
      "../../../../manhattan-lower-manhattan-cells-20260812-t1/public/textures/brick-running-bond.png",
      // an absolute URL, which resolution keeps whole
      "https://example.invalid/brick-running-bond.png",
    ];
    for (const uri of refused) {
      const image = model.getDerivedResource({ url: uri }) as VerifiedExteriorResource;
      expect(() => image.verifiedImageBytes()).toThrow(VERIFIED_EXTERIOR_IMAGE_REFUSED);
      await expect(image.fetchImage()).rejects.toThrow(VERIFIED_EXTERIOR_IMAGE_REFUSED);
    }
  });

  it("gives distinct artifacts distinct URLs and one class one URL", () => {
    const first = resource();
    const second = resource({ glbRef: "public/assemblies/cell-a/assets/doitt-982383-lod0.glb" });
    // Cesium's embedded-buffer key is `${absolute model url}-buffer-id-0`, so a
    // shared URL is a shared BIN. Distinctness is the whole guard.
    expect(getAbsoluteUri(first.url)).not.toBe(getAbsoluteUri(second.url));
    // ...while the tile both draw resolves to ONE url, which is what collapses
    // 941 decoded textures to four.
    const firstTile = first.getDerivedResource({ url: TILE_URI });
    const secondTile = second.getDerivedResource({ url: TILE_URI });
    expect(getAbsoluteUri(firstTile.url)).toBe(getAbsoluteUri(secondTile.url));
  });

  it("canaries the clone round-trip at load time and fails CLOSED if it degrades", () => {
    // The property everything rests on, asserted on the installed Cesium at
    // every cell add rather than assumed to hold forever.
    expect(() => assertVerifiedResourceSurvivesCesium(resource())).not.toThrow();
    // And what a future Cesium that stopped preserving the subclass would do:
    // refuse loudly instead of quietly fetching unverified bytes off a real URL.
    const degraded = resource();
    Object.defineProperty(degraded, "clone", { value: () => new Resource({ url: `${BASE}${GLB_REF}` }), configurable: true });
    expect(() => assertVerifiedResourceSurvivesCesium(degraded)).toThrow(VERIFIED_EXTERIOR_SUBCLASS_LOST);
  });

  it("contains a canary refusal to ONE cell, with nothing half-added and nothing leaked", () => {
    // The failure mode has to match the wording. A throw escaping into the
    // overlay effect would orphan entities already added for this cell — no
    // owner record exists to retire them — and would kill every remaining cell
    // in the plan. So every model URI is built BEFORE the first entity, and the
    // refusal is RETURNED rather than thrown.
    const created: string[] = [];
    const revoked: string[] = [];
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    const createIfNeeded = (Resource as unknown as Record<string, unknown>).createIfNeeded;
    URL.createObjectURL = () => { const url = `blob:test/${created.length + 1}`; created.push(url); return url; };
    URL.revokeObjectURL = (url: string) => { revoked.push(url); };
    // Exactly the degradation the canary exists for: a CesiumJS that no longer
    // returns the subclass from its own round-trip.
    (Resource as unknown as Record<string, unknown>).createIfNeeded = (value: Resource) => new Resource({ url: value.url });
    try {
      const blobEntry = { entry: { bytes: GLB_BYTES }, anchor: {} };
      const sharedEntry = { entry: { bytes: GLB_BYTES, sharedTextures: { modelUrl: `${BASE}${GLB_REF}`, glbRef: GLB_REF, textureUrls: new Map([[`${BASE}${TILE_REF}`, TILE_BYTES]]) } }, anchor: {} };
      const built = exteriorCellModelUris({ cellId: "c1", adds: [blobEntry, blobEntry, sharedEntry] } as never);
      // Returned, not thrown: that is the containment, and asserting it here is
      // what stops a future refactor from "simplifying" the helper back into a
      // throw that escapes the effect.
      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.cellId).toBe("c1");
      expect(built.message).toContain(VERIFIED_EXTERIOR_SUBCLASS_LOST);
      // The two Blob URLs built before the refusal are revoked, so a refused
      // cell leaks nothing either.
      expect(created).toHaveLength(2);
      expect(revoked).toStrictEqual(created);
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      (Resource as unknown as Record<string, unknown>).createIfNeeded = createIfNeeded;
    }
    // And with Cesium behaving, the same cell builds every URI.
    const rebuilt = exteriorCellModelUris({ cellId: "c1", adds: [{ entry: { bytes: GLB_BYTES, sharedTextures: { modelUrl: `${BASE}${GLB_REF}`, glbRef: GLB_REF, textureUrls: new Map() } }, anchor: {} }] } as never);
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) expect(rebuilt.objectUrls).toHaveLength(0);
  });

  it("retires a shared-texture cell with an EMPTY revoke list and the report still last", () => {
    // Gate (d) of the exterior cache release seam re-derived: the viewport owns
    // no Blob for such a cell, so `objectUrls` is empty. The ordering contract
    // — revoke strictly before report — holds vacuously, and the report the
    // seam treats as evidence is still emitted.
    const steps = exteriorRetirementSteps({ removeCellIds: ["c1"], removeEntityIds: ["exterior-cell:c1:doitt:778052"], revokeObjectUrls: [] });
    expect(steps.map((step) => step.op)).toStrictEqual(["remove-entity", "forget-pick", "forget-cell", "report-retired"]);
    expect(steps.some((step) => step.op === "revoke-object-url")).toBe(false);
  });
});

describe("the overlay projection of a shared-texture wave", () => {
  const canonicalId = "doitt:778052";
  const provenance = {
    inventoryId: "inventory:b1:v2",
    inventoryHashSha256: "a".repeat(64),
    evidenceShardId: "evidence:b1:v2",
    truthTiers: ["generated" as const],
    sourceDates: { capturedAt: "2026-08-09T00:00:00.000Z", updatedAt: null },
    predecessor: null,
    uncertainty: "Generated exterior geometry; not observed real-world truth.",
  };
  const overlay = (withTextures: boolean): ExteriorCellOverlay => ({
    releaseId: "manhattan-southern-remainder-cells-20260812-t1",
    snapshotId: "snapshot:v1",
    origin: "default",
    profile: "inspection",
    cells: [{
      kind: "rendered", cellId: "c1", cellReleaseId: "cell:c1:v1", cellReleaseVersion: "v1", assemblyPackageId: "assembly:c1", representation: "head", notice: null,
      assets: [{
        canonicalFeatureId: canonicalId, ownerCellId: "c1", lodId: "lod-0", artifactRef: GLB_REF, byteSize: GLB_BYTES.byteLength,
        checksumSha256: "b".repeat(64), bytes: GLB_BYTES, geometricErrorMeters: 0, maxDistanceMeters: 220, provenance,
        ...(withTextures ? { sharedTextures: { modelUrl: `${BASE}${GLB_REF}`, glbRef: GLB_REF, textureUrls: new Map([[`${BASE}${TILE_REF}`, TILE_BYTES]]) } } : {}),
      }],
    }],
  });

  it("carries the binding through untouched and moves no identity with it", () => {
    const shared = exteriorOverlayRenderEntries(overlay(true))[0]!;
    const plain = exteriorOverlayRenderEntries(overlay(false))[0]!;
    // Identity, pick resolution, provenance and the diff signature are what a
    // byte-level delivery change could plausibly disturb, so each is named.
    expect(shared.entityId).toBe(exteriorCellEntityId("c1", canonicalId));
    expect(shared.entityId).toBe(plain.entityId);
    expect(shared.canonicalFeatureId).toBe(plain.canonicalFeatureId);
    expect(shared.provenance).toStrictEqual(plain.provenance);
    expect(exteriorCellSignature([shared])).toBe(exteriorCellSignature([plain]));
    expect(canonicalExteriorPickId(shared.entityId, new Map([[shared.entityId, canonicalId]]))).toBe(canonicalId);
    expect(plain.sharedTextures).toBeUndefined();
    expect(shared.sharedTextures?.modelUrl).toBe(`${BASE}${GLB_REF}`);
    // The viewport takes its branch off exactly this field, so the resource it
    // would build is constructed here from the same binding.
    const built = verifiedExteriorModelResource(shared.sharedTextures!, shared.bytes);
    expect((built.getDerivedResource({ url: TILE_URI }) as VerifiedExteriorResource).verifiedImageBytes()).toBe(TILE_BYTES);
  });
});
