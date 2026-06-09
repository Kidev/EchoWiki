import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwind()],
  publicDir: "../../assets",
  logLevel: "warn",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    sourcemap: true,
    // three.js core (chiefly WebGLRenderer) is ~520 kB minified and can't be
    // shrunk below the 500 kB default: but it lives in its own `three` vendor
    // chunk (see manualChunks) that is only fetched lazily when a reader opens
    // a 3D model, and never enters the main app bundle. Raise the limit so this
    // one intentional, code-split vendor chunk doesn't trip the warning.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        splash: "splash.html",
        app: "app.html",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
        sourcemapFileNames: "[name].js.map",
        // Pull three.js core into a dedicated vendor chunk shared by ModelViewer
        // and every loader chunk, cached independently of our app code. The jsm
        // loaders/controls (three/examples/jsm) stay as their own on-demand
        // chunks so only the formats actually used get downloaded.
        manualChunks(id) {
          if (id.includes("node_modules/three/build/")) return "three";
          return undefined;
        },
      },
      onwarn(warning, warn) {
        if (warning.code === "EVAL") return;
        warn(warning);
      },
    },
  },
});
