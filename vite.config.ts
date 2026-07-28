import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      // `viewer.html` is a development tool rather than part of the game entry
      // point, but it ships in the same build so the model-viewer skill can
      // drive a production preview without a second toolchain.
      input: {
        game: resolve(root, "index.html"),
        viewer: resolve(root, "viewer.html"),
      },
    },
  },
});
