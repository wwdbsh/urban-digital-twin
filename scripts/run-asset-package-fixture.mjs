/* global console */
import { runtimeFixtureFeatures } from "../src/domain/features.ts";
import { buildMetadataOnlyFixtureAssetManifest } from "../src/runtime/city-asset-manifest.ts";
import { assembleCityAssetPackage, replayCityAssetPackage } from "../src/runtime/asset-package.ts";

const generatedAt = "2026-08-03T00:00:00Z";
const manifest = buildMetadataOnlyFixtureAssetManifest(runtimeFixtureFeatures.filter((feature) => feature.kind === "building"), generatedAt);
const assembled = assembleCityAssetPackage([manifest], { packageId: "fixture-assets-v1", generatedAt, fixtureOnly: true });
if (!assembled.ok) throw new Error(`fixture asset assembly failed: ${JSON.stringify(assembled.issues)}`);
const replayed = await replayCityAssetPackage(assembled.value, new Map());
if (!replayed.ok) throw new Error(`fixture asset replay failed: ${JSON.stringify(replayed.issues)}`);
const malicious = { ...manifest, manifestId: "fixture-assets-malicious", assets: manifest.assets.map((asset) => ({ ...asset, lodVariants: asset.lodVariants.map((lod) => ({ ...lod, content: { ...lod.content, relativeContentRef: "../escape.glb" } })) })) };
const refused = assembleCityAssetPackage([malicious], { packageId: "fixture-assets-malicious", generatedAt, fixtureOnly: true });
if (refused.ok) throw new Error("malicious traversal path was accepted");
console.log(JSON.stringify({ packageId: replayed.value.packageId, state: replayed.value.state, metadataOnlyMissing: replayed.value.missingContentRefs.length, maliciousPathRefused: true }));
