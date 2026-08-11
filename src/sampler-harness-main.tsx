import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { SamplerAliasingHarness } from "./features/explorer/sampler-aliasing-harness";
import "./styles.css";

/**
 * Entry for the T028 sampler-aliasing harness.
 *
 * This module is a rollup input ONLY when `VITE_T028_SAMPLER_PROBE=1` is set at
 * build time (see `vite.config.ts`), so a normal `pnpm build` emits nothing from
 * it and the shipped bundle is unchanged.
 */
const root = document.getElementById("root");

if (!root) {
  throw new Error("Sampler harness root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <SamplerAliasingHarness />
  </StrictMode>,
);
