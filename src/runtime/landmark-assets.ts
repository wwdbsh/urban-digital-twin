import { CityAssetResolver, validateCityAssetManifest, type CityAssetManifest } from "./city-asset-manifest.ts";

export interface LoadedLandmarkAssets {
  manifest: CityAssetManifest;
  resolver: CityAssetResolver;
  verifiedContentRefs: ReadonlySet<string>;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** Load and replay the immutable landmark package; any mismatch fails closed. */
export async function loadLandmarkAssets(basePath = "/assets/landmarks/landmark-wave-20260804/"): Promise<LoadedLandmarkAssets> {
  const response = await fetch(`${basePath}manifest.json`, { cache: "no-store" });
  if (!response.ok) throw new Error("Landmark asset manifest is unavailable; procedural fallback is active.");
  const parsed = validateCityAssetManifest(await response.json());
  if (!parsed.ok || parsed.value.fixtureOnly) throw new Error("Landmark asset manifest failed approval validation; procedural fallback is active.");
  const verified = new Set<string>();
  for (const entry of parsed.value.assets) {
    for (const lod of entry.lodVariants) {
      const content = await fetch(`/${lod.content.relativeContentRef}`, { cache: "no-store" });
      if (!content.ok) throw new Error(`Landmark content ${lod.content.relativeContentRef} is unavailable; procedural fallback is active.`);
      const bytes = await content.arrayBuffer();
      if (bytes.byteLength !== lod.content.byteSize || (await sha256(bytes)).toLowerCase() !== lod.content.sha256.toLowerCase()) throw new Error(`Landmark content ${lod.content.relativeContentRef} failed checksum validation; procedural fallback is active.`);
      verified.add(lod.content.relativeContentRef);
    }
  }
  return { manifest: parsed.value, verifiedContentRefs: verified, resolver: new CityAssetResolver(parsed.value, { verifiedContentRefs: verified }) };
}
