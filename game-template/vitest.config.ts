import { defineConfig } from "vitest/config";

// Unit tests for the scoreboard layer (SPEC §8). These exercise pure policy
// (scoreboard.ts) against a fake ChainGateway and an in-memory GuestStore — no
// chain, no product-sdk, no network. They run in node and must stay fast.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
