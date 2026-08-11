import { useEffect, useRef, useState } from "react";
import {
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  ModelGraphics,
  Quaternion,
  Transforms,
  Viewer,
} from "cesium";
import { exteriorModelObjectUrl } from "./CesiumViewport";

/**
 * T028 sampler-aliasing harness: the SHIPPING renderer, looking at the two
 * sampler variants of the same textured package.
 *
 * ADR 0032 precondition 7 is the reason this exists. The V3T stills in T027 were
 * rendered by Blender EEVEE, which is not the renderer that ships, and the
 * shipped bytes name no `minFilter`/`magFilter` at all — so today's answer to
 * "how is a 128-pixel tile repeated ~160 times filtered in Cesium?" is "whatever
 * the renderer picked", which is not a property anyone can validate. This page
 * puts both variants in front of CesiumJS at identical fixed camera stations so
 * the difference is attributable to the sampler and to nothing else.
 *
 * What it deliberately is NOT:
 *
 * - It is not a release, an allow-list entry or a partition change. It reads the
 *   two variant packages out of the gitignored `artifacts/` scratch root through
 *   a dev/preview-only middleware, never out of a `private/`-rooted path under
 *   `public/data`, and never through the exterior-cell runtime — which refuses a
 *   non-public release, correctly, and is untouched here.
 * - It is not in the shipped bundle. Its entry is registered only when
 *   `VITE_T028_SAMPLER_PROBE=1` is set at build time, and the component refuses
 *   to run without the same flag, following the `VITE_BLOCK835_PROBE` precedent.
 */
const HARNESS_ENABLED = import.meta.env.VITE_T028_SAMPLER_PROBE === "1";
const SCRATCH_PREFIX = "/__t028-sampler/";

/** Polled by the capture script, exactly like the earlier canary DOM probes. */
export const SAMPLER_HARNESS_READY_ATTRIBUTE = "data-t028-sampler-ready";
export const SAMPLER_HARNESS_STATE_ATTRIBUTE = "data-t028-sampler-state";

interface HarnessStation {
  stationId: string;
  note: string;
  targetBuildingId: string;
  groundDistanceMeters: number;
  longitude: number;
  latitude: number;
  heightMeters: number;
  headingDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
}
interface HarnessAsset {
  canonicalBuildingId: string;
  relativeRef: string;
  byteSize: number;
  checksumSha256: string;
  textureCount: number;
  longitude: number;
  latitude: number;
}
interface HarnessVariant {
  variantId: string;
  samplerFilter: { magFilter: number; minFilter: number } | null;
  note: string;
  assets: HarnessAsset[];
}
interface HarnessInput {
  schemaVersion: string;
  packageId: string;
  stations: HarnessStation[];
  variants: HarnessVariant[];
}

/** Frames rendered after the last model is added before the page declares itself ready. */
const SETTLE_FRAMES = 120;

