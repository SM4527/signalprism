import { defineConfig } from "@playwright/test";

/** Runs against the sample stack (`scripts/start.sh`) on :8500; it does not start a server. */
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8500" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
