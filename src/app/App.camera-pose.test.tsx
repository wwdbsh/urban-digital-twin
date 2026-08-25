// @vitest-environment jsdom

/**
 * Camera-pose regressions for Issue #46.
 *
 * Colocated in its own file with its own viewport stub rather than added to
 * `App.test.tsx`: these cases need the stub to publish a SETTLED camera of the
 * test's choosing (including the ambiguous near-nadir read-back Cesium can
 * report) and to refuse a focus request, neither of which the shared stub can
 * do. The shared stub is left untouched so its existing expectations keep
 * meaning what they meant.
 *
 * Scope note, stated rather than implied: the gimbal correction itself lives in
 * `CesiumViewport`'s settle path against a real Cesium camera and is not
 * exercised by a stub. What these tests pin is the APP side of the same loop —
 * that a settled pose is what gets spread into the next preset request, that a
 * URL pose survives an unrelated settled camera, and that a refused focus is
 * visible to the user.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature } from "../domain/schema";
import type { CameraPose } from "../domain/visitor-navigation";

/** The pose the stub publishes on its next "settled camera" click. */
const settledCamera = vi.hoisted(() => ({ pose: null as CameraPose | null }));

vi.mock("../features/explorer/CesiumViewport", async () => {
  const React = await import("react");
  const actual = await vi.importActual("../features/explorer/CesiumViewport") as Record<string, unknown>;

  type MockProps = {
    adapter: { getFeatures: () => Feature[] };
    focusRequest: number;
    focusFeatureId: string | null;
    cameraPoseRequest?: CameraPose & { requestId: number };
    onFeatureSelected?: (feature: Feature) => void;
    onCameraChanged?: (camera: CameraPose) => void;
    onFocusUnavailable?: (featureId: string | null) => void;
  };

  const MockCesiumViewport = ({ adapter, focusRequest, focusFeatureId, cameraPoseRequest, onFeatureSelected, onCameraChanged, onFocusUnavailable }: MockProps) => {
    const locatedFeature = adapter.getFeatures().find((feature) => feature.kind === "poi") ?? adapter.getFeatures()[0]!;
    return React.createElement(
      "div",
      {
        className: "viewport",
        "data-focus-request": focusRequest,
        "data-focus-feature-id": focusFeatureId ?? "",
        "data-camera-pose-request": cameraPoseRequest
          ? `${cameraPoseRequest.longitude},${cameraPoseRequest.latitude},${cameraPoseRequest.height},${cameraPoseRequest.heading},${cameraPoseRequest.pitch},${cameraPoseRequest.roll},${cameraPoseRequest.requestId}`
          : "",
      },
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locatedFeature) }, "Mock located pick"),
      // An overlay id space the active adapter deliberately does not index, the
      // way a `public-realm:` surface pick behaves. The real viewport resolves
      // it through its own prefix fallback; the adapter never can.
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.({ ...locatedFeature, id: "public-realm:block835:surface:test" }) }, "Mock overlay pick"),
      // Publishes whatever the test staged, defaulting to the pose the viewport
      // was actually commanded into — which is what a correct settle path emits.
      React.createElement("button", {
        type: "button",
        onClick: () => {
          const pose = settledCamera.pose ?? (cameraPoseRequest ? { longitude: cameraPoseRequest.longitude, latitude: cameraPoseRequest.latitude, height: cameraPoseRequest.height, heading: cameraPoseRequest.heading, pitch: cameraPoseRequest.pitch, roll: cameraPoseRequest.roll } : null);
          if (pose) onCameraChanged?.(pose);
        },
      }, "Mock settled camera"),
      React.createElement("button", { type: "button", onClick: () => onFocusUnavailable?.(focusFeatureId) }, "Mock focus refusal"),
    );
  };

  return { ...actual, CesiumViewport: MockCesiumViewport };
});

vi.mock("../runtime/citywide-release-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadCitywideRelease: async () => { throw new Error("Citywide release bytes are not served in this test."); } };
});

import { App } from "./App";

const initialTestUrl = window.location.href;
const POSE_URL = "/?lon=-73.9857&lat=40.7484&height=900&heading=200&pitch=-30&roll=0";

