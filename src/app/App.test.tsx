// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeFixtureFeatures } from "../domain/features";
import type { Feature } from "../domain/schema";

vi.mock("../features/explorer/CesiumViewport", async () => {
  const React = await import("react");

  type MockProps = {
    adapter: { getFeatures: () => Feature[] };
    focusRequest: number;
    focusFeatureId: string | null;
    focusOverlayOpen?: boolean;
    onFeatureSelected?: (feature: Feature) => void;
  };

  const MockCesiumViewport = ({ adapter, focusRequest, focusFeatureId, focusOverlayOpen, onFeatureSelected }: MockProps) => {
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
      },
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locatedFeature) }, "Mock located pick"),
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locationlessFeature) }, "Mock locationless pick"),
    );
  };

  return {
    CesiumViewport: MockCesiumViewport,
    medianFrameInterval: (values: readonly number[]) => values.length === 0 ? null : values[0] ?? null,
    shouldFocusFeature: (feature: Pick<Feature, "attributes"> | null | undefined) => Boolean(feature && feature.attributes.civicNoMarker !== true && feature.attributes.citywideNoMarker !== true),
  };
});

import { App, overlayLayoutPolicy, selectionFocusTransaction } from "./App";

afterEach(() => cleanup());
const locatedFeature = runtimeFixtureFeatures.find((feature) => feature.kind === "poi")!;

describe("explorer overlay policy", () => {
  it("keeps the map as the desktop main region while reserving only overlay insets", () => {
    expect(overlayLayoutPolicy(false, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "none",
    });
    expect(overlayLayoutPolicy(true, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "inspector-width",
      mobileBottomInset: "none",
    });
    expect(overlayLayoutPolicy(true, true)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "inspector-sheet",
    });
  });

  it("claims exactly one focus transaction for a locatable selection", () => {
    expect(selectionFocusTransaction(locatedFeature)).toEqual({ focusFeatureId: locatedFeature.id, shouldFly: true });
  });

  it("opens locationless records without claiming a camera transaction", () => {
    const locationless = { ...locatedFeature, attributes: { ...locatedFeature.attributes, civicNoMarker: true } };
    expect(selectionFocusTransaction(locationless)).toEqual({ focusFeatureId: null, shouldFly: false });
  });
});

describe("App overlay and selection regressions", () => {
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
