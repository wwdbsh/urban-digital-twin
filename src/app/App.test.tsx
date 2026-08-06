// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeFixtureFeatures } from "../domain/features";
import type { Feature } from "../domain/schema";
import type { CameraPose } from "../domain/visitor-navigation";
import type { CommercialStorefrontPlacement } from "../runtime/exterior-pilot-release";

vi.mock("../features/explorer/CesiumViewport", async () => {
  const React = await import("react");

  type MockProps = {
    adapter: { getFeatures: () => Feature[] };
    focusRequest: number;
    focusFeatureId: string | null;
    focusOverlayOpen?: boolean;
    cameraPoseRequest?: { longitude: number; latitude: number; height: number; heading: number; pitch: number; roll: number; requestId: number };
    onFeatureSelected?: (feature: Feature) => void;
    onCameraChanged?: (camera: CameraPose) => void;
    onStorefrontSelected?: (placement: CommercialStorefrontPlacement) => void;
  };

  const MockCesiumViewport = ({ adapter, focusRequest, focusFeatureId, focusOverlayOpen, cameraPoseRequest, onFeatureSelected, onCameraChanged, onStorefrontSelected }: MockProps) => {
    const [cameraCallbackSetupCount, setCameraCallbackSetupCount] = React.useState(0);
    React.useEffect(() => { setCameraCallbackSetupCount((count) => count + 1); }, [onCameraChanged]);
    const locatedFeature = adapter.getFeatures().find((feature) => feature.kind === "poi") ?? adapter.getFeatures()[0]!;
    const locationlessFeature: Feature = {
      ...locatedFeature,
      id: `${locatedFeature.id}:locationless-test`,
      name: "Locationless test record",
      attributes: { ...locatedFeature.attributes, civicNoMarker: true },
    };
    return React.createElement(
      "div",
      {
        className: "viewport",
        "data-focus-request": focusRequest,
        "data-focus-feature-id": focusFeatureId ?? "",
        "data-focus-overlay-open": focusOverlayOpen ? "true" : "false",
        "data-camera-pose-request": cameraPoseRequest ? `${cameraPoseRequest.longitude},${cameraPoseRequest.latitude},${cameraPoseRequest.height},${cameraPoseRequest.pitch},${cameraPoseRequest.requestId}` : "",
        "data-camera-callback-setup-count": cameraCallbackSetupCount,
      },
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locatedFeature) }, "Mock located pick"),
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locationlessFeature) }, "Mock locationless pick"),
      React.createElement("button", { type: "button", onClick: () => onStorefrontSelected?.({ canonicalBuildingId: locatedFeature.id, storefrontId: "storefront:osm:node:10908810995@1" } as CommercialStorefrontPlacement) }, "Mock storefront pick"),
      React.createElement("button", { type: "button", onClick: () => onCameraChanged?.({ longitude: -73.99, latitude: 40.748, height: 900, heading: 15, pitch: -45, roll: 0 }) }, "Mock camera update"),
    );
  };

  return {
    CesiumViewport: MockCesiumViewport,
    medianFrameInterval: (values: readonly number[]) => values.length === 0 ? null : values[0] ?? null,
    shouldFocusFeature: (feature: Pick<Feature, "attributes"> | null | undefined) => Boolean(feature && feature.attributes.civicNoMarker !== true && feature.attributes.citywideNoMarker !== true),
  };
});

import { App, overlayLayoutPolicy, preserveFeatureSequence, selectionFocusTransaction } from "./App";
import { navigationUrl, parseNavigationUrl } from "../domain/visitor-navigation";

const initialTestUrl = window.location.href;
afterEach(() => { cleanup(); window.history.replaceState({}, "", initialTestUrl); });
const locatedFeature = runtimeFixtureFeatures.find((feature) => feature.kind === "poi")!;

