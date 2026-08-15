/**
 * The ONE place this repository reaches into a Cesium-internal export.
 *
 * `ResourceCache.statistics` is how Cesium accounts for what it has uploaded,
 * and it is not part of the public API surface: the published typings do not
 * declare it, which is exactly why it is named here, once, behind a cast, rather
 * than cast at each use. A version bump is then a one-line audit.
 *
 * PINNED AT cesium 1.143.0 / @cesium/engine 26.1.0. Nothing here decides
 * anything, nothing here renders, and the only caller is the T002 GPU probe,
 * which a normal build compiles out.
 */
import * as Cesium from "cesium";
import { readGpuTextureProbe, type GpuTextureProbeReading } from "./gpu-texture-probe";

const namespace = Cesium as unknown as { ResourceCache?: unknown; VERSION?: unknown };

/** The installed CesiumJS version the reading below is pinned to. */
export function cesiumVersion(): string {
  return typeof namespace.VERSION === "string" ? namespace.VERSION : "unknown";
}

/**
 * Cesium's own upload accounting, or `null` when the internal export has moved.
 *
 * Null rather than zero, deliberately: a probe that reported 0 for "the export
 * is gone" would report a spectacular and entirely fictional saving.
 */
export function cesiumGpuTextureReading(): GpuTextureProbeReading | null {
  return readGpuTextureProbe(namespace.ResourceCache ?? null);
}
