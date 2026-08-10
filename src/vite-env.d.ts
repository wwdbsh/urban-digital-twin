/// <reference types="vite/client" />

declare const CESIUM_BASE_URL: string;

declare module "*.geojson?raw" {
  const sourceText: string;
  export default sourceText;
}

interface ImportMetaEnv {
  /**
   * Build-time opt-in for the T009 Block 835 canary validation harness. A
   * normal `pnpm build` leaves it unset, so the harness constant folds to
   * `false` and the probe, its camera path fixture and the exterior-cell fault
   * seam are tree-shaken out of the production bundle.
   */
  readonly VITE_BLOCK835_PROBE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
