import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesiumStatic";

/**
 * T028 sampler-aliasing harness, off unless explicitly asked for.
 *
 * With `VITE_T028_SAMPLER_PROBE=1` the dev and preview servers serve the
 * gitignored `artifacts/block835-v3t-cesium-20260811/` scratch root under a
 * fixed prefix, and `t028-sampler-harness.html` becomes a second rollup input.
 * Unset — which is every ordinary `pnpm dev`, `pnpm build` and `pnpm preview` —
 * none of it exists: no route, no extra bundle, and no path by which a browser
 * can read anything out of `artifacts/`.
 *
 * The scratch root holds the two sampler VARIANTS of the private V3T package.
 * Nothing under `public/data` is exposed by this plugin, in particular no
 * `private/`-rooted release partition, and the exterior-cell runtime is not
 * involved at all.
 */
const SAMPLER_PROBE_ENABLED = process.env.VITE_T028_SAMPLER_PROBE === "1";
const SAMPLER_PROBE_PREFIX = "/__t028-sampler/";

function samplerProbeScratchPlugin(): Plugin {
  const scratchRoot = resolve(process.cwd(), "artifacts", "block835-v3t-cesium-20260811");
  const mimeType = (path: string): string => (path.endsWith(".json") ? "application/json" : path.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream");
  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    // `@types/node` is deliberately absent here, so `IncomingMessage` carries no
    // members; the one field this middleware reads is named explicitly.
    const url = (request as { url?: string }).url ?? "";
    if (!url.startsWith(SAMPLER_PROBE_PREFIX)) { next(); return; }
    const relative = decodeURIComponent(url.slice(SAMPLER_PROBE_PREFIX.length).split(/[?#]/u)[0] ?? "");
    // Closed segment grammar, then a realpath-free containment check. The
    // scratch root is developer-writable, so the middleware refuses anything it
    // cannot prove stays inside it.
    const segments = relative.split("/");
    if (segments.length === 0 || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment) || segment === "." || segment === "..")) {
      response.statusCode = 400; response.end("T028 sampler probe: non-canonical path."); return;
    }
    const file = resolve(scratchRoot, ...segments);
    if (file !== scratchRoot && !file.startsWith(`${scratchRoot}${sep}`)) {
      response.statusCode = 403; response.end("T028 sampler probe: path escapes the scratch root."); return;
    }
    void readFile(file).then((bytes) => {
      response.setHeader("Content-Type", mimeType(file));
      response.setHeader("Cache-Control", "no-store");
      response.end(bytes);
    }).catch(() => { response.statusCode = 404; response.end("T028 sampler probe: not found."); });
  };
  return {
    name: "t028-sampler-probe-scratch",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  ...(SAMPLER_PROBE_ENABLED
    ? { build: { rollupOptions: { input: { main: resolve(process.cwd(), "index.html"), t028SamplerHarness: resolve(process.cwd(), "t028-sampler-harness.html") } } } }
    : {}),
  plugins: [
    react(),
    ...(SAMPLER_PROBE_ENABLED ? [samplerProbeScratchPlugin()] : []),
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
