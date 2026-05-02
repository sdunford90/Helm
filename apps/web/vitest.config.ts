import { defineConfig } from "vitest/config";

// Minimal vitest setup for the web app — we don't need jsdom or
// @testing-library/react for the orchestration helpers added so far
// (pure async functions with dependency-injected Stripe / fetch).
// Add `environment: "jsdom"` here if/when component-level tests are added.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 10000,
  },
});
