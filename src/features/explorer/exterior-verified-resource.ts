/**
 * The VERIFIED RESOURCE: how a shared-class-texture release reaches Cesium
 * without any of its bytes coming off the wire a second time.
 *
 * ## Why this exists at all
 *
 * The exterior entity path hands Cesium a Blob URL built from the verified GLB
 * bytes (`exteriorModelObjectUrl`). That works for a self-contained GLB and
 * cannot work for one that references its detail tiles by URI: the image URI
 * would resolve against a `blob:` URL, which has no directory, so the reference
 * is unresolvable — and if it WERE resolvable it would be a fresh, unverified
 * network fetch of bytes this application has already verified.
 *
 * A `Resource` subclass answers both. Cesium asks a resource for its bytes
 * (`fetchArrayBuffer`) and for the bytes of anything the glTF names by URI
 * (`getDerivedResource(...).fetchImage`), and this class answers both from the
 * verified set it was constructed with. Nothing it serves was fetched here, and
 * anything it was not given, it refuses.
 *
 * ## The two Cesium facts this design turns on
 *
 * 1. **Unique URL per artifact is MANDATORY.** Cesium keys a glTF's embedded
 *    buffer as `${getAbsoluteUri(gltfResource.url)}-buffer-id-${id}`
 *    (`ResourceCacheKey.getEmbeddedBufferCacheKey`). Two models sharing one URL
 *    share one buffer cache entry, and the second model silently renders the
 *    first model's BIN. The URL here is the release-relative artifact path,
 *    which is unique per artifact by construction and is the same path the
 *    bytes were verified from.
 * 2. **An external image is keyed by its own resolved absolute URI**
 *    (`getImageCacheKey` -> `getExternalResourceCacheKey`), while an embedded
 *    image is keyed through its owning model's URL. That difference IS the
 *    mechanism: 941 embedded copies of four tiles decode into 941 GPU textures,
 *    and four shared URIs decode into four.
 *
 * ## Subclass survival is OUR property, not Cesium's
 *
 * `Resource.prototype.clone()` called with no argument returns `new Resource(...)`
 * — a BASE instance. Cesium clones a resource on every path this design depends
 * on: `Resource.createIfNeeded` (ModelVisualizer, and again inside
 * `Model.fromGltfAsync`), `getDerivedResource` (image URIs, and the cache-key
 * derivation), `GltfLoader`'s `baseResource = gltfResource.clone()`, and
 * `ConstantProperty` both when the ModelGraphics uri is set and on every read of
 * it. So the subclass survives exactly because `clone` is overridden below to
 * carry the verified payload onto the copy. Without that override every one of
 * those paths would silently degrade to a plain `Resource` pointed at a real
 * URL, and the "verified bytes only" property would be lost quietly rather than
 * loudly.
 */
import { Resource, getAbsoluteUri } from "cesium";

/** Refusal messages, exported so the tests assert the message this file throws. */
export const VERIFIED_EXTERIOR_MODEL_REFUSED = "verified-exterior-resource/unverified-model: this resource serves exactly one verified GLB and refuses every other URL." as const;
export const VERIFIED_EXTERIOR_IMAGE_REFUSED = "verified-exterior-resource/unverified-image: an image URI that does not resolve to a verified shared texture of this release is refused." as const;
export const VERIFIED_EXTERIOR_SUBCLASS_LOST = "verified-exterior-resource/subclass-lost: this CesiumJS build did not preserve the verified resource through its own clone path, so a model would fetch unverified bytes; the cell is failed closed instead." as const;

/**
 * The verified set one exterior artifact may serve, keyed by ABSOLUTE URL.
 *
 * Absolute because that is the form Cesium compares in its cache keys and the
 * form `getDerivedResource` produces: a root-relative key would match on some
 * documents and not others, and a mismatch here fails closed, so normalising
 * both sides once, here, is what keeps the refusal about the bytes rather than
 * about the page's base URL.
 */
interface VerifiedExteriorPayload {
  readonly modelUrl: string;
  readonly modelBytes: Uint8Array;
  readonly imageBytesByUrl: ReadonlyMap<string, Uint8Array>;
}

function verifiedPayload(options: VerifiedExteriorResourceOptions): VerifiedExteriorPayload {
  const imageBytesByUrl = new Map<string, Uint8Array>();
  for (const [url, bytes] of options.textureUrls) imageBytesByUrl.set(getAbsoluteUri(url), bytes);
  return { modelUrl: getAbsoluteUri(options.url), modelBytes: options.modelBytes, imageBytesByUrl };
}

export interface VerifiedExteriorResourceOptions {
  /** Unique per-artifact URL; the release-relative path the bytes were verified from. */
  url: string;
  /** The checksum-verified GLB bytes. Never re-fetched, never re-derived. */
  modelBytes: Uint8Array;
  /** Verified shared tiles this artifact may draw, keyed by the URL each resolves to. */
  textureUrls: ReadonlyMap<string, Uint8Array>;
}

export class VerifiedExteriorResource extends Resource {
  /**
   * Shared by reference across every clone and every derived resource, so a
   * model and the image resources derived from it are answering out of one
   * verified set rather than out of copies that could diverge.
   */
  private verified: VerifiedExteriorPayload;

  constructor(options: VerifiedExteriorResourceOptions) {
    super({ url: options.url });
    this.verified = verifiedPayload(options);
  }