describe("explorer overlay policy", () => {
  it("keeps the map as the desktop main region while reserving only overlay insets", () => {
    expect(overlayLayoutPolicy(false, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "none",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
    expect(overlayLayoutPolicy(true, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "inspector-width",
      mobileBottomInset: "none",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
    expect(overlayLayoutPolicy(true, true)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "inspector-sheet",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
  });

  it("claims exactly one focus transaction for a locatable selection", () => {
    expect(selectionFocusTransaction(locatedFeature)).toEqual({ focusFeatureId: locatedFeature.id, shouldFly: true });
  });

  it("opens locationless records without claiming a camera transaction", () => {
    const locationless = { ...locatedFeature, attributes: { ...locatedFeature.attributes, civicNoMarker: true } };
    expect(selectionFocusTransaction(locationless)).toEqual({ focusFeatureId: null, shouldFly: false });
  });

  it("does not retain an ID-only sequence when a same-ID feature receives new geometry or detail content", () => {
    const revisedCoordinates: Feature["coordinates"] = [locatedFeature.coordinates[0] + 0.001, locatedFeature.coordinates[1]];
    const revised: Feature = {
      ...locatedFeature,
      name: "Revised same-ID feature",
      coordinates: revisedCoordinates,
      geometry: locatedFeature.geometry.type === "Point" ? { ...locatedFeature.geometry, coordinates: revisedCoordinates } : locatedFeature.geometry,
      attributes: { ...locatedFeature.attributes, refreshedDetail: "new-content" },
    };
    const previous = [locatedFeature];
    const retained = preserveFeatureSequence(previous, [revised]);
    expect(retained).not.toBe(previous);
    expect(retained).toEqual([revised]);
  });
});

describe("App overlay and selection regressions", () => {
  it("keeps a selected storefront in the URL after a camera update without rebuilding the viewport callback", async () => {
    const storefrontId = "storefront:osm:node:10908810995@1";
    window.history.replaceState({}, "", `/?exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1`);
    render(<App />);

    const viewport = document.querySelector<HTMLElement>(".viewport");
    expect(viewport).not.toBeNull();
    await waitFor(() => expect(viewport).toHaveAttribute("data-camera-callback-setup-count", "1"));
    fireEvent.click(screen.getByRole("button", { name: "Mock storefront pick" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("storefront")).toBe(storefrontId));
    const callbackSetupCount = viewport?.getAttribute("data-camera-callback-setup-count");

    fireEvent.click(screen.getByRole("button", { name: "Mock camera update" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("storefront")).toBe(storefrontId));
    expect(viewport).toHaveAttribute("data-camera-callback-setup-count", callbackSetupCount);
  });

  it("keeps the optional commercial overlay and storefront deep-link separate from the base release", () => {
    const url = navigationUrl({ featureId: "doitt:778052", query: "", cameraMode: "overview", pose: null, poseInvalid: false, dataMode: "civic-context", releaseId: "manhattan-civic-context-20260804", exteriorReleaseId: "manhattan-esb-block-exterior-pilot-20260805", commercial: true, storefrontId: "storefront:osm:node:1@2" }, "http://localhost/");
    const parsed = parseNavigationUrl(url);
    expect(parsed.releaseId).toBe("manhattan-civic-context-20260804");
    expect(parsed.exteriorReleaseId).toBe("manhattan-esb-block-exterior-pilot-20260805");
    expect(parsed.commercial).toBe(true);
    expect(parsed.storefrontId).toBe("storefront:osm:node:1@2");
  });

  it("requests the normalized URL pose or safe default on the first viewport render", () => {
    render(<App />);

    expect(document.querySelector(".viewport")).toHaveAttribute("data-camera-pose-request", "-73.991,40.744,4000,-75,1");
    const cameraControls = within(screen.getByRole("region", { name: "Camera controls" }));
    expect(cameraControls.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
    expect(cameraControls.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the inspector inside the map region and claims one focus request for a direct pick", async () => {
    render(<App />);

    const mapRegion = document.querySelector<HTMLElement>(".map-region");
    const viewport = document.querySelector<HTMLElement>(".viewport");
    const inspector = screen.getByRole("complementary", { name: "Selected feature details" });
    expect(mapRegion).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(mapRegion).toContainElement(viewport);
    expect(mapRegion).toContainElement(inspector);

    const requestBeforePick = Number(viewport?.getAttribute("data-focus-request"));
    fireEvent.click(screen.getByRole("button", { name: "Mock located pick" }));
    await waitFor(() => expect(viewport).toHaveAttribute("data-focus-request", String(requestBeforePick + 1)));
    expect(viewport).toHaveAttribute("data-focus-feature-id", locatedFeature.id);
  });

  it("closes details with Escape and returns focus to the located-pick trigger", async () => {
    render(<App />);

    const trigger = screen.getByRole("button", { name: "Mock located pick" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Selected feature details" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps locationless picks in details without incrementing the focus transaction", async () => {
    render(<App />);

    const viewport = document.querySelector<HTMLElement>(".viewport");
    const requestBeforePick = Number(viewport?.getAttribute("data-focus-request"));
    fireEvent.click(screen.getByRole("button", { name: "Mock locationless pick" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Locationless test record"));
    expect(viewport).toHaveAttribute("data-focus-request", String(requestBeforePick));
    expect(viewport).toHaveAttribute("data-focus-feature-id", "");
  });

  it("starts diagnostics and directions collapsed and makes their expanded surfaces mutually exclusive", async () => {
    render(<App />);

    const diagnostics = screen.getByRole("button", { name: /Diagnostics.*Runtime health/ });
    const directions = screen.getByRole("button", { name: /Directions.*Plan a synthetic route/ });
    expect(diagnostics).toHaveAttribute("aria-expanded", "false");
    expect(directions).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(diagnostics);
    expect(diagnostics).toHaveAttribute("aria-expanded", "true");
    expect(directions).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(directions);
    await waitFor(() => expect(directions).toHaveAttribute("aria-expanded", "true"));
    expect(diagnostics).toHaveAttribute("aria-expanded", "false");
  });

});
