import { generateSyntheticTileHarness } from "../src/runtime/synthetic-tile-harness.ts";
import { RuntimeTileStream } from "../src/runtime/tile-stream.ts";

const processArgs = globalThis.process.argv;
const countFlag = processArgs.indexOf("--count");
const requestedCount = countFlag >= 0 ? Number(processArgs[countFlag + 1]) : 24;
if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 200) {
  throw new Error("--count must be an integer from 1 through 200.");
}

const harness = await generateSyntheticTileHarness({ featuresPerLayerPerLod: requestedCount });
const contentById = harness.contents;
const stream = new RuntimeTileStream(harness.package, async (manifest, signal) => {
  if (signal.aborted) throw new globalThis.DOMException("aborted", "AbortError");
  const content = contentById.get(manifest.contentId);
  if (!content) throw new Error(`Missing local fixture content: ${manifest.contentId}`);
  return content;
}, { maxLoadedTiles: 4, maxLoadedBytes: 1_000_000, maxConcurrentRequests: 2, minLod: 8, maxLod: 12 });

await stream.refresh({ longitude: -73.991, latitude: 40.744, distanceMeters: 4_000 });
const metrics = stream.getMetrics();
stream.destroy();
globalThis.console.log(JSON.stringify({
  fixtureOnly: true,
  warning: "Synthetic benchmark; not real Manhattan coverage or a universal FPS claim.",
  packageId: harness.package.packageId,
  featureCountPerLayerPerLod: requestedCount,
  tileCount: harness.package.tiles.length,
  metrics,
  postDestroyPending: stream.pendingCount(),
}, null, 2));
