import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The session logic is pure functions over a Date, so these run in plain node -
// no jsdom, no React renderer, nothing to keep in sync with the UI.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
