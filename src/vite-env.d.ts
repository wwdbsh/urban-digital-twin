/// <reference types="vite/client" />

declare const CESIUM_BASE_URL: string;

declare module "*.geojson?raw" {
  const sourceText: string;
  export default sourceText;
}
