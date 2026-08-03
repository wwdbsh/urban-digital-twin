import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesiumStatic";

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: `${cesiumSource}/Workers/**/*`,
          dest: `${cesiumBaseUrl}/Workers`,
          rename: { stripBase: 5 },
        },
        {
          src: `${cesiumSource}/ThirdParty/**/*`,
          dest: `${cesiumBaseUrl}/ThirdParty`,
          rename: { stripBase: 5 },
        },
        {
          src: `${cesiumSource}/Assets/**/*`,
          dest: `${cesiumBaseUrl}/Assets`,
          rename: { stripBase: 5 },
        },
        {
          src: `${cesiumSource}/Widgets/**/*`,
          dest: `${cesiumBaseUrl}/Widgets`,
          rename: { stripBase: 5 },
        },
      ],
    }),
  ],
});