  /**
   * The one reason this class survives Cesium's internals; see the file header.
   *
   * Both branches are exercised in practice: `getDerivedResource` and
   * `createIfNeeded` call `clone()` with no argument, `ConstantProperty` calls
   * it with its previous value as the result.
   */
  override clone(result?: Resource): Resource {
    const target = result ?? new VerifiedExteriorResource({ url: this.url, modelBytes: this.verified.modelBytes, textureUrls: new Map() });
    const cloned = super.clone(target);
    if (cloned instanceof VerifiedExteriorResource) cloned.verified = this.verified;
    return cloned;
  }

  /**
   * The verified GLB, and nothing else.
   *
   * The identity check is not ceremony: a derived resource inherits this method,
   * so a glTF that named an external `.bin` buffer would arrive here, and it
   * must be refused rather than served the model's own bytes.
   *
   * The bytes are COPIED. Cesium parses the returned buffer in place and, on
   * other profiles, hands it to workers that may detach it; the exterior cache
   * holds the original and re-verification of a cached artifact has to keep
   * meaning something. One copy per model load is exactly what the Blob path it
   * replaces already cost.
   */
  override fetchArrayBuffer(): Promise<ArrayBuffer> {
    if (getAbsoluteUri(this.url) !== this.verified.modelUrl) return Promise.reject(new Error(`${VERIFIED_EXTERIOR_MODEL_REFUSED} Requested ${this.url}.`));
    const copy = new Uint8Array(this.verified.modelBytes.byteLength);
    copy.set(this.verified.modelBytes);
    return Promise.resolve(copy.buffer);
  }

  /**
   * The verified tile bytes this URL resolves to, or a refusal.
   *
   * Separate from `fetchImage` so the decision — which is the security-relevant
   * half — is assertable without a browser image decoder in scope.
   */
  verifiedImageBytes(): Uint8Array {
    const bytes = this.verified.imageBytesByUrl.get(getAbsoluteUri(this.url));
    if (!bytes) throw new Error(`${VERIFIED_EXTERIOR_IMAGE_REFUSED} Requested ${this.url}.`);
    return bytes;
  }

  /**
   * Decoded from verified bytes, with the decode parameters Cesium's own image
   * path uses (`Resource.createImageBitmapFromBlob`): no flip, no premultiply,
   * and colour-space conversion skipped, which is what `GltfImageLoader` asks
   * for. Matching them is what makes "the same tile, decoded the same way" a
   * statement about this code rather than a hope.
   */
  override fetchImage(options?: { preferBlob?: boolean; preferImageBitmap?: boolean; flipY?: boolean; skipColorSpaceConversion?: boolean }): Promise<ImageBitmap | HTMLImageElement> {
    let bytes: Uint8Array;
    try {
      bytes = this.verifiedImageBytes();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const blob = new Blob([bytes as unknown as BlobPart], { type: "image/png" });
    // The three options are Cesium's `Resource.createImageBitmapFromBlob`
    // expressions, mirrored token for token rather than paraphrased, with the
    // same defaulting Cesium applies (`?? false`). `premultiplyAlpha` is
    // hard-false because that is the only value `GltfImageLoader` ever passes.
    const flipY = options?.flipY ?? false;
    const skipColorSpaceConversion = options?.skipColorSpaceConversion ?? false;
    return createImageBitmap(blob, {
      imageOrientation: flipY ? "flipY" : "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: skipColorSpaceConversion ? "none" : "default",
    });
  }
}

/**
 * The ModelGraphics `uri` for one verified exterior asset.
 *
 * A function rather than a constructor call at the call site so the viewport
 * states WHAT it is handing Cesium — a verified resource, not a URL — and so
 * the shared-texture branch of the overlay effect stays one line.
 */
export function verifiedExteriorModelResource(binding: { modelUrl: string; textureUrls: ReadonlyMap<string, Uint8Array> }, modelBytes: Uint8Array): VerifiedExteriorResource {
  const resource = new VerifiedExteriorResource({ url: binding.modelUrl, modelBytes, textureUrls: binding.textureUrls });
  assertVerifiedResourceSurvivesCesium(resource);
  return resource;
}

/**
 * The LOAD-TIME CANARY, and the reason it exists.
 *
 * Everything here rests on the `clone` override surviving Cesium's internals.
 * If a future Cesium stopped routing through `clone` — or routed through a
 * different one — the subclass would be replaced by a plain `Resource` pointed
 * at a real release path, and the model would start fetching bytes nobody
 * verified. Nothing would throw. The scene would look right.
 *
 * So the round-trip is performed once per resource, through the exact call
 * `ModelVisualizer` makes on `entity.model.uri`, and a degraded result FAILS
 * THE CELL CLOSED rather than rendering unverified. The cost is one clone per
 * cell add; the alternative is a silent loss of the property the whole design
 * is for.
 */
export function assertVerifiedResourceSurvivesCesium(resource: VerifiedExteriorResource): void {
  // `createIfNeeded` is Cesium-internal and absent from the published typings.
  // It is what ModelVisualizer calls, and again what `Model.fromGltfAsync`
  // calls, so it is the round-trip worth asserting rather than a proxy for it.
  const createIfNeeded = (Resource as unknown as { createIfNeeded?: (value: Resource) => Resource }).createIfNeeded;
  const roundTripped = typeof createIfNeeded === "function" ? createIfNeeded(resource) : resource.clone();
  if (!(roundTripped instanceof VerifiedExteriorResource)) throw new Error(`${VERIFIED_EXTERIOR_SUBCLASS_LOST} ${resource.url}`);
  if (getAbsoluteUri(roundTripped.url) !== getAbsoluteUri(resource.url)) throw new Error(`${VERIFIED_EXTERIOR_SUBCLASS_LOST} URL moved from ${resource.url} to ${roundTripped.url}.`);
}
