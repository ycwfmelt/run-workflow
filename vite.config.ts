import { defineConfig } from "vite";
import { resolve } from "node:path";
import fs from "node:fs";

// Custom plugin to copy manifest.json and icons to dist folder
function copyManifestPlugin() {
  return {
    name: "copy-manifest",
    closeBundle() {
      const distDir = resolve(import.meta.dirname, "dist");
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }

      // Copy manifest.json
      if (fs.existsSync(resolve(import.meta.dirname, "manifest.json"))) {
        fs.copyFileSync(
          resolve(import.meta.dirname, "manifest.json"),
          resolve(distDir, "manifest.json")
        );
      }

      // Copy icons if present
      const iconsDir = resolve(import.meta.dirname, "public/icons");
      const distIconsDir = resolve(distDir, "icons");
      if (fs.existsSync(iconsDir)) {
        if (!fs.existsSync(distIconsDir)) {
          fs.mkdirSync(distIconsDir, { recursive: true });
        }
        for (const file of fs.readdirSync(iconsDir)) {
          fs.copyFileSync(resolve(iconsDir, file), resolve(distIconsDir, file));
        }
      }
    },
  };
}

export default defineConfig({
  base: "",
  plugins: [copyManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, "src/sidepanel/index.html"),
        options: resolve(import.meta.dirname, "src/options/index.html"),
        offscreen: resolve(import.meta.dirname, "src/offscreen/index.html"),
        sandbox: resolve(import.meta.dirname, "src/sandbox/sandbox.html"),
        background: resolve(import.meta.dirname, "src/background/index.ts"),
        content: resolve(import.meta.dirname, "src/content/index.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          if (chunkInfo.name === "content") return "content.js";
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "assets/[name].css";
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