export function SamplerAliasingHarness(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<string>("starting");
  const [summary, setSummary] = useState<string>("");

  const query = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const variantId = query.get("variant") ?? "renderer-default";
  const stationId = query.get("station") ?? "far-shaft-repeats";

  useEffect(() => {
    if (!HARNESS_ENABLED) { setState("disabled"); return undefined; }
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    const objectUrls: string[] = [];
    let viewer: Viewer | null = null;

    const run = async (): Promise<void> => {
      setState("loading-harness-input");
      const response = await fetch(`${SCRATCH_PREFIX}harness.json`);
      if (!response.ok) throw new Error(`Harness input is not being served. Build both variants and run \`pnpm block835-v3t:sampler-plan\`, then start the server with VITE_T028_SAMPLER_PROBE=1. (${response.status})`);
      const input = (await response.json()) as HarnessInput;
      const variant = input.variants.find((entry) => entry.variantId === variantId);
      if (!variant) throw new Error(`Unknown variant ${variantId}. Known: ${input.variants.map((entry) => entry.variantId).join(", ")}.`);
      const station = input.stations.find((entry) => entry.stationId === stationId);
      if (!station) throw new Error(`Unknown station ${stationId}. Known: ${input.stations.map((entry) => entry.stationId).join(", ")}.`);
      if (cancelled) return;

      viewer = new Viewer(container, {
        animation: false,
        baseLayer: false,
        baseLayerPicker: false,
        // The capture path reads back the drawing buffer, so it is preserved
        // here regardless of build mode.
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        terrainProvider: new EllipsoidTerrainProvider(),
      });
      // A flat, unlit, imagery-free scene: the only thing that differs between
      // two captures at one station must be the sampler.
      viewer.scene.backgroundColor = Color.fromCssColorString("#0d151b");
      viewer.scene.globe.baseColor = Color.fromCssColorString("#18252d");
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.globe.enableLighting = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
      if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
      viewer.scene.requestRenderMode = false;
      viewer.scene.screenSpaceCameraController.enableInputs = false;

      setState("loading-assets");
      let loadedBytes = 0;
      for (const asset of variant.assets) {
        const assetResponse = await fetch(`${SCRATCH_PREFIX}${variant.variantId}/${asset.relativeRef}`);
        if (!assetResponse.ok) throw new Error(`Variant asset ${asset.relativeRef} is not being served (${assetResponse.status}).`);
        const bytes = new Uint8Array(await assetResponse.arrayBuffer());
        if (bytes.byteLength !== asset.byteSize) throw new Error(`Variant asset ${asset.relativeRef} returned ${bytes.byteLength} bytes; ${asset.byteSize} were declared.`);
        // Byte length alone would not tell the two sampler variants apart from
        // each other, let alone from a stale build left in the scratch root.
        // The captures are evidence, so the bytes they were taken from are
        // verified against the checksums the committed record cites.
        const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
        const checksum = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
        if (checksum !== asset.checksumSha256) throw new Error(`Variant asset ${asset.relativeRef} failed its declared SHA-256; the scratch root does not match the harness input.`);
        loadedBytes += bytes.byteLength;
        if (cancelled) return;
        const objectUrl = exteriorModelObjectUrl(bytes);
        objectUrls.push(objectUrl);
        const position = Cartesian3.fromDegrees(asset.longitude, asset.latitude, 0);
        const enuRotation = Matrix4.getMatrix3(Transforms.eastNorthUpToFixedFrame(position), new Matrix3());
        viewer.entities.add({
          id: `t028:${variant.variantId}:${asset.canonicalBuildingId}`,
          position,
          orientation: Quaternion.fromRotationMatrix(enuRotation),
          model: new ModelGraphics({ uri: objectUrl, scale: 1, minimumPixelSize: 1 }),
        });
      }

      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(station.longitude, station.latitude, station.heightMeters),
        orientation: {
          heading: CesiumMath.toRadians(station.headingDegrees),
          pitch: CesiumMath.toRadians(station.pitchDegrees),
          roll: CesiumMath.toRadians(station.rollDegrees),
        },
      });

      setState("settling");
      let frames = 0;
      const scene = viewer.scene;
      const onPostRender = (): void => {
        frames += 1;
        if (frames < SETTLE_FRAMES) return;
        scene.postRender.removeEventListener(onPostRender);
        if (cancelled) return;
        setSummary(JSON.stringify({
          packageId: input.packageId,
          variantId: variant.variantId,
          samplerFilter: variant.samplerFilter,
          stationId: station.stationId,
          targetBuildingId: station.targetBuildingId,
          groundDistanceMeters: station.groundDistanceMeters,
          assets: variant.assets.length,
          loadedBytes,
          devicePixelRatio: window.devicePixelRatio,
          viewportCss: { width: window.innerWidth, height: window.innerHeight },
          settleFrames: SETTLE_FRAMES,
        }));
        setState("ready");
      };
      scene.postRender.addEventListener(onPostRender);
    };

    void run().catch((error: unknown) => {
      if (cancelled) return;
      setState("failed");
      setSummary(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
      viewer?.destroy();
    };
  }, [stationId, variantId]);

  return (
    <div
      className="t028-sampler-harness"
      {...{ [SAMPLER_HARNESS_READY_ATTRIBUTE]: state === "ready" ? "1" : "0", [SAMPLER_HARNESS_STATE_ATTRIBUTE]: state }}
      style={{ position: "absolute", inset: 0 }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <pre
        data-t028-sampler-summary=""
        style={{ position: "absolute", left: 0, bottom: 0, margin: 0, padding: "4px 6px", font: "11px/1.3 monospace", color: "#cfe3ea", background: "rgba(13,21,27,0.82)", maxWidth: "60vw", whiteSpace: "pre-wrap" }}
      >
        {`${state}\n${summary}`}
      </pre>
    </div>
  );
}
