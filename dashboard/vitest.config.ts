import { defineConfig } from "vitest/config";

// Unit tests are pure logic (no DOM, no RPC) — node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