function poseRequest(): string[] {
  return (document.querySelector(".viewport")?.getAttribute("data-camera-pose-request") ?? "").split(",");
}

function cameraControls() {
  return within(screen.getByRole("region", { name: "Camera controls" }));
}

beforeEach(() => { settledCamera.pose = null; });
afterEach(() => { cleanup(); window.history.replaceState({}, "", initialTestUrl); });

describe("issue #46 camera pose presets", () => {
  it("boots into a hand-written pose URL that names no data mode", async () => {
    window.history.replaceState({}, "", POSE_URL);
    render(<App />);

    // The URL pose, not the safe default and not a computed globe-fit view.
    expect(poseRequest().slice(0, 6)).toEqual(["-73.9857", "40.7484", "900", "200", "-30", "0"]);
    expect(cameraControls().getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the URL pose while the camera has not reached it yet", async () => {
    window.history.replaceState({}, "", POSE_URL);
    render(<App />);

    // Cesium publishes its own initial view before the requested pose settles.
    // Issue #46: this used to be accepted as the session camera and written
    // straight back into the address bar, discarding the link the user typed.
    settledCamera.pose = { longitude: -82.5, latitude: 35.166, height: 500_000, heading: 0, pitch: -75, roll: 0 };
    fireEvent.click(screen.getByRole("button", { name: "Mock settled camera" }));

    await waitFor(() => {
      const params = new URL(window.location.href).searchParams;
      expect(Number(params.get("lon"))).toBeCloseTo(-73.9857, 4);
      expect(Number(params.get("height"))).toBeCloseTo(900, 3);
    });
  });

  it("never persists a rolled camera across chained upright presets", async () => {
    render(<App />);
    const controls = cameraControls();

    const chain = ["Overview", "North", "North"] as const;
    for (const label of chain) {
      fireEvent.click(controls.getByRole("button", { name: label }));
      // The settled camera the viewport reports is what the NEXT preset request
      // is built from, so publish it between clicks exactly as the app runs.
      fireEvent.click(screen.getByRole("button", { name: "Mock settled camera" }));
      await waitFor(() => expect(Math.abs(Number(poseRequest()[5]))).toBeLessThanOrEqual(1));
    }

    expect(Number(poseRequest()[3])).toBe(0);
    expect(Math.abs(Number(new URL(window.location.href).searchParams.get("roll")))).toBeLessThanOrEqual(1);
  });

  it("hands an overlay-id selection to the scene instead of returning silently", async () => {
    render(<App />);
    const viewport = document.querySelector<HTMLElement>(".viewport");

    fireEvent.click(screen.getByRole("button", { name: "Mock overlay pick" }));
    await waitFor(() => expect(viewport).toHaveAttribute("data-focus-feature-id", "public-realm:block835:surface:test"));
    const requestBefore = Number(viewport?.getAttribute("data-focus-request"));

    // Issue #46: `activeAdapter.getFeature` cannot resolve an overlay id, so
    // this used to return before issuing any request — no flight, no message.
    fireEvent.click(cameraControls().getByRole("button", { name: "Current selection" }));

    await waitFor(() => expect(viewport).toHaveAttribute("data-focus-request", String(requestBefore + 1)));
    expect(viewport).toHaveAttribute("data-focus-feature-id", "public-realm:block835:surface:test");
  });

  it("states a refused focus instead of leaving the camera silently unmoved", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Mock located pick" }));
    await waitFor(() => expect(document.querySelector(".viewport")).toHaveAttribute("data-focus-feature-id", expect.stringMatching(/.+/) as unknown as string));

    fireEvent.click(screen.getByRole("button", { name: "Mock focus refusal" }));

    const notice = await cameraControls().findByText(/no locatable geometry in the loaded scene/iu);
    expect(notice).toHaveAttribute("role", "status");

    // A fresh attempt clears the stale statement rather than accumulating it.
    fireEvent.click(cameraControls().getByRole("button", { name: "Current selection" }));
    await waitFor(() => expect(cameraControls().queryByText(/no locatable geometry in the loaded scene/iu)).not.toBeInTheDocument());
  });
});
